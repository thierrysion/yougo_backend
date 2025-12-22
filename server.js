const express = require('express');
const http = require('http');
const cors = require('cors');
const socketIo = require('socket.io');
const path = require('path');
require('dotenv').config();

//Import de la configuration database
const { sequelize, testConnection, syncDatabase } = require('./config/database');
require('./models/index.js');

//Import des services
const tokenService = require('./services/tokenService.js');

const app = express();
const server = http.createServer(app);

const io = socketIo(server, {
  cors: {
    origin: { origin: '*' }, //process.env.CLIENT_URL,
    methods: ["GET", "POST"]
  }
});

const SocketService = require('./services/SocketService.js');

const socketService = new SocketService(io);

//Middlewares de base
/*app.use(cors({
	origin: process.env.CLIENT_URL || "http://127.0.0.1:3000" || "*",
	//credentials: true
}));*/
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Trust proxy pour les IP réelles
app.set('trust proxy', true);

const MatchingService = require('./services/MatchingService');
const RideStatusService = require('./services/RideStatusService');
const LocationService = require('./services/LocationService');
const RoutingService = require('./services/RoutingService');
const NotificationService = require('./services/NotificationService');
const PushTokenService = require('./services/PushTokenService');
const ChatService = require('./services/ChatService');
const PaymentService = require('./services/PaymentService');
const AdminService = require('./services/AdminService');


const authRoutes = require('./routes/auth.js');
const pricingRoutes = require('./routes/pricing.js');
const locationRoutes = require('./routes/location');
const rideStatusRoutes = require('./routes/rideStatus');
const rideRoutes = require('./routes/rides');
const notificationRoutes = require('./routes/notifications');
const chatRoutes = require('./routes/chat');
const paymentRoutes = require('./routes/payments');
const adminRoutes = require('./routes/admin');
const geoCodingRoutes = require('./routes/geocoding');
const routingRoutes = require('./routes/routing');
const driverRoutes = require('./routes/drivers');


// Initialisation des services
const matchingService = new MatchingService(socketService);
const chatService = new ChatService(io);
const rideStatusService = new RideStatusService(socketService, chatService);
const locationService = new LocationService(io);
const routingService = new RoutingService();
const notificationService = new NotificationService(io);
const pushTokenService = new PushTokenService();
const paymentService = new PaymentService();
const adminService = new AdminService();


// Démarrer les nettoyages périodiques
locationService.startCleanupInterval();
pushTokenService.startCleanupInterval();

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/pricing', pricingRoutes);
app.use('/api/rides', rideRoutes(matchingService));
app.use('/api/rides', rideStatusRoutes(rideStatusService));
app.use('/api/location', locationRoutes(locationService, routingService));
app.use('/api/notifications', notificationRoutes(notificationService, pushTokenService));
app.use('/api/chat', chatRoutes(chatService));
app.use('/api/payments', paymentRoutes(paymentService));
app.use('/api/admin', adminRoutes(adminService));
app.use('/api/geocoding', geoCodingRoutes);
app.use('/api/routing', routingRoutes(routingService));
app.use('/api/drivers', driverRoutes(socketService));




// Route de santé
app.get('/health', async (req, res) => {
	try {
		const dbStatus = await testConnection();
		const uptime = process.uptime();
		res.json({
			status: 'OK',
			timestamp: new Date().toISOString(),
			database: dbStatus ? 'connected' : 'disconnected',
			environnement: process.env.NODE_ENV,
			country: 'Cameroun',
			supported_cities: process.env.SUPPORTED_CITIES?.split(','),
			uptime: `${Math.floor(uptime / 60)}m ${Math.floor(uptime % 60)}s`,
			memory: process.memoryUsage(),
			version: '1.0.0'
		});
	} catch (error) {
		res.status(500).json({
		  status: 'ERROR',
		  error: error.message
		});
	}
});

