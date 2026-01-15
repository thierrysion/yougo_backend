// services/SocketService.js
const redis = require('../config/redis');
//const DriverSearchService = require('./DriverSearchService');
const RideMatchingService = require('./RideMatchingService');
const { User } = require('../models');
//const jwt = require('jsonwebtoken');
const tokenService = require('./tokenService.js');

class SocketService {
  constructor(io) {
    this.io = io;
    this.setupRedisAdapter();
    this.setupEventHandlers();
    // Initialiser le service de matching
    this.rideMatchingService = new RideMatchingService(this);

    // Préfixes Redis
    this.CONNECTIONS_PREFIX = 'socket:connections:';
    this.USERS_PREFIX = 'socket:users:';
    this.DRIVERS_PREFIX = 'socket:drivers:';
    this.ROOMS_PREFIX = 'socket:rooms:';
    this.GEO_KEY = 'drivers:geo:locations';
    this.ONLINE_DRIVERS_KEY = 'drivers:online';
    
    // TTL
    this.CONNECTION_TTL = 7200; // 2 heures
    this.DRIVER_LOCATION_TTL = 300; // 5 minutes
    
    // Démarrer le nettoyage périodique
    this.startCleanupInterval();
  }

  // ==================== SETUP SOCKET.IO ====================

  setupRedisAdapter() {
    const { createAdapter } = require('@socket.io/redis-adapter');
    const pubClient = redis.client.duplicate();
    const subClient = redis.client.duplicate();
    
    this.io.adapter(createAdapter(pubClient, subClient));
    console.log('✅ Adapter Redis configuré pour Socket.io');
  }

  setupEventHandlers() {
    this.io.use(this.socketAuthMiddleware.bind(this));
    
    this.io.on('connection', async (socket) => {
      console.log(`🔌 Nouvelle connexion: ${socket.id} - User: ${socket.user.uid}`);
      
      await this.handleNewConnection(socket);
      this.setupSocketEventHandlers(socket);
      
      socket.emit('connection_established', {
        socketId: socket.id,
        userId: socket.user.uid,
        userType: socket.user.role,
        timestamp: Date.now()
      });
    });
  }

  async socketAuthMiddleware(socket, next) {
    try {
      //console.log("middlewate de socket.io");
      const token = socket.handshake.auth.token || socket.handshake.query.token;
      
      if (!token) {
        //console.log("token missing");
        return next(new Error('Authentication error: Token missing'));
      }
      
      // Vérifier le token
      const tokenResult = tokenService.verifyAccessToken(token);

      if (!tokenResult.success) {
        //console.log("token invalide");
        return next(new Error('Authentication error: Invalid token'));
      }

      const decoded = tokenResult.decoded;

      // Récupérer l'utilisateur
      //console.log("l'uid de l'utilisateur est: " + decoded.uid);
      //const user = await User.findByPk(decoded.uid);
      const user = await User.findByPk(decoded.uid, {
        attributes: { exclude: [] },
        include: [
          {
            association: 'driver_profile',
            include: ['ride_type']
          }
        ]
      });
      
      if (!user) {
        //console.log("on n'a pas retrouvé cet utilisateur en BD");
        return next(new Error('Authentication error: No user found'));
      }

      if (user.status !== 'active') {
        //console.log("le compte utilisateur n'est pas activé");
        return next(new Error('Authentication error: User is inactive or suspended'));
      }

      //const decoded = jwt.verify(token, process.env.JWT_SECRET);
      
      socket.user = {
        uid: user.uid,
        userType: user.role,
        role: user.role,
        driverStatus: user.driver_profile ? user.driver_profile.driver_status: null,
        vehicleType: user.driver_profile ? user.driver_profile.ride_type: null, //vehicleType
        firstName: user.first_name,
        lastName: user.last_name
      };
      
      next();
      
    } catch (error) {
      console.error('❌ Erreur authentification socket:', error.message);
      next(new Error('Authentication error: Invalid token'));
    }
  }

  // ==================== GESTION DES CONNEXIONS ====================

