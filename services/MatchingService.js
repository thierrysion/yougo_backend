// services/MatchingService.js
const { sequelize, Driver, Ride, RideType, User } = require('../models');
const DriverReservationService = require('./DriverReservationService');
const RideQueueService = require('./RideQueueService');

class MatchingService {
  constructor(socketService) {
    this.reservationService = new DriverReservationService();
    this.rideQueueService = new RideQueueService();
    this.socketService = socketService;
    
    this.rideStates = new Map(); // rideId -> matchingState
    this.driverTimeouts = new Map(); // rideId -> Map(driverId -> timeout)
    
    this.DRIVER_RESPONSE_TIMEOUT = 20000; // 20 secondes
    
    // Démarrer le nettoyage périodique
    this.reservationService.startCleanupInterval();
    this.startStateCleanupInterval();
  }

  async initiateSequentialMatching(rideRequest) {
    try {
      console.log(`🚀 Début du matching séquentiel pour la course ${rideRequest.rideId}`);
      
      const availableDrivers = await this.findAvailableDrivers(rideRequest);
      
      if (availableDrivers.length === 0) {
        console.log(`❌ Aucun chauffeur disponible pour la course ${rideRequest.rideId}`);
        return { 
          success: false, 
          error: "Aucun chauffeur disponible dans la zone" 
        };
      }

      console.log(`📊 ${availableDrivers.length} chauffeurs disponibles pour la course ${rideRequest.rideId}`);

      // État du matching pour cette course
      const matchingState = {
        rideRequest,
        availableDrivers: availableDrivers.sort((a, b) => b.score - a.score),
        currentDriverIndex: 0,
        status: 'searching',
        notifiedDrivers: [],
        createdAt: new Date(),
        customerId: rideRequest.customerId
      };

      this.rideStates.set(rideRequest.rideId, matchingState);
      this.rideQueueService.addToQueue(rideRequest.rideId, matchingState);

      // Démarrer la notification séquentielle
      await this.notifyNextDriver(rideRequest.rideId);

      const queueStatus = this.rideQueueService.getQueueStatus(rideRequest.rideId);

      return {
        success: true,
        searchRadius: rideRequest.constraints.searchRadius,
        totalDriversAvailable: availableDrivers.length,
        estimatedWaitTime: queueStatus.estimatedWaitTime,
        queuePosition: queueStatus.queuePosition
      };

    } catch (error) {
      console.error('Erreur lors du matching séquentiel:', error);
      throw error;
    }
  }

  async findAvailableDrivers(rideRequest) {
    const { pickupLocation, rideTypeId, constraints } = rideRequest;
    
    try {
      // Requête SQL pour trouver les chauffeurs disponibles avec calcul de distance
      const drivers = await Driver.findAll({
        where: {
          driver_status: 'approved',
          is_online: true,
          ride_type_id: rideTypeId
        },
        include: [
          {
            model: User,
            as: 'user',
            where: { status: 'active' },
            attributes: ['uid', 'first_name', 'last_name', 'profile_picture_url']
          }
        ],
        attributes: {
          include: [
            [
              // Calcul de distance approximative (simplifié)
			  //[
				sequelize.literal('ST_Distance(ST_SetSRID(current_location, 4326), ST_SetSRID(ST_MakePoint(' + pickupLocation.longitude + ', ' + pickupLocation.latitude + '), 4326) ) / 1000'), 'distance_km',
			  //],
            ]
          ]
        }
      });

      // Filtrage par distance et scoring
      const availableDrivers = drivers
        .filter(driver => {
          const distance = parseFloat(driver.get('distance_km'));
          console.log(`Chauffeur ${driver.user_id} à ${distance.toFixed(2) } km`);
          return distance <= (constraints.searchRadius || 5); // 5km par défaut
        })
        .map(driver => this.calculateDriverScore(driver, rideRequest));

      return availableDrivers.filter(driver => !this.reservationService.isDriverReserved(driver.driverId));

    } catch (error) {
      console.error('Erreur recherche chauffeurs:', error);
      return [];
    }
  }

  calculateDriverScore(driver, rideRequest) {
    const distance = parseFloat(driver.get('distance_km'));
    const rating = parseFloat(driver.driver_rating) || 4.0;
    const acceptanceRate = parseFloat(driver.acceptance_rate) || 50;
    const experience = parseInt(driver.years_of_experience) || 0;
    const totalRides = parseInt(driver.total_completed_rides) || 0;

    // Calcul du score (0-100)
    const distanceScore = Math.max(0, 50 - (distance * 10)); // Moins de distance = meilleur score
    const ratingScore = (rating - 1) * 25; // 1→0, 5→100
    const acceptanceScore = Math.min(100, acceptanceRate);
    const experienceScore = Math.min(20, experience * 2);
    const volumeScore = Math.min(10, totalRides / 50);

    const totalScore = distanceScore * 0.4 + 
                      ratingScore * 0.2 + 
                      acceptanceScore * 0.15 + 
                      experienceScore * 0.15 + 
                      volumeScore * 0.1;

    return {
      driverId: driver.user_id,
      userId: driver.user.uid,
      distance,
      eta: Math.round(distance * 3 + 2), // Estimation simplifiée (distance × 3 + 2min)
      score: Math.round(totalScore),
      vehicle: {
        make: driver.vehicle_make,
        model: driver.vehicle_model,
        color: driver.vehicle_color,
        licensePlate: driver.license_plate,
        year: driver.vehicle_year
      },
      driverInfo: {
        firstName: driver.user.first_name,
        lastName: driver.user.last_name,
        profilePicture: driver.user.profile_picture_url,
        rating,
        totalRides,
        acceptanceRate,
        experience
      }
    };
  }