// Route de débogage (à protéger en production)
  app.get('/debug/matching', (req, res) => {
    const activeRides = matchingService.rideQueueService.getAllActiveRides();
    const connectedDrivers = matchingService.socketService.getConnectedDrivers();
    const connectedCustomers = matchingService.socketService.getConnectedCustomers();

    res.json({
      activeRides: activeRides.map(ride => ({
        rideId: ride.rideId,
        status: ride.status,
        notifiedDrivers: ride.notifiedDrivers.length,
        availableDrivers: ride.availableDrivers.length,
        createdAt: ride.createdAt
      })),
      connectedDrivers,
      connectedCustomers,
      reservedDrivers: Array.from(matchingService.reservationService.reservedDrivers.entries())
    });
  });

// Route d'accueil
app.get('/', (req, res) => {
  res.json({
    message: '🚗 API YouGo - Service de transport',
    version: '1.0.0',
    description: 'Backend pour application de transport au Cameroun',
    models: [
      'User', 'Driver', 'RideType', 'PricingRule', 
      'Ride', 'RidePricing', 'ChatMessage', 'RefreshToken'
    ],
    country: 'Cameroun',
    cities: process.env.SUPPORTED_CITIES?.split(','),
	authentication: 'Firebase OTP + JWT',
    endpoints: {
      auth: '/api/auth',
      health: '/health'
    }
  });
});

// Middleware de gestion d'erreurs
app.use((err, req, res, next) => {
  console.error('💥 Erreur serveur:', err);
  
  res.status(500).json({
    status: 'error',
    message: process.env.NODE_ENV === 'development' 
      ? err.message 
      : 'Une erreur est survenue sur le serveur',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
})

// Route 404
/*app.use('*', (req, res) => {
  res.status(404).json({
    status: 'error',
    message: 'Route non trouvée',
    path: req.originalUrl
  });
});*/

// Nettoyage périodique des tokens expirés
const startCleanupJob = () => {
  setInterval(async () => {
    try {
      await tokenService.cleanupExpiredTokens();
    } catch (error) {
      console.error('❌ Erreur nettoyage tokens:', error);
    }
  }, 24 * 60 * 60 * 1000); // Toutes les 24 heures
};

// politique de confidentialité
app.get('/privacy-policy', (req, res) => {
  res.sendFile(path.join(__dirname, 'privacy-policy/privacy policy.html'));
});

// Démarrage du serveur
const startServer = async () => {
  try {
    // Test de connexion à la base
    await testConnection();
	await syncDatabase();
	
	// Démarrer le job de nettoyage
    startCleanupJob();
    
    const PORT = process.env.PORT || 3000;
    
    server.listen(PORT, () => {
      console.log(`
🚗 UBER CAMEROUN - BACKEND DÉMARRÉ 🚗

📍 Port: ${PORT}
🌍 Environnement: ${process.env.NODE_ENV}
🏙️  Villes: ${process.env.SUPPORTED_CITIES}
🗄️  Database: PostgreSQL
🔐 Auth: Firebase OTP + JWT
📡 API: http://localhost:${PORT}
❤️  Health: http://localhost:${PORT}/health

🔜 Prochaines étapes:
   • Implémentation des modèles de données
   • Authentification Firebase
   • Système de courses
      `);
    });
    
  } catch (error) {
    console.error('❌ Impossible de démarrer le serveur:', error);
    process.exit(1);
  }
};

// Gestion propre de l'arrêt
process.on('SIGTERM', async () => {
  console.log('🔄 Arrêt gracieux du serveur...');
  await sequelize.close();
  server.close(() => {
    console.log('✅ Serveur arrêté');
    process.exit(0);
  });
});

process.on('SIGINT', async () => {
  console.log('\n🔄 Arrêt via Ctrl+C...');
  await sequelize.close();
  server.close(() => {
    console.log('✅ Serveur arrêté');
    process.exit(0);
  });
});

// Démarrage
startServer();

module.exports =  { app, server, socketService, io };
