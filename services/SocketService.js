// services/SocketService.js
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
      socket.on('driver_register', (/*driverId*/data) => {
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
      });*/
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
        }*/
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