  async notifyNextDriver(rideId) {
    const matchingState = this.rideStates.get(rideId);
    
    if (!matchingState || matchingState.status !== 'searching') {
      console.log(`⏹️ Matching arrêté pour la course ${rideId}`);
      return;
    }

    const nextDriver = this.findNextAvailableDriver(matchingState);
    
    if (!nextDriver) {
      console.log(`❌ Plus de chauffeurs disponibles pour la course ${rideId}`);
      matchingState.status = 'failed';
      this.rideQueueService.updateRideState(rideId, { status: 'failed' });
      this.notifyCustomerNoDrivers(rideId);
      return;
    }

    try {
      // Réserver le chauffeur
      await this.reservationService.reserveDriver(nextDriver.driverId, rideId);
      
      // Mettre à jour l'état
      matchingState.currentDriverIndex++;
      matchingState.notifiedDrivers.push({
        driverId: nextDriver.driverId,
        notifiedAt: new Date(),
        status: 'notified'
      });

      this.rideQueueService.updateRideState(rideId, matchingState);

      // Notifier le chauffeur
      const notified = await this.socketService.notifySingleDriver(nextDriver, matchingState.rideRequest);
      
      if (!notified) {
        // Chauffeur déconnecté - libérer et passer au suivant
        this.reservationService.releaseDriver(nextDriver.driverId);
        setTimeout(() => this.notifyNextDriver(rideId), 500);
        return;
      }

      console.log(`📨 Chauffeur ${nextDriver.driverId} notifié pour la course ${rideId}`);

      // Démarrer le timeout pour ce chauffeur
      this.startDriverResponseTimeout(nextDriver.driverId, rideId);

      // Notifier le client du statut
      this.socketService.notifyQueueStatus(
        matchingState.customerId, 
        this.rideQueueService.getQueueStatus(rideId)
      );

    } catch (error) {
      console.error(`Erreur notification chauffeur ${nextDriver.driverId}:`, error);
      this.reservationService.releaseDriver(nextDriver.driverId);
      setTimeout(() => this.notifyNextDriver(rideId), 500);
    }
  }

  findNextAvailableDriver(matchingState) {
    for (let i = matchingState.currentDriverIndex; i < matchingState.availableDrivers.length; i++) {
      const driver = matchingState.availableDrivers[i];
      if (!this.reservationService.isDriverReserved(driver.driverId)) {
        return driver;
      }
    }
    return null;
  }

  startDriverResponseTimeout(driverId, rideId) {
    const timeoutId = setTimeout(() => {
      console.log(`⏰ Timeout 20s dépassé - Chauffeur ${driverId} - Course ${rideId}`);
      this.handleDriverTimeout(driverId, rideId);
      this.clearDriverTimeout(driverId, rideId);
    }, this.DRIVER_RESPONSE_TIMEOUT);

    if (!this.driverTimeouts.has(rideId)) {
      this.driverTimeouts.set(rideId, new Map());
    }
    this.driverTimeouts.get(rideId).set(driverId, timeoutId);
  }

  async handleDriverAcceptance(driverId, rideId) {
    const matchingState = this.rideStates.get(rideId);
    
    if (!matchingState || matchingState.status !== 'searching') {
      console.log(`❌ Course ${rideId} n'est plus disponible pour le chauffeur ${driverId}`);
      return { 
        success: false, 
        error: "La course n'est plus disponible" 
      };
    }

    console.log(`✅ Chauffeur ${driverId} accepte la course ${rideId}`);

    try {
      // 1. Libérer la réservation
      this.reservationService.releaseDriver(driverId);

      // 2. Arrêter tous les timeouts en cours pour cette course
      this.clearAllTimeoutsForRide(rideId);

      // 3. Marquer comme accepté
      matchingState.status = 'accepted';
      matchingState.selectedDriver = driverId;
      matchingState.acceptedAt = new Date();

      // 4. Mettre à jour le statut du chauffeur dans la liste notifiée
      const notifiedDriver = matchingState.notifiedDrivers.find(d => d.driverId === driverId);
      if (notifiedDriver) {
        notifiedDriver.status = 'accepted';
        notifiedDriver.respondedAt = new Date();
      }

      this.rideQueueService.updateRideState(rideId, matchingState);

      // 5. Notifier le client
      const driverInfo = matchingState.availableDrivers.find(d => d.driverId === driverId);
      await this.socketService.notifyCustomerAssignment(matchingState.customerId, driverInfo, rideId);

      // 6. Mettre à jour la base de données
      await this.updateRideWithDriver(rideId, driverId);

      // 7. Nettoyer l'état après un délai
      setTimeout(() => {
        this.rideStates.delete(rideId);
        this.rideQueueService.removeFromQueue(rideId);
      }, 60000);

      return { 
        success: true, 
        rideId,
        driver: driverInfo 
      };

    } catch (error) {
      console.error('Erreur acceptation chauffeur:', error);
      return { success: false, error: error.message };
    }
  }