  async handleNewConnection(socket) {
    const { uid, userType } = socket.user;
    
    const connectionData = {
      socketId: socket.id,
      userId: uid,
      userType,
      connectedAt: Date.now(),
      lastActiveAt: Date.now(),
      userAgent: socket.handshake.headers['user-agent'] || '',
      ipAddress: socket.handshake.address,
      status: 'connected',
      rooms: []
    };

    // Enregistrer la connexion
    await this.saveConnection(socket.id, connectionData);
    
    // Associer à l'utilisateur
    await this.addUserConnection(uid, socket.id);
    
    // Traitement spécifique pour les chauffeurs
    if (userType === 'driver') {
      await this.handleDriverConnection(socket);
    }
    
    console.log(`✅ Connexion enregistrée: ${socket.id} - ${uid} (${userType})`);
  }

  async handleDriverConnection(socket) {
    const { uid, driverStatus, vehicleType, firstName, lastName } = socket.user;
    
    const driverData = {
      driverId: uid,
      userId: uid,
      firstName,
      lastName,
      driverStatus: driverStatus || 'available',
      vehicleType,
      isOnline: true,
      connectedAt: Date.now(),
      lastActiveAt: Date.now(),
      lastLocationUpdate: Date.now(),
      socketId: socket.id
    };
    
    // Utiliser RideMatchingService pour enregistrer le chauffeur
    const driverInfo = await this.rideMatchingService.handleDriverConnection(
      socket.id,
      driverData
    );
    
    // Enregistrer dans Redis des connexions
    const driverKey = `${this.DRIVERS_PREFIX}${uid}`;
    await redis.set(driverKey, driverData, this.CONNECTION_TTL);
    
    // Ajouter à la liste des chauffeurs actifs
    await redis.zadd('socket:active_drivers', Date.now(), uid);
    
    console.log(`🚗 Chauffeur ${uid} connecté`);
  }

  async handleDisconnection(socket) {
    const { uid, userType } = socket.user;
    
    console.log(`🔌 Déconnexion: ${socket.id} - ${uid}`);
    
    // Nettoyer la connexion
    await this.removeConnection(socket.id);
    
    // Pour les chauffeurs, marquer comme hors ligne
    if (userType === 'driver') {
      await this.rideMatchingService.handleDriverDisconnection(uid);
      
      const driverKey = `${this.DRIVERS_PREFIX}${uid}`;
      await redis.del(driverKey);
      
      await redis.zrem('socket:active_drivers', uid);
    }
  }

  // ==================== GESTION DES ROOMS ====================

  async joinRoom(socket, roomName) {
    const roomKey = `${this.ROOMS_PREFIX}${roomName}`;
    
    // Ajouter le socket à la room Redis
    await redis.sadd(roomKey, socket.id);
    await redis.expire(roomKey, this.CONNECTION_TTL);
    
    // Mettre à jour la connexion
    const connection = await this.getConnection(socket.id);
    if (connection) {
      connection.rooms = connection.rooms || [];
      if (!connection.rooms.includes(roomName)) {
        connection.rooms.push(roomName);
        await this.saveConnection(socket.id, connection);
      }
    }
    
    // Rejoindre la room Socket.io
    socket.join(roomName);
    
    console.log(`🚪 ${socket.id} a rejoint ${roomName}`);
    socket.emit('room_joined', { roomName });
  }

  async leaveRoom(socket, roomName) {
    const roomKey = `${this.ROOMS_PREFIX}${roomName}`;
    
    // Retirer de Redis
    await redis.srem(roomKey, socket.id);
    
    // Mettre à jour la connexion
    const connection = await this.getConnection(socket.id);
    if (connection && connection.rooms) {
      connection.rooms = connection.rooms.filter(room => room !== roomName);
      await this.saveConnection(socket.id, connection);
    }
    
    // Quitter la room Socket.io
    socket.leave(roomName);
    
    console.log(`🚪 ${socket.id} a quitté ${roomName}`);
    socket.emit('room_left', { roomName });
  }

  // ==================== ÉVÉNEMENTS SOCKET ====================

