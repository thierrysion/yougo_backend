// services/RideMatchingService.js
const redis = require('../config/redis');
const { sequelize, Driver, Ride, User } = require('../models');
const { Op } = require('sequelize');
const RedisIntervalManager = require('./RedisIntervalManager');

class RideMatchingServiceOld {
  constructor(socketService) {
    this.socketService = socketService;
    this.intervalManager = RedisIntervalManager;
    
    // Sous-services
    this.driverDiscovery = new DriverDiscovery();
    this.driverReservation = new DriverReservation();
    this.continuousMatching = new ContinuousMatching(this, this.intervalManager);
    
    // Configuration
    this.MATCHING_DURATION = 300; // 5 minutes
    this.DRIVER_RESPONSE_TIMEOUT = 20; // 20 secondes
    this.SEARCH_RADIUS_KM = 5;
    
    // Initialisation
    this.setupCleanupIntervals();
    
    // Nettoyage au démarrage
    this.initializeInstance();
  }

  // ==================== API PRINCIPALE ====================

  /**
   * Démarrer le matching pour une course
   */
  async startMatching(rideRequest) {
    try {
      console.log(`🚀 Début matching pour course ${rideRequest.rideId}`);
      
      // 1. Vérifier les prérequis
      this.validateRideRequest(rideRequest);
      
      // 2. Initialiser l'état du matching
      const matchingState = {
        rideId: rideRequest.rideId,
        customerId: rideRequest.customerId,
        pickupLocation: rideRequest.pickupLocation,
        rideTypeId: rideRequest.rideTypeId,
        status: 'searching',
        createdAt: Date.now(),
        expiresAt: Date.now() + (this.MATCHING_DURATION * 1000),
        notifiedDrivers: [],
        availableDrivers: [],
        searchRadius: rideRequest.constraints?.searchRadius || this.SEARCH_RADIUS_KM
      };
      
      // 3. Sauvegarder l'état
      await this.saveMatchingState(rideRequest.rideId, matchingState);
      
      // 4. Démarrer la recherche continue
      await this.continuousMatching.start(rideRequest.rideId, rideRequest);
      
      // Notifier le client que le matching a démarré
      await this.socketService.notifyMatchingStatus(
        rideRequest.customerId,
        rideRequest.rideId,
        {
          status: 'searching',
          message: 'Recherche de chauffeurs en cours',
          estimatedWaitTime: 300, // 5 minutes
          searchRadius: rideRequest.constraints?.searchRadius || 5
        }
      );

      // Démarrer les mises à jour périodiques
      this.startMatchingUpdates(rideRequest.rideId, rideRequest.customerId);

      // 5. Retourner le statut initial
      const queueStatus = await this.getQueueStatus(rideRequest.rideId);
      
      return {
        success: true,
        rideId: rideRequest.rideId,
        matchingStarted: true,
        duration: this.MATCHING_DURATION,
        queueStatus
      };
      
    } catch (error) {
      console.error('Erreur démarrage matching:', error);
      throw error;
    }
  }

  /**
   * Démarrer les mises à jour périodiques pour le client (multi-instances safe)
   */
  async startMatchingUpdates(rideId, customerId) {
    console.log(`🔄 Démarrage mises à jour matching multi-instance pour ${rideId}`);

    const intervalKey = `matching:${rideId}`;

    // Vérifier si des mises à jour sont déjà en cours (dans n'importe quelle instance)
    const existingIntervals = await redis.smembers(`intervals:key:${intervalKey}`) || [];
    
    if (existingIntervals.length > 0) {
      console.log(`⚠️  Mises à jour déjà en cours pour ${rideId} dans ${existingIntervals.length} instance(s)`);
      return;
    }

    // Créer l'intervalle géré par Redis
    const intervalId = await this.intervalManager.createInterval(
      intervalKey,
      async () => {
        await this.executeMatchingUpdate(rideId, customerId);
      },
      10000, // 10 secondes
      { rideId, customerId }
    );
    
    console.log(`✅ Mises à jour démarrées pour ${rideId} (intervalId: ${intervalId})`);

    /*// Intervalle pour les mises à jour de statut
    const updateInterval = setInterval(async () => {
      try {
        const matchingState = await this.getMatchingState(rideId);
        
        if (!matchingState || matchingState.status !== 'searching') {
          clearInterval(updateInterval);
          return;
        }

        // Envoyer une mise à jour de statut
        await this.socketService.notifyMatchingStatus(
          customerId,
          rideId,
          {
            status: matchingState.status,
            elapsedTime: Math.floor((Date.now() - matchingState.createdAt) / 1000),
            remainingTime: Math.floor((matchingState.expiresAt - Date.now()) / 1000),
            driversNotified: matchingState.notifiedDrivers.length,
            driversAvailable: matchingState.availableDrivers.length,
            currentDriverIndex: matchingState.currentDriverIndex
          }
        );

        // Si des nouveaux chauffeurs sont disponibles, notifier
        if (matchingState.newDriversAvailable > 0) {
          await this.socketService.notifyDriverAvailabilityUpdate(
            customerId,
            rideId,
            {
              newDriversFound: matchingState.newDriversAvailable,
              totalAvailable: matchingState.availableDrivers.length
            }
          );
        }

      } catch (error) {
        console.error('Erreur mises à jour matching:', error);
      }
    }, 10000); // Toutes les 10 secondes

    // Stocker l'intervalle pour nettoyage
    this.matchingIntervals.set(rideId, updateInterval);*/
  }

  /**
   * Exécuter une mise à jour de matching
   */
  async executeMatchingUpdate(rideId, customerId) {
    try {
      const matchingState = await this.getMatchingState(rideId);
      
      if (!matchingState || matchingState.status !== 'searching') {
        console.log(`⏹️  Arrêt mises à jour pour ${rideId}`);
        await this.stopMatchingUpdates(rideId);
        return;
      }
      
      // ... logique de mise à jour existante ...
      const updateData = {
        status: matchingState.status,
        elapsedTime: Math.floor((Date.now() - matchingState.createdAt) / 1000),
        remainingTime: Math.floor((matchingState.expiresAt - Date.now()) / 1000),
        driversNotified: matchingState.notifiedDrivers.length,
        driversAvailable: matchingState.availableDrivers.length,
        currentDriverIndex: matchingState.currentDriverIndex
      };
      
      await this.socketService.notifyMatchingStatus(customerId, rideId, updateData);

      // Si des nouveaux chauffeurs sont disponibles, notifier
        if (matchingState.newDriversAvailable > 0) {
            await this.socketService.notifyDriverAvailabilityUpdate(
            customerId,
            rideId,
            {
                newDriversFound: matchingState.newDriversAvailable,
                totalAvailable: matchingState.availableDrivers.length
            }
            );
        }
      
    } catch (error) {
      console.error(`❌ Erreur mise à jour matching ${rideId}:`, error);
    }
  }

  /**
   * Arrêter les mises à jour pour une course
   */
  async stopMatchingUpdates(rideId) {
    const intervalKey = `matching:${rideId}`;
    await this.intervalManager.clearIntervalsByKey(intervalKey);
  }

  /**
   * Démarrer les mises à jour de position (multi-instances safe)
   */
  async startDriverLocationUpdates(rideId, driverId, customerId) {
    const intervalKey = `location:${rideId}:${driverId}`;
    
    // Vérifier si déjà en cours
    const existingIntervals = await redis.smembers(`intervals:key:${intervalKey}`) || [];
    
    if (existingIntervals.length > 0) {
      console.log(`⚠️  Mises à jour position déjà en cours pour ${driverId}`);
      return;
    }
    
    // Créer l'intervalle
    await this.intervalManager.createInterval(
      intervalKey,
      async () => {
        await this.executeLocationUpdate(rideId, driverId, customerId);
      },
      5000, // 5 secondes
      { rideId, driverId, customerId }
    );
  }

  /**
   * Exécuter une mise à jour de position
   */
  async executeLocationUpdate(rideId, driverId, customerId) {
    try {
      const driverLocation = await this.getDriverLocation(driverId);
      
      if (driverLocation) {
        await this.socketService.notifyDriverLocationUpdate(
          customerId,
          rideId,
          driverLocation
        );
      }
      
    } catch (error) {
      console.error(`❌ Erreur mise à jour position ${driverId}:`, error);
    }
  }