  async handleDriverRejection(driverId, rideId) {
    console.log(`❌ Chauffeur ${driverId} refuse la course ${rideId}`);
    
    const matchingState = this.rideStates.get(rideId);
    if (!matchingState) return;

    // 1. Libérer la réservation
    this.reservationService.releaseDriver(driverId);

    // 2. Mettre à jour le statut du chauffeur
    const notifiedDriver = matchingState.notifiedDrivers.find(d => d.driverId === driverId);
    if (notifiedDriver) {
      notifiedDriver.status = 'rejected';
      notifiedDriver.respondedAt = new Date();
    }

    this.rideQueueService.updateRideState(rideId, matchingState);

    // 3. Passer au chauffeur suivant après un court délai
    setTimeout(() => {
      this.notifyNextDriver(rideId);
    }, 500);
  }

  handleDriverTimeout(driverId, rideId) {
    const matchingState = this.rideStates.get(rideId);
    if (!matchingState) return;

    console.log(`🔄 Timeout - Passage au chauffeur suivant pour la course ${rideId}`);
    
    // Libérer la réservation
    this.reservationService.releaseDriver(driverId);

    // Mettre à jour le statut du chauffeur timeout
    const notifiedDriver = matchingState.notifiedDrivers.find(d => d.driverId === driverId);
    if (notifiedDriver) {
      notifiedDriver.status = 'timeout';
      notifiedDriver.respondedAt = new Date();
    }

    this.rideQueueService.updateRideState(rideId, matchingState);

    // Passer au chauffeur suivant
    setTimeout(() => {
      this.notifyNextDriver(rideId);
    }, 500);
  }

  clearDriverTimeout(driverId, rideId) {
    const rideTimeouts = this.driverTimeouts.get(rideId);
    if (rideTimeouts && rideTimeouts.has(driverId)) {
      clearTimeout(rideTimeouts.get(driverId));
      rideTimeouts.delete(driverId);
    }
  }

  clearAllTimeoutsForRide(rideId) {
    const rideTimeouts = this.driverTimeouts.get(rideId);
    if (rideTimeouts) {
      for (const [driverId, timeout] of rideTimeouts) {
        clearTimeout(timeout);
      }
      this.driverTimeouts.delete(rideId);
    }
  }

  async updateRideWithDriver(rideId, driverId) {
    try {
      await Ride.update(
        {
          driver_id: driverId,
          status: 'accepted',
          accepted_at: new Date()
        },
        { where: { id: rideId } }
      );
      console.log(`📝 Course ${rideId} assignée au chauffeur ${driverId}`);
    } catch (error) {
      console.error('Erreur mise à jour course:', error);
      throw error;
    }
  }

  notifyCustomerNoDrivers(rideId) {
    const matchingState = this.rideStates.get(rideId);
    if (matchingState) {
      this.socketService.notifyCustomerNoDrivers(matchingState.customerId, rideId);
      this.rideStates.delete(rideId);
      this.rideQueueService.removeFromQueue(rideId);
    }
  }

  startStateCleanupInterval() {
    // Nettoyer les états de matching orphelins
    setInterval(() => {
      const now = new Date();
      let cleanedCount = 0;
      
      for (const [rideId, state] of this.rideStates.entries()) {
        // Supprimer les états vieux de plus de 30 minutes
        if (now - state.createdAt > 30 * 60 * 1000) {
          this.rideStates.delete(rideId);
          this.rideQueueService.removeFromQueue(rideId);
          this.clearAllTimeoutsForRide(rideId);
          cleanedCount++;
        }
      }
      
      if (cleanedCount > 0) {
        console.log(`🧹 Nettoyage: ${cleanedCount} états de matching expirés`);
      }
    }, 5 * 60 * 1000); // Toutes les 5 minutes
  }

  // Méthode utilitaire pour le débogage
  getMatchingStatus(rideId) {
    const state = this.rideStates.get(rideId);
    const queue = this.rideQueueService.getQueueStatus(rideId);
    
    return {
      state: state ? {
        status: state.status,
        notifiedDrivers: state.notifiedDrivers.length,
        availableDrivers: state.availableDrivers.length,
        currentDriverIndex: state.currentDriverIndex
      } : null,
      queue
    };
  }
}

module.exports = MatchingService;