  setupSocketEventHandlers(socket) {
    // Ping/Pong
    socket.on('ping', async () => {
      await this.updateActivity(socket.id);
      socket.emit('pong', { timestamp: Date.now() });
    });
    
    // Rooms
    socket.on('join_room', async (data) => {
      const { roomName } = data;
      await this.joinRoom(socket, roomName);
    });
    
    socket.on('leave_room', async (data) => {
      const { roomName } = data;
      await this.leaveRoom(socket, roomName);
    });
    
    // Mise à jour position (chauffeurs)
    socket.on('update_location', async (data) => {
      if (socket.user.userType !== 'driver') return;
      
      const driverId = socket.user.uid;
      const location = {
        latitude: data.latitude,
        longitude: data.longitude,
        heading: data.heading,
        speed: data.speed,
        timestamp: Date.now()
      };
      
      // Utiliser RideMatchingService pour la mise à jour
      const result = await this.rideMatchingService.handleDriverLocationUpdate(
        driverId,
        location
      );
      
      if (result.success) {
        socket.emit('location_updated', { success: true });
      } else {
        socket.emit('location_update_error', { error: result.error });
      }
    });
    
    // Mise à jour statut (chauffeurs)
    socket.on('update_status', async (data) => {
      if (socket.user.userType !== 'driver') return;
      
      const driverId = socket.user.uid;
      const { status } = data;
      
      const result = await this.rideMatchingService.handleDriverStatusUpdate(
        driverId,
        status
      );
      
      if (result.success) {
        socket.emit('status_updated', { status });
      }
    });

    // Accepter une course
    socket.on('accept_ride', async (data) => {
      const driverId = socket.user.uid;
      const { rideId } = data;
      
      const result = await this.rideMatchingService.handleDriverAcceptance(
        driverId,
        rideId
      );
      
      socket.emit(result.success ? 'ride_accepted' : 'ride_accept_error', result);
    });

    // Refuser une course
    socket.on('reject_ride', async (data) => {
      const driverId = socket.user.uid;
      const { rideId } = data;
      
      await this.rideMatchingService.handleDriverRejection(driverId, rideId);
      socket.emit('ride_rejected', { rideId });
    });
    
    // Messages privés
    socket.on('private_message', async (data) => {
      const { toUserId, message } = data;
      await this.sendPrivateMessage(socket.user.uid, toUserId, message);
    });
    
    // Déconnexion
    socket.on('disconnect', async (reason) => {
      console.log(`🔌 Déconnexion: ${socket.id} - Raison: ${reason}`);
      await this.handleDisconnection(socket);
    });
    
    // Gestion d'erreur
    socket.on('error', (error) => {
      console.error(`❌ Erreur socket ${socket.id}:`, error);
    });
  }

  // ==================== OPÉRATIONS REDIS ====================

  async saveConnection(socketId, connectionData) {
    const key = `${this.CONNECTIONS_PREFIX}${socketId}`;
    await redis.set(key, connectionData, this.CONNECTION_TTL);
  }

  async getConnection(socketId) {
    const key = `${this.CONNECTIONS_PREFIX}${socketId}`;
    return await redis.get(key);
  }

  async addUserConnection(userId, socketId) {
    const key = `${this.USERS_PREFIX}${userId}`;
    const connections = await redis.get(key) || [];
    
    if (!connections.includes(socketId)) {
      connections.push(socketId);
      await redis.set(key, connections, this.CONNECTION_TTL);
    }
  }

  async removeConnection(socketId) {
    const connection = await this.getConnection(socketId);
    if (!connection) return;
    
    const { userId, userType, rooms } = connection;
    
    // Retirer des rooms Redis
    if (rooms) {
      for (const roomName of rooms) {
        const roomKey = `${this.ROOMS_PREFIX}${roomName}`;
        await redis.srem(roomKey, socketId);
      }
    }
    
    // Retirer de la liste des connexions utilisateur
    const userKey = `${this.USERS_PREFIX}${userId}`;
    const userConnections = await redis.get(userKey) || [];
    const updatedConnections = userConnections.filter(id => id !== socketId);
    
    if (updatedConnections.length > 0) {
      await redis.set(userKey, updatedConnections, this.CONNECTION_TTL);
    } else {
      await redis.del(userKey);
    }
    
    // Supprimer la connexion
    await redis.del(`${this.CONNECTIONS_PREFIX}${socketId}`);
  }

  async updateActivity(socketId) {
    const connection = await this.getConnection(socketId);
    if (connection) {
      connection.lastActiveAt = Date.now();
      await this.saveConnection(socketId, connection);
    }
  }

  // ==================== ÉMISSION D'ÉVÉNEMENTS (pas de logique métier) ====================