  /**
   * Arrêter les mises à jour de position
   */
  async stopDriverLocationUpdates(rideId, driverId) {
    const intervalKey = `location:${rideId}:${driverId}`;
    await this.intervalManager.clearIntervalsByKey(intervalKey);
  }

  /**
   * Rechercher des chauffeurs disponibles
   */
  async findAvailableDrivers(rideRequest) {
    const { pickupLocation, rideTypeId, constraints } = rideRequest;
    const radiusKm = constraints?.searchRadius || this.SEARCH_RADIUS_KM;
    
    try {
      console.log(`🔍 Recherche chauffeurs pour ${rideRequest.rideId}`);
      
      // 1. Rechercher les chauffeurs connectés et libres
      const connectedDrivers = await this.driverDiscovery.findConnectedDrivers(
        pickupLocation,
        rideTypeId,
        radiusKm
      );
      
      // 2. Rechercher les chauffeurs en fin de course
      const finishingDrivers = await this.driverDiscovery.findFinishingRideDrivers(
        pickupLocation,
        rideTypeId,
        radiusKm
      );
      
      // 3. Fusionner et dédupliquer
      const allDrivers = this.driverDiscovery.mergeDrivers(
        connectedDrivers,
        finishingDrivers
      );
      
      // 4. Filtrer les chauffeurs déjà réservés
      const availableDrivers = allDrivers.filter(driver => 
        !this.driverReservation.isDriverReserved(driver.driverId)
      );
      
      // 5. Calculer les scores
      const scoredDrivers = availableDrivers.map(driver => 
        this.calculateDriverScore(driver, rideRequest)
      );
      
      // 6. Trier par priorité
      const sortedDrivers = this.sortDriversByPriority(scoredDrivers);
      
      console.log(`✅ ${sortedDrivers.length} chauffeurs disponibles pour ${rideRequest.rideId}`);
      return sortedDrivers;
      
    } catch (error) {
      console.error('Erreur recherche chauffeurs:', error);
      return [];
    }
  }

  /**
   * Notifier un chauffeur pour une course
   */
  async notifyDriver(driverId, rideRequest) {
    try {
      // 1. Réserver le chauffeur
      await this.driverReservation.reserve(driverId, rideRequest.rideId);
      
      // 2. Récupérer les infos du chauffeur
      const driver = await this.driverDiscovery.getDriverDetails(driverId);
      
      // 3. Envoyer la notification via Socket
      const notified = await this.socketService.notifyDriverForRide(driverId, {
        ...rideRequest,
        driver,
        expiresIn: this.DRIVER_RESPONSE_TIMEOUT
      });
      
      if (!notified) {
        await this.driverReservation.release(driverId);
        return false;
      }
      
      // 4. Démarrer le timeout de réponse
      await this.startDriverResponseTimeout(driverId, rideRequest.rideId);
      
      console.log(`📨 Chauffeur ${driverId} notifié pour ${rideRequest.rideId}`);
      return true;
      
    } catch (error) {
      console.error(`Erreur notification chauffeur ${driverId}:`, error);
      await this.driverReservation.release(driverId);
      return false;
    }
  }