  async emitToUser(userId, event, data) {
    const userKey = `${this.USERS_PREFIX}${userId}`;
    const socketIds = await redis.get(userKey) || [];
    
    socketIds.forEach(socketId => {
      this.io.to(socketId).emit(event, data);
    });
    
    return socketIds.length;
  }

  async emitToDriver(driverId, event, data) {
    const driverKey = `${this.DRIVERS_PREFIX}${driverId}`;
    const driverData = await redis.get(driverKey);
    
    if (driverData && driverData.socketId) {
      this.io.to(driverData.socketId).emit(event, data);
      return true;
    }
    
    return false;
  }

  async emitToRoom(roomName, event, data) {
    const roomKey = `${this.ROOMS_PREFIX}${roomName}`;
    const socketIds = await redis.smembers(roomKey) || [];
    
    socketIds.forEach(socketId => {
      this.io.to(socketId).emit(event, data);
    });
    
    return socketIds.length;
  }

  async emitToAllDrivers(event, data, filters = {}) {
    const driverIds = await redis.zrange('socket:active_drivers', 0, -1);
    
    let count = 0;
    for (const driverId of driverIds) {
      const driverKey = `${this.DRIVERS_PREFIX}${driverId}`;
      const driverData = await redis.get(driverKey);
      
      if (driverData && this.matchesFilters(driverData, filters)) {
        this.io.to(driverData.socketId).emit(event, data);
        count++;
      }
    }
    
    return count;
  }

  async sendPrivateMessage(fromUserId, toUserId, message) {
    const userKey = `${this.USERS_PREFIX}${toUserId}`;
    const socketIds = await redis.get(userKey) || [];
    
    socketIds.forEach(socketId => {
      this.io.to(socketId).emit('private_message', {
        fromUserId,
        message,
        timestamp: Date.now()
      });
    });
  }

  // ==================== NOTIFICATIONS DE COURSE ====================

  async notifyDriverForRide(driverId, rideData) {
    const driverKey = `${this.DRIVERS_PREFIX}${driverId}`;
    const driverData = await redis.get(driverKey);
    
    if (!driverData || !driverData.socketId) {
      throw new Error(`Chauffeur ${driverId} non connecté`);
    }
    
    this.io.to(driverData.socketId).emit('ride_request', {
      ...rideData,
      timestamp: Date.now(),
      expiresIn: 20
    });
    
    console.log(`📨 Course notifiée à ${driverId}`);
    return true;
  }

  /*async notifyCustomerDriverAccepted(customerId, driverInfo, rideId) {
    await this.emitToUser(customerId, 'driver_accepted', {
      driver: driverInfo,
      rideId,
      timestamp: Date.now()
    });
  }*/

  /**
   * Informer le client qu'aucun chauffeur n'a été trouvé
   */
  async notifyCustomerNoDrivers(customerId, rideId, data) {
    try {
      this.emitToUser(customerId, 'no_drivers_found', {
        rideId,
        ...data,
        eventType: 'no_drivers_found',
        message: 'Aucun chauffeur disponible pour le moment'
      });
      
      console.log(`📢 ${customerId}: Aucun chauffeur trouvé`);
      return true;
    } catch (error) {
      console.error(`❌ Erreur notification aucun chauffeur:`, error);
      return false;
    }
  }
  /*async notifyCustomerNoDrivers(customerId, rideId) {
    await this.emitToUser(customerId, 'no_drivers_found', {
      rideId,
      timestamp: Date.now(),
      message: 'Aucun chauffeur disponible'
    });
  }*/
  
  /**
   * Informer le client du début du matching
   */
  async notifyMatchingStarted(customerId, rideId, status) {
    try {
      this.emitToUser(customerId, 'ride:matching_started', {
        rideId,
        ...status,
        eventType: 'matching_status',
        timestamp: Date.now()
      });
      console.log(`notification start matching émise`);
      return true;
    } catch (error) {
      console.error(`❌ Erreur notification start matching:`, error);
      return false;
    }
  }