  /**
   * Gérer l'acceptation d'un chauffeur
   */
  async handleDriverAcceptance(driverId, rideId) {
    try {
      console.log(`✅ Chauffeur ${driverId} accepte la course ${rideId}`);
      
      // 1. Vérifier que la course est toujours en matching
      const matchingState = await this.getMatchingState(rideId);
      if (!matchingState || matchingState.status !== 'searching') {
        throw new Error('Course non disponible');
      }
      
      // 2. Libérer la réservation
      await this.driverReservation.release(driverId);
      
      // 3. Arrêter tous les timeouts
      await this.clearAllTimeoutsForRide(rideId);
      
      // 4. Mettre à jour l'état
      matchingState.status = 'accepted';
      matchingState.selectedDriver = driverId;
      matchingState.acceptedAt = Date.now();
      
      await this.saveMatchingState(rideId, matchingState);
      
      // 5. Notifier le client
      const driver = await this.driverDiscovery.getDriverDetails(driverId);
      await this.socketService.notifyCustomerDriverAccepted(
        matchingState.customerId,
        driver,
        rideId
      );
      
      // 6. Mettre à jour la base de données
      await this.updateRideWithDriver(rideId, driverId);

      // Mettre à jour le statut du chauffeur dans Redis
      await this.driverDiscovery.updateDriverStatus(driverId, 'in_ride', {
        currentRideId: rideId,
        rideAcceptedAt: Date.now(),
        // Conserver la position actuelle
      });

      // Stocker les infos de la course dans Redis
      await this.storeRideInfoInRedis(rideId, driverId);
      
      // 7. Nettoyer après délai
      setTimeout(() => {
        this.cleanupMatchingState(rideId);
      }, 60000);
      
      return {
        success: true,
        driver,
        rideId
      };
      
    } catch (error) {
      console.error('Erreur acceptation chauffeur:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async storeRideInfoInRedis(rideId, driverId) {
    const rideKey = `ride:active:${rideId}`;
    const rideData = {
      rideId,
      driverId,
      status: 'in_progress',
      startedAt: Date.now(),
      lastUpdated: Date.now()
    };
    
    await redis.set(rideKey, rideData, 3600); // 1 heure
    
    // Associer le chauffeur à la course
    await redis.hset('driver:active:rides', driverId, rideId);
    await redis.expire('driver:active:rides', 3600);
  }

  // ==================== API POUR SOCKETSERVICE ====================

  /**
   * API publique pour SocketService
   */
  async handleDriverConnection(socketId, driverData) {
    return await this.registerDriverOnline(driverData.userId, driverData);
  }

  async handleDriverDisconnection(driverId) {
    return await this.markDriverOffline(driverId);
  }

  async handleDriverLocationUpdate(driverId, location) {
    return await this.updateDriverLocation(driverId, location);
  }

  async handleDriverStatusUpdate(driverId, status) {
    return await this.updateDriverStatus(driverId, status);
  }

  // ==================== GESTION DES CONNEXIONS CHAUFFEURS ====================

  /**
   * Enregistrer un chauffeur comme connecté et en ligne
   */
  async registerDriverOnline(driverId, driverData) {
    try {
      console.log(`🚗 Enregistrement chauffeur en ligne: ${driverId}`);
      
      const driverInfo = {
        driverId,
        userId: driverId,
        firstName: driverData.firstName,
        lastName: driverData.lastName,
        vehicleType: driverData.vehicleType,
        vehicleMake: driverData.vehicleMake,
        vehicleModel: driverData.vehicleModel,
        licensePlate: driverData.licensePlate,
        rating: driverData.rating || 4.0,
        acceptanceRate: driverData.acceptanceRate || 50,
        totalRides: driverData.totalRides || 0,
        driverStatus: driverData.driverStatus || 'available',
        isOnline: true,
        lastActiveAt: Date.now(),
        connectedAt: Date.now(),
        registeredAt: Date.now()
      };

      // 1. Enregistrer dans Redis (données chauffeur)
      await this.driverDiscovery.registerDriver(driverId, driverInfo);

      // 2. Si position disponible, l'ajouter à GEO
      if (driverData.currentLocation) {
        await this.driverDiscovery.updateDriverLocation(
          driverId, 
          driverData.currentLocation
        );
      }

      // 3. Ajouter à la liste des chauffeurs en ligne
      await this.addToOnlineDrivers(driverId);

      // 4. Notifier le système qu'un nouveau chauffeur est disponible
      await this.notifySystemDriverOnline(driverId);

      console.log(`✅ Chauffeur ${driverId} enregistré comme en ligne`);
      return driverInfo;

    } catch (error) {
      console.error('❌ Erreur enregistrement chauffeur en ligne:', error);
      throw error;
    }
  }

  /**
   * Marquer un chauffeur comme hors ligne
   */
  async markDriverOffline(driverId) {
    try {
      console.log(`🚫 Marquage chauffeur hors ligne: ${driverId}`);
      
      // 1. Mettre à jour le statut dans Redis
      await this.driverDiscovery.updateDriverStatus(driverId, 'offline');
      
      // 2. Retirer de la liste GEO
      await this.driverDiscovery.removeDriverFromGeo(driverId);
      
      // 3. Retirer de la liste des en ligne
      await this.removeFromOnlineDrivers(driverId);
      
      // 4. Libérer les réservations actives
      await this.driverReservation.release(driverId);
      
      // 5. Notifier le système
      await this.notifySystemDriverOffline(driverId);
      
      console.log(`✅ Chauffeur ${driverId} marqué comme hors ligne`);
      return true;
      
    } catch (error) {
      console.error('❌ Erreur marquage chauffeur hors ligne:', error);
      return false;
    }
  }

  /**
   * Mettre à jour la position d'un chauffeur
   */
  /*async handleDriverLocationUpdate(driverId, location) {
    try {
      console.log(`📍 Mise à jour position chauffeur ${driverId}`);
      
      // 1. Mettre à jour dans Redis GEO
      await this.updateDriverLocationInRedis(driverId, location);
      
      // 2. Mettre à jour les données de connexion
      await this.updateDriverConnectionData(driverId, { currentLocation: location });
      
      // 3. Vérifier si cela affecte des courses en attente
      await this.checkAffectedRides(driverId, location);
      
      return { success: true, driverId, timestamp: Date.now() };
      
    } catch (error) {
      console.error('Erreur mise à jour position:', error);
      return { success: false, error: error.message };
    }
  }*/
  async updateDriverLocation(driverId, location) {
    return await this.driverDiscovery.updateDriverLocation(driverId, location);
  }

  /**
   * Mettre à jour le statut d'un chauffeur
   */
  /*async handleDriverStatusUpdate(driverId, status) {
    try {
      console.log(`🔄 Mise à jour statut ${driverId}: ${status}`);
      
      // 1. Mettre à jour dans Redis
      await this.updateDriverConnectionData(driverId, { 
        driverStatus: status,
        lastStatusUpdate: Date.now()
      });
      
      // 2. Si le chauffeur devient disponible, vérifier les courses en attente
      if (status === 'available') {
        await this.checkPendingRidesForDriver(driverId);
      }
      
      // 3. Si le chauffeur devient indisponible, libérer les réservations
      if (status === 'offline' || status === 'busy') {
        await this.driverReservation.release(driverId);
      }
      
      return { success: true, driverId, status };
      
    } catch (error) {
      console.error('Erreur mise à jour statut:', error);
      return { success: false, error: error.message };
    }
  }*/
  async updateDriverStatus(driverId, status) {
    return await this.driverDiscovery.updateDriverStatus(driverId, status);
  }

  // ==================== MÉTHODES PRIVÉES ====================

  /**
   * Mettre à jour les données de connexion du chauffeur
   */
  async updateDriverConnectionData(driverId, updates) {
    const driverKey = `socket:drivers:${driverId}`;
    const driverData = await redis.get(driverKey) || {};
    
    Object.assign(driverData, updates, {
      lastActiveAt: Date.now()
    });
    
    await redis.set(driverKey, driverData, 7200); // 2 heures
  }

  /**
   * Vérifier les courses affectées par la nouvelle position
   */
  async checkAffectedRides(driverId, newLocation) {
    try {
      // 1. Récupérer le statut du chauffeur
      const driverData = await this.getDriverData(driverId);
      
      // 2. Si le chauffeur est disponible, vérifier les courses en attente proches
      if (driverData.driverStatus === 'available') {
        await this.checkNearbyPendingRides(driverId, newLocation);
      }
      
      // 3. Si le chauffeur est en cours, notifier le client de la position
      if (driverData.driverStatus === 'in_ride') {
        await this.notifyRideCustomerOfLocation(driverId, newLocation);
      }
      
    } catch (error) {
      console.error('Erreur vérification courses affectées:', error);
    }
  }

  /**
   * Vérifier les courses en attente près du chauffeur
   */
  async checkNearbyPendingRides(driverId, location) {
    // Rechercher les courses en matching dans un rayon de 5km
    const pattern = 'matching:state:*';
    const keys = await redis.keys(pattern);
    
    for (const key of keys) {
      const rideId = key.replace('matching:state:', '');
      const matchingState = await redis.get(key);
      
      if (matchingState && matchingState.status === 'searching') {
        // Calculer la distance
        const distance = this.calculateDistance(
          location.latitude,
          location.longitude,
          matchingState.pickupLocation.latitude,
          matchingState.pickupLocation.longitude
        );
        
        // Si à moins de 5km et correspond au type de véhicule
        if (distance <= 5) {
          // Vérifier si le chauffeur n'a pas déjà été notifié
          const alreadyNotified = matchingState.notifiedDrivers?.some(
            d => d.driverId === driverId
          );
          
          if (!alreadyNotified) {
            // Ajouter à la liste des chauffeurs disponibles pour cette course
            await this.addDriverToRideMatching(rideId, driverId, distance);
          }
        }
      }
    }
  }

  /**
   * Notifier le client de la position du chauffeur
   */
  async notifyRideCustomerOfLocation(driverId, location) {
    try {
      // 1. Trouver la course active du chauffeur
      const activeRide = await this.findActiveRideForDriver(driverId);
      
      if (activeRide) {
        // 2. Notifier le client via SocketService
        await this.socketService.emitToUser(
          activeRide.customerId,
          'driver_location_update',
          {
            driverId,
            location,
            rideId: activeRide.id,
            timestamp: Date.now()
          }
        );
      }
      
    } catch (error) {
      console.error('Erreur notification position chauffeur:', error);
    }
  }

  // ==================== MÉTHODES UTILITAIRES ====================

  calculateDriverScore(driver, rideRequest) {
    const distanceScore = Math.max(0, 100 - (driver.distance * 20));
    const ratingScore = (driver.rating - 1) * 25;
    const acceptanceScore = Math.min(100, driver.acceptanceRate || 50);
    const statusBonus = driver.status === 'available' ? 30 : 10;
    const experienceBonus = Math.min(20, (driver.totalRides || 0) / 50);
    
    const totalScore = (
      distanceScore * 0.35 +
      ratingScore * 0.25 +
      acceptanceScore * 0.15 +
      statusBonus * 0.15 +
      experienceBonus * 0.10
    );
    
    return {
      ...driver,
      score: Math.round(totalScore),
      estimatedEta: this.calculateEstimatedEta(driver.distance, driver.status)
    };
  }

  calculateEstimatedEta(distanceKm, status) {
    const baseTime = distanceKm * 3;
    return status === 'available' ? Math.round(baseTime + 2) :
           status === 'in_ride' ? Math.round(baseTime + 5) :
           Math.round(baseTime + 3);
  }

  sortDriversByPriority(drivers) {
    return drivers.sort((a, b) => {
      // 1. Priorité (libres > en course)
      if (a.priority !== b.priority) {
        return a.priority - b.priority;
      }
      
      // 2. Score
      if (a.score !== b.score) {
        return b.score - a.score;
      }
      
      // 3. Distance
      return a.distance - b.distance;
    });
  }

  async startDriverResponseTimeout(driverId, rideId) {
    const timeoutKey = `matching:timeout:${rideId}:${driverId}`;
    
    const timeout = setTimeout(async () => {
      const reservation = await this.driverReservation.getReservation(driverId);
      if (reservation && reservation.rideId === rideId) {
        console.log(`⏰ Timeout réponse chauffeur ${driverId} pour ${rideId}`);
        await this.driverReservation.release(driverId);
        await this.continuousMatching.performSearch(rideId, null);
      }
    }, this.DRIVER_RESPONSE_TIMEOUT * 1000);
    
    await redis.set(timeoutKey, {
      driverId,
      rideId,
      timeoutId: timeout[Symbol.toPrimitive]()
    }, this.DRIVER_RESPONSE_TIMEOUT);
  }

  async clearAllTimeoutsForRide(rideId) {
    const pattern = `matching:timeout:${rideId}:*`;
    const keys = await redis.keys(pattern);
    
    for (const key of keys) {
      const timeout = await redis.get(key);
      if (timeout && timeout.timeoutId) {
        clearTimeout(timeout.timeoutId);
      }
      await redis.del(key);
    }
  }

  async addToOnlineDrivers(driverId) {
    const onlineKey = 'drivers:online';
    await redis.sadd(onlineKey, driverId);
    await redis.expire(onlineKey, this.DRIVER_DATA_TTL);
  }

  async removeFromOnlineDrivers(driverId) {
    const onlineKey = 'drivers:online';
    await redis.srem(onlineKey, driverId);
  }

  async notifySystemDriverOnline(driverId) {
    // Émettre un événement système pour les services qui en ont besoin
    await redis.publish('driver:online', JSON.stringify({
      driverId,
      timestamp: Date.now()
    }));
    
    // Mettre à jour les statistiques
    await this.updateDriverStats();
  }

  async notifySystemDriverOffline(driverId) {
    // Émettre un événement système
    await redis.publish('driver:offline', JSON.stringify({
      driverId,
      timestamp: Date.now()
    }));
    
    // Mettre à jour les statistiques
    await this.updateDriverStats();
  }

  async updateDriverStats() {
    const onlineDrivers = await redis.scard('drivers:online') || 0;
    const geoDrivers = await redis.client.zcard('drivers:geo:locations') || 0;
    
    await redis.hset('system:stats', 'drivers', JSON.stringify({
      online: onlineDrivers,
      withLocation: geoDrivers,
      lastUpdated: Date.now()
    }));
  }

  /**
   * Mettre à jour la position d'un chauffeur en cours de course
   */
  async updateDriverLocationDuringRide(driverId, location) {
    try {
      // 1. Mettre à jour la position dans Redis GEO
      await this.driverDiscovery.updateDriverLocation(driverId, location);
      
      // 2. Récupérer la course active
      const rideId = await redis.hget('driver:active:rides', driverId);
      
      if (rideId) {
        // 3. Mettre à jour la progression estimée
        await this.updateRideProgressEstimate(rideId, driverId, location);
        
        // 4. Notifier le client de la position
        const rideDetails = await this.getRideDetails(rideId);
        if (rideDetails && rideDetails.customerId) {
          await this.socketService.notifyDriverLocationUpdate(
            rideDetails.customerId,
            rideId,
            location
          );
        }
      }
      
      return { success: true };
      
    } catch (error) {
      console.error('Erreur mise à jour position course:', error);
      return { success: false, error: error.message };
    }
  }
  
  /**
   * Mettre à jour l'estimation de progression
   */
  async updateRideProgressEstimate(rideId, driverId, currentLocation) {
    const progressKey = `ride:progress:${rideId}`;
    
    // Calculer la progression basée sur la distance parcourue
    const progress = await this.calculateDistanceProgress(rideId, currentLocation);
    
    // Stocker dans Redis avec TTL
    await redis.set(progressKey, {
      rideId,
      driverId,
      currentLocation,
      progressPercentage: progress.percentage,
      estimatedCompletion: progress.estimatedCompletion,
      lastUpdated: Date.now()
    }, 300); // 5 minutes
    
    return progress;
  }

  // ==================== GESTION ÉTAT ====================

  async saveMatchingState(rideId, state) {
    const key = `matching:state:${rideId}`;
    await redis.set(key, state, this.MATCHING_DURATION);
  }

  async getMatchingState(rideId) {
    const key = `matching:state:${rideId}`;
    return await redis.get(key);
  }

  async cleanupMatchingState(rideId) {
    await redis.del(`matching:state:${rideId}`);
    await redis.del(`ride:reservations:${rideId}`);
    
    // Nettoyer les timeouts
    await this.clearAllTimeoutsForRide(rideId);
    
    // Arrêter le matching continu
    this.continuousMatching.stop(rideId);
  }

  async getQueueStatus(rideId) {
    const state = await this.getMatchingState(rideId);
    if (!state) return null;
    
    return {
      rideId,
      status: state.status,
      driversAvailable: state.availableDrivers.length,
      driversNotified: state.notifiedDrivers.length,
      searchRadius: state.searchRadius,
      elapsedTime: Math.floor((Date.now() - state.createdAt) / 1000),
      remainingTime: Math.floor((state.expiresAt - Date.now()) / 1000)
    };
  }

  // ==================== MAINTENANCE ====================

  setupCleanupIntervals() {
    // Nettoyage des états expirés
    setInterval(async () => {
      await this.cleanupExpiredStates();
    }, 5 * 60 * 1000); // Toutes les 5 minutes
  }

  async initializeInstance() {
    // Nettoyer les anciens intervalles de cette instance au démarrage
    await this.intervalManager.clearInstanceIntervals();
    console.log(`🚀 Instance ${this.intervalManager.instanceId} initialisée`);
  }

  async cleanupExpiredStates() {
    const pattern = 'matching:state:*';
    const keys = await redis.keys(pattern);
    
    for (const key of keys) {
      const state = await redis.get(key);
      if (state && state.expiresAt < Date.now()) {
        const rideId = key.replace('matching:state:', '');
        await this.cleanupMatchingState(rideId);
        console.log(`🧹 État expiré nettoyé: ${rideId}`);
      }
    }
  }

  // ==================== VALIDATION ====================

  validateRideRequest(rideRequest) {
    if (!rideRequest.rideId) {
      throw new Error('rideId requis');
    }
    
    if (!rideRequest.customerId) {
      throw new Error('customerId requis');
    }
    
    if (!rideRequest.pickupLocation) {
      throw new Error('pickupLocation requis');
    }
    
    if (!rideRequest.rideTypeId) {
      throw new Error('rideTypeId requis');
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
      
      console.log(`📝 Course ${rideId} assignée à ${driverId}`);
      
    } catch (error) {
      console.error('Erreur mise à jour course:', error);
      throw error;
    }
  }

  getSocketService() { return $this.socketService; }
}

// ==================== SOUS-SERVICES ====================

/**
 * Sous-service : Découverte des chauffeurs
 */
class DriverDiscovery {
    constructor() {
        this.DRIVER_LOCATION_TTL = 300; // 5 minutes
        this.DRIVER_DATA_TTL = 7200; // 2 heures
    }

    /**
     * Enregistrer/mettre à jour un chauffeur dans Redis
     */
    async registerDriver(driverId, driverData) {
      try {
        const driverKey = `driver:${driverId}`;
        const geoKey = 'drivers:geo:locations';
        
        // Données complètes du chauffeur
        const fullDriverData = {
            ...driverData,
            driverId,
            userId: driverId,
            lastUpdated: Date.now(),
            isOnline: true
        };

        // 1. Sauvegarder les données complètes du chauffeur
        await redis.set(driverKey, fullDriverData, this.DRIVER_DATA_TTL);
        
        // Ajouter aux métadonnées des chauffeurs
        await redis.hset('drivers:metadata', driverId, JSON.stringify({
          lastSeen: Date.now(),
          status: driverData.driverStatus,
          vehicleType: driverData.vehicleType
        }));

        // 2. Si position disponible, mettre à jour GEO
        if (driverData.currentLocation) {
            await redis.client.geoadd(
            geoKey,
            driverData.currentLocation.longitude,
            driverData.currentLocation.latitude,
            driverId
            );
            await redis.expire(geoKey, this.DRIVER_TTL);
        }
        
        // 3. Ajouter/mettre à jour dans le sorted set par statut
        await this.updateDriverStatusIndex(driverId, driverData.driverStatus);

        // 4. Ajouter à la liste des chauffeurs en ligne
        await redis.sadd('drivers:online', driverId);
        await redis.expire('drivers:online', this.DRIVER_TTL);

        console.log(`📝 Chauffeur ${driverId} mis à jour dans Redis (${driverData.driverStatus})`);
        return fullDriverData;
        
      } catch (error) {
        console.error('Erreur mise à jour chauffeur Redis:', error);
        throw error;
      }
    }

    /**
     * Mettre à jour l'index par statut (sorted sets)
     */
    async updateDriverStatusIndex(driverId, status) {
        const now = Date.now();
        
        // Retirer des anciens statuts
        const statuses = ['available', 'in_ride', 'offline', 'reconnecting'];
        for (const oldStatus of statuses) {
            if (oldStatus !== status) {
                await redis.zrem(`drivers:status:${oldStatus}`, driverId);
            }
        }
        
        // Ajouter au nouveau statut
        await redis.zadd(`drivers:status:${status}`, now, driverId);
        await redis.expire(`drivers:status:${status}`, this.DRIVER_TTL);
        
        // Mettre à jour le statut global
        await redis.hset('driver:status:global', driverId, status);
    }

    /**
     * Mettre à jour la position dans Redis GEO
     */
    async updateDriverLocation(driverId, location) {
      try {
        const key = 'drivers:geo:locations';
        const driverKey = `driver:${driverId}`;
        
        // Récupérer les données existantes
        let driverData = await redis.get(driverKey) || {};
        
        // Mettre à jour
        driverData.currentLocation = location;
        driverData.lastLocationUpdate = Date.now();
        driverData.lastActiveAt = Date.now();
        
        // Sauvegarder
        await redis.set(driverKey, driverData, 300); // 5 minutes
        
        // Mettre à jour l'index GEO
        await redis.client.geoadd(
          key,
          location.longitude,
          location.latitude,
          driverId
        );
        
        // Mettre à jour l'expiration
        await redis.expire(key, 300);
        
        console.log(`📍 Position ${driverId} mise à jour dans Redis GEO`);
        return true;
        
      } catch (error) {
        console.error('Erreur mise à jour position Redis:', error);
        return false;
      }
    }

    /**
     * Mettre à jour le statut d'un chauffeur
     */
    async updateDriverStatus(driverId, status) {
      try {
        const driverKey = `driver:${driverId}`;
        const driverData = await redis.get(driverKey);
        
        if (driverData) {
          driverData.driverStatus = status;
          driverData.lastActiveAt = Date.now();
          driverData.lastStatusUpdate = Date.now();
          
          await redis.set(driverKey, driverData, this.DRIVER_DATA_TTL);
          
          // Mettre à jour les métadonnées
          await redis.hset('drivers:metadata', driverId, JSON.stringify({
            lastSeen: Date.now(),
            status: status,
            vehicleType: driverData.vehicleType
          }));
          
          console.log(`🔄 Statut ${driverId}: ${status}`);
          return driverData;
        }
        
        return null;
        
      } catch (error) {
        console.error('Erreur mise à jour statut:', error);
        return null;
      }
    }

    /**
     * Retirer un chauffeur de l'index GEO
     */
    async removeDriverFromGeo(driverId) {
      try {
        const geoKey = 'drivers:geo:locations';
        await redis.client.zrem(geoKey, driverId);
        
        console.log(`🗺️ Chauffeur ${driverId} retiré de l'index GEO`);
        return true;
        
      } catch (error) {
        console.error('Erreur retrait index GEO:', error);
        return false;
      }
    }

    async findConnectedDrivers(pickupLocation, rideTypeId, radiusKm) {
      const key = 'drivers:geo:locations';
      
      try {
        // Recherche GEO dans Redis
        const radiusMeters = radiusKm * 1000;
        const geoResults = await redis.client.georadius(
          key,
          pickupLocation.longitude,
          pickupLocation.latitude,
          radiusMeters,
          'm',
          'WITHDIST',
          'WITHCOORD',
          'ASC'
        );
        
        const drivers = [];
        
        for (const result of geoResults) {
          const [driverId, distance] = result;
          
          // Récupérer les détails du chauffeur
          const driverKey = `driver:${driverId}`;
          const driverData = await redis.get(driverKey);
          
          if (driverData && this.isDriverEligible(driverData, rideTypeId, 'available')) {
            drivers.push({
              ...driverData,
              distance: parseFloat(distance) / 1000,
              source: 'connected',
              priority: 1
            });
          }
        }
        
        return drivers;
        
      } catch (error) {
        console.error('Erreur recherche chauffeurs connectés:', error);
        return [];
      }
    }
    
    async findFinishingRideDrivers(pickupLocation, rideTypeId, radiusKm) {
      //, ST_SetSRID(ST_MakePoint(r.destination_location->'coordinates'->>1, r.destination_location->'coordinates'->>0), 4326)
      try {
        const query = `
          SELECT 
            d.user_id as driver_id,
            u.first_name,
            u.last_name,
            d.vehicle_make,
            d.vehicle_model,
            d.license_plate,
            d.driver_rating,
            d.acceptance_rate,
            d.total_completed_rides,
            r.id as ride_id,
            r.destination_location,
            ST_Distance(
              r.destination_location,
              ST_SetSRID(ST_MakePoint(:longitude, :latitude), 4326)
            ) / 1000 as distance
          FROM drivers d
          JOIN users u ON d.user_id = u.uid
          JOIN rides r ON d.user_id = r.driver_id
          WHERE d.ride_type_id = :rideTypeId
            AND d.driver_status = 'approved'
            AND r.status = 'in_progress'
            AND r.destination_location IS NOT NULL
            AND ST_DWithin(
              r.destination_location,
              ST_SetSRID(ST_MakePoint(:longitude, :latitude), 4326),
              :radius * 1000
            )
            AND r.estimated_completion_time >= NOW() - INTERVAL '10 minutes'
          ORDER BY distance ASC
          LIMIT 10
        `;
        
        const results = await sequelize.query(query, {
          replacements: {
            latitude: pickupLocation.latitude,
            longitude: pickupLocation.longitude,
            radius: radiusKm,
            rideTypeId
          },
          type: sequelize.QueryTypes.SELECT
        });
        
        return results.map(driver => ({
          driverId: driver.driver_id,
          firstName: driver.first_name,
          lastName: driver.last_name,
          vehicle: {
            make: driver.vehicle_make,
            model: driver.vehicle_model,
            licensePlate: driver.license_plate
          },
          rating: parseFloat(driver.driver_rating) || 4.0,
          acceptanceRate: parseFloat(driver.acceptance_rate) || 50,
          totalRides: driver.total_completed_rides || 0,
          distance: parseFloat(driver.distance),
          source: 'finishing_ride',
          status: 'in_ride',
          currentRideId: driver.ride_id,
          priority: 2
        }));
        
      } catch (error) {
        console.error('Erreur recherche chauffeurs en fin de course:', error);
        return [];
      }
    }
    
    mergeDrivers(connectedDrivers, finishingDrivers) {
      const allDrivers = [...connectedDrivers];
      const connectedIds = new Set(connectedDrivers.map(d => d.driverId));
      
      for (const driver of finishingDrivers) {
        if (!connectedIds.has(driver.driverId)) {
          allDrivers.push(driver);
        }
      }
      
      return allDrivers;
    }
    
    /**
     * Obtenir les détails d'un chauffeur
     */
    async getDriverDetails(driverId) {
      const driverKey = `driver:${driverId}`;
      const driverData = await redis.get(driverKey);
      
      if (driverData) {
        return driverData;
      }
      
      // Fallback à la base de données
      const driver = await Driver.findOne({
        where: { user_id: driverId },
        include: [{
          model: User,
          as: 'user',
          attributes: ['first_name', 'last_name', 'profile_picture_url']
        }]
      });
      
      if (driver) {
        return {
          driverId,
          firstName: driver.user.first_name,
          lastName: driver.user.last_name,
          vehicleType: driver.ride_type_id,
          vehicleMake: driver.vehicle_make,
          vehicleModel: driver.vehicle_model,
          licensePlate: driver.license_plate,
          rating: parseFloat(driver.driver_rating) || 4.0,
          acceptanceRate: parseFloat(driver.acceptance_rate) || 50,
          totalRides: driver.total_completed_rides || 0
        };
      }
      
      return null;
    }

    async getDriverData(driverId) {
      //const driverKey = `socket:drivers:${driverId}`;
      //return await redis.get(driverKey) || {};
      return await this.getDriverDetails(driverId);
    }

    calculateDistance(lat1, lon1, lat2, lon2) {
      const R = 6371;
      const dLat = this.toRadians(lat2 - lat1);
      const dLon = this.toRadians(lon2 - lon1);
        
      const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(this.toRadians(lat1)) * Math.cos(this.toRadians(lat2)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
        
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      return R * c;
    }

    toRadians(degrees) {
      return degrees * (Math.PI / 180);
    }
    
    isDriverEligible(driverData, rideTypeId, requiredStatus) {
      if (!driverData) return false;
      
      if (rideTypeId && driverData.vehicleType !== rideTypeId) {
        return false;
      }
      
      if (requiredStatus && driverData.driverStatus !== requiredStatus) {
        return false;
      }
      
      if (!driverData.isOnline) {
        return false;
      }
      
      const lastActive = driverData.lastActiveAt || 0;
      const inactiveThreshold = Date.now() - (5 * 60 * 1000);
      
      return lastActive > inactiveThreshold;
    }

    /**
   * Rechercher les chauffeurs en fin de course via Redis
   */
  async findFinishingRideDrivers(pickupLocation, rideTypeId, radiusKm) {
    try {
      console.log(`🔍 Recherche chauffeurs en fin de course (Redis) pour rideType: ${rideTypeId}`);
      
      // 1. Récupérer tous les chauffeurs avec statut 'in_ride'
      const inRideDriverIds = await redis.zrange('drivers:status:in_ride', 0, -1);
      
      if (inRideDriverIds.length === 0) {
        return [];
      }
      
      const finishingDrivers = [];
      const now = Date.now();
      
      for (const driverId of inRideDriverIds) {
        try {
          // 2. Récupérer les données du chauffeur
          const driverKey = `driver:${driverId}`;
          const driverData = await redis.get(driverKey);
          
          if (!driverData || driverData.vehicleType !== rideTypeId) {
            continue;
          }
          
          // 3. Récupérer les infos de la course active
          const rideId = await redis.hget('driver:active:rides', driverId);
          if (!rideId) continue;
          
          const rideKey = `ride:active:${rideId}`;
          const rideData = await redis.get(rideKey);
          
          if (!rideData) continue;
          
          // 4. Calculer la progression de la course
          const rideProgress = await this.calculateRideProgress(rideId, driverData);
          
          // 5. Vérifier si la course est en fin (derniers 25%)
          if (rideProgress.percentage >= 75 && rideProgress.estimatedCompletion) {
            const completionTime = rideProgress.estimatedCompletion;
            const timeToCompletion = completionTime - now;
            
            // Seulement si fin dans moins de 5 minutes
            if (timeToCompletion <= 5 * 60 * 1000) {
              // 6. Vérifier la distance au pickup
              if (driverData.currentLocation) {
                const distance = this.calculateDistance(
                  pickupLocation.latitude,
                  pickupLocation.longitude,
                  driverData.currentLocation.latitude,
                  driverData.currentLocation.longitude
                );
                
                if (distance <= radiusKm) {
                  finishingDrivers.push({
                    driverId,
                    ...driverData,
                    distance,
                    source: 'finishing_ride',
                    status: 'in_ride',
                    currentRideId: rideId,
                    rideProgress: rideProgress.percentage,
                    estimatedCompletionIn: Math.floor(timeToCompletion / 1000), // secondes
                    priority: 2
                  });
                }
              }
            }
          }
          
        } catch (error) {
          console.error(`Erreur traitement chauffeur ${driverId}:`, error);
          continue;
        }
      }
      
      console.log(`✅ ${finishingDrivers.length} chauffeurs en fin de course trouvés`);
      return finishingDrivers;
      
    } catch (error) {
      console.error('Erreur recherche chauffeurs en fin de course:', error);
      return [];
    }
  }
  
  /**
   * Calculer la progression d'une course
   */
  async calculateRideProgress(rideId, driverData) {
    try {
      // Récupérer les détails de la course depuis Redis ou cache
      const rideDetails = await this.getRideDetails(rideId);
      
      if (!rideDetails || !rideDetails.estimatedDuration) {
        return { percentage: 0, estimatedCompletion: null };
      }
      
      const now = Date.now();
      const startedAt = rideDetails.startedAt || now - (10 * 60 * 1000); // Défaut: il y a 10min
      const elapsed = now - startedAt;
      const totalDuration = rideDetails.estimatedDuration * 60 * 1000; // minutes → ms
      
      const percentage = Math.min(95, (elapsed / totalDuration) * 100);
      const estimatedCompletion = startedAt + totalDuration;
      
      return {
        percentage: Math.round(percentage),
        estimatedCompletion,
        elapsedMinutes: Math.floor(elapsed / 60000),
        remainingMinutes: Math.floor((totalDuration - elapsed) / 60000)
      };
      
    } catch (error) {
      console.error('Erreur calcul progression:', error);
      return { percentage: 0, estimatedCompletion: null };
    }
  }
  
  /**
   * Obtenir les détails d'une course (cache Redis + fallback DB)
   */
  async getRideDetails(rideId) {
    const cacheKey = `ride:details:${rideId}`;
    
    // 1. Essayer le cache Redis
    const cached = await redis.get(cacheKey);
    if (cached) {
      return cached;
    }
    
    // 2. Fallback à la base de données
    try {
      const ride = await Ride.findOne({
        where: { id: rideId },
        attributes: ['id', 'status', 'estimated_duration', 'started_at', 'pickup_location', 'destination_location']
      });
      
      if (ride) {
        const rideDetails = {
          id: ride.id,
          status: ride.status,
          estimatedDuration: ride.estimated_duration,
          startedAt: ride.started_at ? new Date(ride.started_at).getTime() : Date.now(),
          pickupLocation: ride.pickup_location,
          destinationLocation: ride.destination_location
        };
        
        // Mettre en cache pour 5 minutes
        await redis.set(cacheKey, rideDetails, 300);
        
        return rideDetails;
      }
    } catch (error) {
      console.error('Erreur récupération course DB:', error);
    }
    
    return null;
  }


}

/**
 * Sous-service : Réservation des chauffeurs
 */
class DriverReservation {
    constructor() {
      this.RESERVATION_DURATION = 20; // 20 secondes
      this.RESERVATION_PREFIX = 'reservation:';
    }
    
    async reserve(driverId, rideId) {
      try {
        // Vérifier que le chauffeur n'est pas déjà réservé
        if (await this.isDriverReserved(driverId)) {
          throw new Error(`Driver ${driverId} already reserved`);
        }
        
        const reservation = {
          driverId,
          rideId,
          reservedUntil: Date.now() + (this.RESERVATION_DURATION * 1000),
          createdAt: Date.now()
        };
        
        const reservationKey = `${this.RESERVATION_PREFIX}${driverId}`;
        await redis.set(reservationKey, reservation, this.RESERVATION_DURATION);
        
        // Ajouter à la liste des réservations de la course
        const rideReservationKey = `ride:reservations:${rideId}`;
        await redis.sadd(rideReservationKey, driverId);
        await redis.expire(rideReservationKey, this.RESERVATION_DURATION);
        
        console.log(`🔒 Chauffeur ${driverId} réservé pour ${rideId}`);
        return reservation;
        
      } catch (error) {
        console.error('Erreur réservation chauffeur:', error);
        throw error;
      }
    }
    
    async isDriverReserved(driverId) {
      const reservationKey = `${this.RESERVATION_PREFIX}${driverId}`;
      const reservation = await redis.get(reservationKey);
      
      if (!reservation) return false;
      
      // Vérifier expiration
      if (reservation.reservedUntil < Date.now()) {
        await this.release(driverId);
        return false;
      }
      
      return true;
    }
    
    async release(driverId) {
      const reservationKey = `${this.RESERVATION_PREFIX}${driverId}`;
      const reservation = await redis.get(reservationKey);
      
      if (reservation) {
        // Retirer de la liste des réservations de la course
        const rideReservationKey = `ride:reservations:${reservation.rideId}`;
        await redis.srem(rideReservationKey, driverId);
        
        // Supprimer la réservation
        await redis.del(reservationKey);
        
        console.log(`🔓 Chauffeur ${driverId} libéré`);
        return true;
      }
      
      return false;
    }
    
    async getReservation(driverId) {
      const reservationKey = `${this.RESERVATION_PREFIX}${driverId}`;
      return await redis.get(reservationKey);
    }
}

/**
 * Sous-service : Matching continu
 */
class ContinuousMatching {
    constructor(parentService, intervalManager) {
      this.parent = parentService;
      this.intervalManager = intervalManager;
      this.SEARCH_INTERVAL = 30; // 30 secondes
      this.ACTIVE_SEARCHES_KEY = 'continuous:matching:active';
      this.SEARCH_DATA_PREFIX = 'continuous:matching:data:';
    }
    
    async start(rideId, rideRequest) {
      const matchingState = await this.parent.getMatchingState(rideId);
      if (!matchingState) return;
      
      console.log(`🔄 Matching continu démarré pour ${rideId}`);
      
      // Vérifier si déjà en cours
      if (await this.isSearchActive(rideId)) {
        console.log(`⚠️  Matching continu déjà en cours pour ${rideId}`);
        return;
      }
      
      // 1. Recherche initiale
      await this.performSearch(rideId, rideRequest);
      
      // 2. Démarrer les recherches périodiques gérées par Redis
      const intervalKey = `continuous:matching:${rideId}`;
      
      // Créer l'intervalle géré par Redis
      const intervalId = await this.intervalManager.createInterval(
        intervalKey,
        async () => {
          await this.executeContinuousSearch(rideId, rideRequest);
        },
        this.SEARCH_INTERVAL * 1000,
        { rideId, rideRequest }
      );
      
      // 3. Enregistrer la recherche active dans Redis
      await this.registerActiveSearch(rideId, {
        intervalId,
        intervalKey,
        rideId,
        startTime: Date.now(),
        rideRequest: {
          rideId: rideRequest.rideId,
          customerId: rideRequest.customerId,
          rideTypeId: rideRequest.rideTypeId,
          // Ne stocker que les données essentielles
        },
        lastSearchAt: Date.now(),
        searchCount: 1,
        status: 'active'
      });
      
      console.log(`✅ Matching continu démarré (intervalId: ${intervalId})`);
      
      // 4. Démarrer le timeout global pour arrêter le matching
      await this.startMatchingTimeout(rideId);
    }
    
    /**
     * Enregistrer une recherche active dans Redis
     */
    async registerActiveSearch(rideId, searchData) {
      const searchKey = `${this.SEARCH_DATA_PREFIX}${rideId}`;
      
      // Stocker les données détaillées
      await redis.set(searchKey, searchData, this.parent.MATCHING_DURATION + 60); // +1 minute pour marge
      
      // Ajouter à la liste des recherches actives
      await redis.zadd(this.ACTIVE_SEARCHES_KEY, Date.now(), rideId);
      await redis.expire(this.ACTIVE_SEARCHES_KEY, this.parent.MATCHING_DURATION + 300); // 5 minutes de plus
    }
    
    /**
     * Vérifier si une recherche est active
     */
    async isSearchActive(rideId) {
      try {
        // Vérifier dans le sorted set
        const score = await redis.zscore(this.ACTIVE_SEARCHES_KEY, rideId);
        
        if (!score) return false;
        
        // Vérifier l'âge
        const age = Date.now() - parseInt(score);
        if (age > (this.parent.MATCHING_DURATION * 1000)) {
          // Recherche trop ancienne, la nettoyer
          await this.cleanupSearchData(rideId);
          return false;
        }
        
        // Vérifier que les données existent
        const searchKey = `${this.SEARCH_DATA_PREFIX}${rideId}`;
        const data = await redis.get(searchKey);
        
        return !!data;
        
      } catch (error) {
        console.error(`❌ Erreur vérification recherche active ${rideId}:`, error);
        return false;
      }
    }
    
    /**
     * Obtenir les données d'une recherche active
     */
    async getActiveSearchData(rideId) {
      const searchKey = `${this.SEARCH_DATA_PREFIX}${rideId}`;
      return await redis.get(searchKey);
    }
    
    /**
     * Mettre à jour les données d'une recherche active
     */
    async updateActiveSearchData(rideId, updates) {
      try {
        const searchKey = `${this.SEARCH_DATA_PREFIX}${rideId}`;
        const currentData = await this.getActiveSearchData(rideId) || {};
        
        const updatedData = {
          ...currentData,
          ...updates,
          lastUpdated: Date.now()
        };
        
        await redis.set(searchKey, updatedData, this.parent.MATCHING_DURATION + 60);
        
        // Rafraîchir le timestamp dans le sorted set
        await redis.zadd(this.ACTIVE_SEARCHES_KEY, Date.now(), rideId);
        
        return updatedData;
        
      } catch (error) {
        console.error(`❌ Erreur mise à jour recherche ${rideId}:`, error);
        return null;
      }
    }
    
    /**
     * Obtenir toutes les recherches actives
     */
    async getAllActiveSearches() {
      try {
        // Récupérer tous les rideIds actifs
        const rideIds = await redis.zrange(this.ACTIVE_SEARCHES_KEY, 0, -1);
        
        const activeSearches = [];
        
        for (const rideId of rideIds) {
          const data = await this.getActiveSearchData(rideId);
          if (data) {
            activeSearches.push(data);
          } else {
            // Nettoyer l'entrée orpheline
            await redis.zrem(this.ACTIVE_SEARCHES_KEY, rideId);
          }
        }
        
        return activeSearches;
        
      } catch (error) {
        console.error('❌ Erreur récupération recherches actives:', error);
        return [];
      }
    }
    
    /**
     * Démarrer le timeout global du matching
     */
    async startMatchingTimeout(rideId) {
      const timeoutKey = `matching:timeout:global:${rideId}`;
      
      // Vérifier si un timeout existe déjà
      const existingTimeout = await redis.get(timeoutKey);
      if (existingTimeout) {
        console.log(`⚠️  Timeout déjà programmé pour ${rideId}`);
        return;
      }
      
      // Stocker le timeout dans Redis
      await redis.set(timeoutKey, {
        rideId,
        scheduledAt: Date.now(),
        expiresAt: Date.now() + (this.parent.MATCHING_DURATION * 1000)
      }, this.parent.MATCHING_DURATION + 10); // +10s pour marge
      
      // Créer un intervalle pour vérifier le timeout
      const timeoutCheckInterval = await this.intervalManager.createInterval(
        `matching:timeout:check:${rideId}`,
        async () => {
          await this.checkAndHandleTimeout(rideId);
        },
        10000, // Vérifier toutes les 10 secondes
        { rideId }
      );
      
      // Mettre à jour les données de recherche avec l'ID du timeout check
      await this.updateActiveSearchData(rideId, {
        timeoutCheckIntervalId: timeoutCheckInterval
      });
      
      console.log(`⏰ Timeout global programmé pour ${rideId}`);
    }
    
    /**
     * Vérifier et gérer le timeout du matching
     */
    async checkAndHandleTimeout(rideId) {
      try {
        const matchingState = await this.parent.getMatchingState(rideId);
        
        if (!matchingState) {
          await this.cleanupMatching(rideId);
          return;
        }
        
        // Vérifier si le matching a expiré
        if (matchingState.expiresAt && Date.now() > matchingState.expiresAt) {
          console.log(`⏰ Timeout matching pour ${rideId}`);
          await this.handleMatchingTimeout(rideId);
          await this.cleanupMatching(rideId);
        }
        
      } catch (error) {
        console.error(`❌ Erreur vérification timeout ${rideId}:`, error);
      }
    }
    
    /**
     * Exécuter une recherche continue
     */
    async executeContinuousSearch(rideId, rideRequest) {
      try {
        // Vérifier que la recherche est toujours active
        if (!(await this.isSearchActive(rideId))) {
          console.log(`⏹️  Recherche ${rideId} n'est plus active, arrêt`);
          await this.cleanupMatching(rideId);
          return;
        }
        
        // Mettre à jour le compteur de recherches
        const searchData = await this.getActiveSearchData(rideId);
        if (searchData) {
          await this.updateActiveSearchData(rideId, {
            searchCount: (searchData.searchCount || 0) + 1,
            lastSearchAt: Date.now()
          });
        }
        
        await this.performSearch(rideId, rideRequest);
        
      } catch (error) {
        console.error(`❌ Erreur recherche continue ${rideId}:`, error);
      }
    }
    
    async performSearch(rideId, rideRequest) {
      try {
        const matchingState = await this.parent.getMatchingState(rideId);
        if (!matchingState || matchingState.status !== 'searching') {
          await this.cleanupMatching(rideId);
          return;
        }
        
        // Vérifier si le matching est toujours valide
        if (matchingState.expiresAt && Date.now() > matchingState.expiresAt) {
          console.log(`⏹️  Matching expiré pour ${rideId}, arrêt recherche`);
          await this.stop(rideId);
          return;
        }
        
        console.log(`🔍 Recherche périodique pour ${rideId}`);
        
        // Rechercher des chauffeurs disponibles
        const availableDrivers = await this.parent.findAvailableDrivers(rideRequest);
        
        if (availableDrivers.length === 0) {
          console.log(`❌ Aucun chauffeur trouvé pour ${rideId}`);
          return;
        }
        
        // Mettre à jour la liste des chauffeurs disponibles
        matchingState.availableDrivers = availableDrivers;
        matchingState.lastSearchAt = Date.now();
        await this.parent.saveMatchingState(rideId, matchingState);
        
        // Notifier le prochain chauffeur disponible
        const nextDriver = this.findNextDriverToNotify(matchingState);
        if (nextDriver) {
          await this.parent.notifyDriver(nextDriver.driverId, rideRequest);
          
          // Mettre à jour la liste des chauffeurs notifiés
          matchingState.notifiedDrivers.push({
            driverId: nextDriver.driverId,
            notifiedAt: Date.now(),
            status: 'pending'
          });
          await this.parent.saveMatchingState(rideId, matchingState);
        }
        
      } catch (error) {
        console.error('Erreur recherche:', error);
      }
    }
    
    findNextDriverToNotify(matchingState) {
      const { availableDrivers, notifiedDrivers } = matchingState;
      
      // Créer un Set des IDs déjà notifiés pour recherche rapide
      const notifiedIds = new Set(notifiedDrivers.map(n => n.driverId));
      
      // Trouver le premier chauffeur non notifié avec la meilleure priorité
      let bestDriver = null;
      
      for (const driver of availableDrivers) {
        if (!notifiedIds.has(driver.driverId)) {
          // Si c'est le premier ou si meilleure priorité/score
          if (!bestDriver || 
              driver.priority < bestDriver.priority ||
              (driver.priority === bestDriver.priority && driver.score > bestDriver.score)) {
            bestDriver = driver;
          }
        }
      }
      
      return bestDriver;
    }
    
    async handleMatchingTimeout(rideId) {
      const matchingState = await this.parent.getMatchingState(rideId);
      if (!matchingState) return;
      
      console.log(`⏰ Timeout matching pour ${rideId}`);
      
      // Mettre à jour le statut
      matchingState.status = 'timeout';
      matchingState.endedAt = Date.now();
      
      await this.parent.saveMatchingState(rideId, matchingState);
      
      // Notifier le client
      await this.parent.socketService.notifyCustomerNoDrivers(
        matchingState.customerId,
        rideId,
        {
            totalDriversNotified: matchingState.notifiedDrivers.length,
            totalDriversAvailable: matchingState.availableDrivers.length,
            matchingDuration: this.parent.MATCHING_DURATION
        }
      );
      
      // Nettoyer les intervalles
      await this.stop(rideId);
    }
    
    async stop(rideId) {
      // Nettoyer les données de recherche
      await this.cleanupSearchData(rideId);
      
      // Nettoyer les intervalles de recherche
      await this.intervalManager.clearIntervalsByKey(`continuous:matching:${rideId}`);
      
      // Nettoyer le timeout check
      await this.intervalManager.clearIntervalsByKey(`matching:timeout:check:${rideId}`);
      
      // Nettoyer le timeout global
      await redis.del(`matching:timeout:global:${rideId}`);
      
      console.log(`🛑 Matching continu arrêté pour ${rideId}`);
    }
    
    /**
     * Nettoyer les données de recherche
     */
    async cleanupSearchData(rideId) {
      try {
        // Retirer de la liste des recherches actives
        await redis.zrem(this.ACTIVE_SEARCHES_KEY, rideId);
        
        // Supprimer les données détaillées
        await redis.del(`${this.SEARCH_DATA_PREFIX}${rideId}`);
        
        console.log(`🧹 Données recherche nettoyées pour ${rideId}`);
        
      } catch (error) {
        console.error(`❌ Erreur nettoyage données recherche ${rideId}:`, error);
      }
    }
    
    /**
     * Nettoyer complètement le matching
     */
    async cleanupMatching(rideId) {
      await this.stop(rideId);
      
      // Nettoyer tous les intervalles liés à cette course
      await this.intervalManager.clearIntervalsByKey(`matching:${rideId}`);
      
      console.log(`🧹 Matching complètement nettoyé pour ${rideId}`);
    }
    
    /**
     * Vérifier et nettoyer les matchings orphelins au démarrage
     */
    async cleanupOrphanedMatching() {
      try {
        console.log('🔍 Vérification matchings orphelins...');
        
        // Récupérer toutes les recherches actives enregistrées
        const activeSearches = await this.getAllActiveSearches();
        
        for (const search of activeSearches) {
          const { rideId, startTime } = search;
          
          // Vérifier l'âge
          const age = Date.now() - startTime;
          const maxAge = this.parent.MATCHING_DURATION * 1000;
          
          if (age > maxAge) {
            console.log(`🧹 Nettoyage matching orphelin (trop ancien): ${rideId}`);
            await this.cleanupMatching(rideId);
            continue;
          }
          
          // Vérifier si l'état de matching existe toujours
          const matchingState = await this.parent.getMatchingState(rideId);
          
          if (!matchingState || matchingState.status !== 'searching') {
            console.log(`🧹 Nettoyage matching orphelin (état invalide): ${rideId}`);
            await this.cleanupMatching(rideId);
          }
        }
        
        // Nettoyer aussi les anciennes clés Redis
        await this.cleanupOldRedisKeys();
        
        console.log(`✅ Nettoyage matchings orphelins terminé`);
        
      } catch (error) {
        console.error('❌ Erreur nettoyage matchings orphelins:', error);
      }
    }
    
    /**
     * Nettoyer les anciennes clés Redis
     */
    async cleanupOldRedisKeys() {
      try {
        // Nettoyer les anciennes entrées du sorted set
        const cutoffTime = Date.now() - (this.parent.MATCHING_DURATION * 1000);
        await redis.zremrangebyscore(this.ACTIVE_SEARCHES_KEY, 0, cutoffTime);
        
        // Rechercher et nettoyer les données orphelines
        const pattern = `${this.SEARCH_DATA_PREFIX}*`;
        const keys = await redis.keys(pattern);
        
        for (const key of keys) {
          const rideId = key.replace(this.SEARCH_DATA_PREFIX, '');
          
          // Vérifier si toujours dans le sorted set
          const score = await redis.zscore(this.ACTIVE_SEARCHES_KEY, rideId);
          if (!score) {
            await redis.del(key);
            console.log(`🧹 Données orphelines nettoyées: ${rideId}`);
          }
        }
        
      } catch (error) {
        console.error('❌ Erreur nettoyage clés Redis:', error);
      }
    }
    
    /**
     * Obtenir les statistiques des recherches actives
     */
    async getStats() {
      try {
        const activeSearches = await this.getAllActiveSearches();
        
        return {
          totalActive: activeSearches.length,
          searches: activeSearches.map(search => ({
            rideId: search.rideId,
            age: Math.floor((Date.now() - search.startTime) / 1000),
            searchCount: search.searchCount || 0,
            lastSearchAt: search.lastSearchAt,
            status: search.status
          })),
          timestamp: Date.now()
        };
        
      } catch (error) {
        console.error('❌ Erreur récupération statistiques:', error);
        return { totalActive: 0, searches: [], timestamp: Date.now() };
      }
    }
}

module.exports = RideMatchingServiceOld;