  /**
   * Notifier un client du statut du matching
   */
  /*async notifyMatchingStatus(customerId, rideId, statusData) {
    await this.emitToUser(customerId, 'matching_status', {
      rideId,
      ...statusData,
      timestamp: Date.now()
    });
  }*/
  /**
   * Informer le client de l'état général du matching
   */
  async notifyMatchingStatus(customerId, rideId, status) {
    try {
      this.emitToUser(customerId, 'matching:status_update', {
        rideId,
        ...status,
        eventType: 'matching_status',
        timestamp: Date.now()
      });
      
      return true;
    } catch (error) {
      console.error(`❌ Erreur notification statut matching:`, error);
      return false;
    }
  }


  /**
   * Notifier quand un chauffeur est trouvé
   */
  async notifyDriverFound(customerId, rideId, driverInfo) {
    await this.emitToUser(customerId, 'driver_found', {
      rideId,
      driver: driverInfo,
      timestamp: Date.now()
    });
  }

  /**
   * Notifier du timeout du matching
   */
  async notifyMatchingTimeout(customerId, rideId, timeoutData) {
    await this.emitToUser(customerId, 'matching:timeout', {
      rideId,
      ...timeoutData,
      timestamp: Date.now()
    });
  }

  /**
   * Notifier des alternatives après timeout
   */
  async notifyMatchingAlternatives(customerId, rideId, alternatives) {
    await this.emitToUser(customerId, 'matching_alternatives', {
      rideId,
      alternatives,
      timestamp: Date.now()
    });
  }

  /**
   * Notifier des mises à jour de chauffeurs disponibles
   */
  async notifyDriverAvailabilityUpdate(customerId, rideId, updateData) {
    await this.emitToUser(customerId, 'drivers_availability_update', {
      rideId,
      ...updateData,
      timestamp: Date.now()
    });
  }

  /**
   * Mettre à jour la position du chauffeur
   */
  async notifyDriverLocationUpdate(customerId, rideId, location) {
    try {
      this.emitToUser(customerId, 'driver_location_update', {
        rideId,
        ...location,
        eventType: 'driver_location_update',
        timestamp: Date.now()
      });
      
      return true;
    } catch (error) {
      console.error(`❌ Erreur notification position:`, error);
      return false;
    }
  }
  /**
   * Notifier la position du chauffeur assigné
   */
  /*async notifyDriverLocationUpdate(customerId, rideId, location) {
    await this.emitToUser(customerId, 'driver_location_update', {
      rideId,
      location,
      timestamp: Date.now()
    });
  }*/

  /**
   * Notifier l'ETA mise à jour
   */
  async notifyEtaUpdate(customerId, rideId, eta) {
    await this.emitToUser(customerId, 'eta_update', {
      rideId,
      eta,
      timestamp: Date.now()
    });
  }

  /**
   * Informer le client qu'un chauffeur est en cours de notification
   */
  async notifyCustomerDriverNotificationStarted(customerId, rideId, data) {
    try {
      this.emitToUser(customerId, 'driver_notification_started', {
        rideId,
        ...data,
        eventType: 'driver_notification_started'
      });
      
      console.log(`📢 ${customerId}: Notification démarrage chauffeur ${data.driverId}`);
      return true;
    } catch (error) {
      console.error(`❌ Erreur notification démarrage chauffeur:`, error);
      return false;
    }
  }

  /**
   * Informer le client qu'un chauffeur a été notifié
   */
  async notifyCustomerDriverNotified(customerId, rideId, driverInfo) {
    try {
      this.emitToUser(customerId, 'driver_notified', {
        rideId,
        ...driverInfo,
        eventType: 'driver_notified',
        timestamp: Date.now()
      });
      
      console.log(`📢 ${customerId}: Chauffeur ${driverInfo.driverId} notifié`);
      return true;
    } catch (error) {
      console.error(`❌ Erreur notification chauffeur notifié:`, error);
      return false;
    }
  }

  /**
   * Informer le client d'un échec de notification
   */
  async notifyCustomerDriverNotificationFailed(customerId, rideId, data) {
    try {
      this.emitToUser(customerId, 'driver_notification_failed', {
        rideId,
        ...data,
        eventType: 'driver_notification_failed'
      });
      
      console.log(`📢 ${customerId}: Échec notification chauffeur ${data.driverId}`);
      return true;
    } catch (error) {
      console.error(`❌ Erreur notification échec:`, error);
      return false;
    }
  }

  /**
   * Informer le client d'un timeout
   */
  async notifyCustomerDriverTimeout(customerId, rideId, timeoutInfo) {
    try {
      this.emitToUser(customerId, 'driver_timeout', {
        rideId,
        ...timeoutInfo,
        eventType: 'driver_timeout'
      });
      
      console.log(`📢 ${customerId}: Timeout chauffeur ${timeoutInfo.driverId}`);
      return true;
    } catch (error) {
      console.error(`❌ Erreur notification timeout:`, error);
      return false;
    }
  }

  /**
   * Informer le client d'un refus
   */
  async notifyCustomerDriverRejected(customerId, rideId, rejectionInfo) {
    try {
      this.emitToUser(customerId, 'driver_rejected', {
        rideId,
        ...rejectionInfo,
        eventType: 'driver_rejected'
      });
      
      console.log(`📢 ${customerId}: Refus chauffeur ${rejectionInfo.driverId}`);
      return true;
    } catch (error) {
      console.error(`❌ Erreur notification refus:`, error);
      return false;
    }
  }

  /**
   * Informer le client d'une acceptation
   */
  async notifyCustomerDriverAccepted(customerId, rideId, driverInfo) {
    try {
      this.emitToUser(customerId, 'driver_accepted', {
        rideId,
        ...driverInfo,
        eventType: 'driver_accepted'
      });
      
      console.log(`📢 ${customerId}: Acceptation chauffeur ${driverInfo.driverId}`);
      return true;
    } catch (error) {
      console.error(`❌ Erreur notification acceptation:`, error);
      return false;
    }
  }



  // ==================== UTILITAIRES ====================

  matchesFilters(driverData, filters) {
    if (!filters) return true;
    
    if (filters.status && driverData.driverStatus !== filters.status) {
      return false;
    }
    
    if (filters.vehicleType && driverData.vehicleType !== filters.vehicleType) {
      return false;
    }
    
    return true;
  }

  // ==================== MAINTENANCE ====================

  startCleanupInterval() {
    // Nettoyage des connexions inactives
    setInterval(async () => {
      await this.cleanupInactiveConnections();
    }, 5 * 60 * 1000); // Toutes les 5 minutes
  }

  async cleanupInactiveConnections(maxInactiveMinutes = 30) {
    const pattern = `${this.CONNECTIONS_PREFIX}*`;
    const connectionKeys = await redis.keys(pattern);
    
    let cleanedCount = 0;
    const cutoffTime = Date.now() - (maxInactiveMinutes * 60 * 1000);
    
    for (const key of connectionKeys) {
      const connection = await redis.get(key);
      if (connection && connection.lastActiveAt < cutoffTime) {
        const socketId = key.replace(this.CONNECTIONS_PREFIX, '');
        
        // Nettoyer proprement
        const socket = this.io.sockets.sockets.get(socketId);
        if (socket) {
          socket.disconnect(true);
        }
        
        await this.removeConnection(socketId);
        cleanedCount++;
      }
    }
    
    if (cleanedCount > 0) {
      console.log(`🧹 ${cleanedCount} connexions inactives nettoyées`);
    }
    
    return cleanedCount;
  }

  // ==================== STATISTIQUES ====================

  async getStats() {
    const totalConnections = await redis.keys(`${this.CONNECTIONS_PREFIX}*`);
    const totalUsers = await redis.keys(`${this.USERS_PREFIX}*`);
    const totalDrivers = await redis.keys(`${this.DRIVERS_PREFIX}*`);
    const totalRooms = await redis.keys(`${this.ROOMS_PREFIX}*`);
    
    const driverStats = await DriverSearchService.getDriverStats();
    
    return {
      totalConnections: totalConnections.length,
      totalUsers: totalUsers.length,
      totalDrivers: totalDrivers.length,
      totalRooms: totalRooms.length,
      driverStats,
      timestamp: Date.now()
    };
  }

  // ==================== GETTERS ====================

  getIO() {
    return this.io;
  }

  /*getDriverSearchService() {
    return DriverSearchService;
  }*/

  // Méthode utilitaire pour RideMatchingService
  getRideMatchingService() {
    return this.rideMatchingService;
  }
}

module.exports = SocketService;




//////////////////////// OLD IMPLEMENTATION ///////////////////////////////


/*// services/SocketService.js
// Dans votre service Socket.IO ou dans le contrôleur des courses
const RideRoutingService = require('../services/RideRoutingService');

class SocketService {
  constructor(io) {
    this.io = io;
    this.driverSockets = new Map(); // driverId -> socketId
    this.customerSockets = new Map(); // customerId -> socketId
    //this.unknownSockets = new Map(); // pour les reconnexions 
    this.setupSocketHandlers();
  }

  setupSocketHandlers() {
    this.io.on('connection', (socket) => {
      console.log(`🔌 Nouvelle connexion Socket.IO: ${socket.id}`);
      // Nous enregistrons tous les sockets connectés
      //this.unknownSockets.set(socket.id, socket.id);
      // Enregistrement chauffeur se fait lorsque le chauffeur se met en ligne
      socket.on('driver_register', (data) => {
        const { driverId, location, status = 'offline' } = data;
        this.driverSockets.set(driverId, socket.id);
        console.log(`🚗 Chauffeur ${driverId} enregistré (socket: ${socket.id})`);
      });

      // Enregistrement client lorsque le client commande une course
      socket.on('customer_register', (data) => {
        const { customerId } = data;
        this.customerSockets.set(customerId, socket.id);
        console.log(`👤 Client ${customerId} enregistré (socket: ${socket.id})`);
      });

      // Changement de statut online du chauffeur
      socket.on('driver_online_status_changed', (data) => {
        try {
          const { driverId, isOnline } = data;
          console.log(`🔄 evenement driver_online_status_changed Chauffeur ${driverId} est change son status en ligne : ${isOnline ? 'connecté' : 'deconnecté'}`);
          
          this.changeDriverOnlineStatus(driverId, isOnline, socket.id);
          
        } catch (error) {
          console.error('Error updating driver online status:', error);
        }
      });

      // Déconnexion
      socket.on('disconnect', () => {
        this.removeSocket(socket.id);
        console.log(`🔌 Déconnexion: ${socket.id}`);
      });
      /*socket.on('disconnect', () => {
        this.handleDriverDisconnection(socket.id);
        console.log(`🔌 Déconnexion: ${socket.id}`);
      });* /
    });
  }

  async changeDriverOnlineStatus(driverId, isOnline, socketId) {
    if(isOnline) {
      console.log(`📴 Chauffeur ${driverId} connecté car il passe en ligne`);
      this.driverSockets.set(driverId, socketId);
    } else {
      // on déconnecte le chauffeur
      if(this.driverSockets.has(driverId)) {
        //await this.handleDriverDisconnectionRides(driverId); // normalement la déconnexion ne devrait pas se faire
        // Retirer des mappings
        console.log(`📴 Chauffeur ${driverId} déconnecté par il passe hors ligne`);
        this.driverSockets.delete(driverId);
      }
    }
  }

  async handleDriverDisconnection(socketId) {
    // Trouver le chauffeur correspondant au socket
    for (const [driverId, driverSocketId] of this.driverSockets.entries()) {
      if (driverSocketId === socketId) {
        console.log(`📴 Chauffeur ${driverId} déconnecté`);
        
        // Mettre à jour le statut
        this.updateDriverStatus(driverId, 'offline', null, 'Déconnexion inattendue');
        
        // Gérer les courses en cours
        await this.handleDriverDisconnectionRides(driverId);
        
        // Retirer des mappings
        this.driverSockets.delete(driverId);
        break;
      }
    }

    // Retirer aussi des clients (code existant)
    this.removeSocket(socketId);
  }

  async handleDriverDisconnectionRides(driverId) {
    try {
      // Trouver les courses actives de ce chauffeur
      const activeRides = await Ride.findActiveRidesByDriver(driverId); // À adapter selon votre modèle
      
      for (const ride of activeRides) {
        // Notifier le client de la déconnexion du chauffeur
        this.notifyCustomerCancellation(
          ride.customerId, 
          ride.id, 
          false, 
          'Chauffeur déconnecté'
        );
        
        // Réassigner la course ou la marquer comme annulée
        await this.handleRideReassignment(ride.id);
      }
    } catch (error) {
      console.error('Error handling driver disconnection rides:', error);
    }
  }

  // === MÉTHODES UTILITAIRES POUR LES STATUTS ===

  // notifie le chauffeur d'une demande de course en cours
  async notifySingleDriver(driver, rideRequest) {
    const socketId = this.driverSockets.get(driver.driverId);
    
    if (!socketId) {
      console.log(`❌ Chauffeur ${driver.driverId} non connecté`);
      return false;
    }

    try {
      // rideRequest est crée dans rideController
      this.io.to(socketId).emit('ride_request', {
        id: rideRequest.rideId,
        customerId: rideRequest.customerId,
        pickupLocation: rideRequest.pickupLocation,
        destinationLocation: rideRequest.destination,
        rideTypeId: rideRequest.rideTypeId,
        //customerRating: rideRequest.customerRating,
        distance: rideRequest.distance,
        duration: rideRequest.duration,
        fare: rideRequest.estimatedFare,
        requestedAt: rideRequest.requestedAt,
        status: rideRequest.status,
        expiresIn: 20, // 20 secondes pour répondre
        driverEta: driver.eta,
        distanceToPickup: driver.distance,
        /*customerInfo: {
          // Informations basiques du client (sans données sensibles)
        }* /
      });

      console.log(`📨 Notification envoyée au chauffeur ${driver.driverId}`);
	  
      return true;

    } catch (error) {
      console.error(`Erreur envoi notification chauffeur ${driver.driverId}:`, error);
      return false;
    }
  }

  async notifyCustomerAssignment(customerId, driverInfo, rideId) {
    const socketId = this.customerSockets.get(customerId);
    
    if (!socketId) {
      console.log(`❌ Client ${customerId} non connecté pour l'assignation`);
      return;
    }

    try {
      this.io.to(socketId).emit('driver_assigned', {
        rideId,
        driver: driverInfo,
        eta: driverInfo.eta,
        vehicle: driverInfo.vehicle,
        assignedAt: new Date().toISOString()
      });

      console.log(`✅ Client ${customerId} notifié de l'assignation du chauffeur ${driverInfo.driverId}`);

    } catch (error) {
      console.error(`Erreur notification assignation client ${customerId}:`, error);
    }
  }

  notifyQueueStatus(customerId, queueStatus) {
    const socketId = this.customerSockets.get(customerId);
    
    if (!socketId) return;

    try {
      this.io.to(socketId).emit('matching_status', {
        status: 'searching',
        queuePosition: queueStatus.queuePosition,
        estimatedWaitTime: queueStatus.estimatedWaitTime,
        currentDriverResponseTime: 20,
        driversNotified: queueStatus.notifiedDrivers,
        driversAvailable: queueStatus.driversAvailable,
        timestamp: new Date().toISOString(),
        message: this.getQueueMessage(queueStatus)
      });

    } catch (error) {
      console.error(`Erreur notification statut file d'attente:`, error);
    }
  }

  removeSocket(socketId) {
    // Retirer des mappings chauffeurs
    for (const [driverId, id] of this.driverSockets.entries()) {
      if (id === socketId) {
        this.driverSockets.delete(driverId);
        break;
      }
    }

    // Retirer des mappings clients
    for (const [customerId, id] of this.customerSockets.entries()) {
      if (id === socketId) {
        this.customerSockets.delete(customerId);
        break;
      }
    }
  }

  notifyCustomerNoDrivers(customerId, rideId) {
    const socketId = this.customerSockets.get(customerId);
    
    if (!socketId) return;

    try {
      this.io.to(socketId).emit('matching_failed', {
        rideId,
        reason: 'Aucun chauffeur disponible',
        timestamp: new Date().toISOString(),
        message: 'Aucun chauffeur disponible pour le moment. Veuillez réessayer.'
      });

      console.log(`❌ Client ${customerId} notifié: aucun chauffeur disponible par le signal matching_failed`);

    } catch (error) {
      console.error(`Erreur notification échec matching:`, error);
    }
  }

  replaceSocket(userId, oldSocketId, newSocketId) {
    if(this.driverSockets.has(userId)) {
      this.driverSockets.set(userId, newSocketId);
    } else if (this.customerSockets.has(userId)) {
      this.customerSockets.set(userId, newSocketId);
    }
  }

  // Méthodes utilitaires pour le débogage
  getConnectedDrivers() {
    return Array.from(this.driverSockets.keys());
  }

  getConnectedCustomers() {
    return Array.from(this.customerSockets.keys());
  }
}

module.exports = SocketService;
/*module.exports = (io) => {
	new SocketService(io);
};*/