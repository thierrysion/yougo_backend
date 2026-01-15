// services/RideMatchingService.js - Version finale avec état Redis
const redis = require('../config/redis');
const { sequelize, Driver, Ride, User } = require('../models');
const RedisIntervalManager = require('./RedisIntervalManager');
const DriverDiscovery = require('./DriverDiscovery');
const DriverReservation = require('./DriverReservation');

class RideMatchingService {
  constructor(socketService) {
    this.socketService = socketService;
    this.intervalManager = RedisIntervalManager;
    
    // Configuration
    this.CONFIG = {
      MATCHING_DURATION: 300,
      DRIVER_RESPONSE_TIMEOUT: 20,
      SEARCH_RADIUS_KM: 5,
      INITIAL_SEARCH_RADIUS: 5,
      MAX_SEARCH_RADIUS: 15,
      RADIUS_EXPANSION_FACTOR: 1.5,
      SEARCH_INTERVAL_INITIAL: 30,
      SEARCH_INTERVAL_EXTENDED: 45,
      SEARCH_INTERVAL_NO_DRIVERS: 15,
      MIN_QUEUE_SIZE: 3,
      IDEAL_QUEUE_SIZE: 5,
      MAX_QUEUE_SIZE: 10,
      NOTIFICATION_COOLDOWN: 2000,
      DRIVER_LOCATION_TTL: 300,
      DRIVER_DATA_TTL: 7200
    };
    
    // Clés Redis structurées
    this.REDIS_KEYS = {
      MATCHING_STATE: 'matching:state:',
      SEARCH_STATE: 'search:state:',
      ACTIVE_SEARCHES: 'active:searches',
      NOTIFICATION_QUEUE: 'notification:queue:',
      NOTIFICATION_STATE: 'notification:state:',
      ACTIVE_NOTIFICATIONS: 'active:notifications',
      DRIVER_TIMEOUT: 'timeout:driver:',
      GLOBAL_TIMEOUT: 'timeout:global:',
      DRIVER_CACHE: 'cache:driver:',
      SEARCH_CACHE: 'cache:search:',
      METRICS: 'metrics:',
      STATS_GLOBAL: 'stats:global'
    };
    
    this.initialize();
  }

  // ==================== INITIALISATION ====================

  async initialize() {
    console.log(`🚀 Initialisation RideMatchingService - Instance: ${this.intervalManager.instanceId}`);
    
    // Sous-services
    this.driverDiscovery = new DriverDiscovery(this.CONFIG);
    this.driverReservation = new DriverReservation(this.CONFIG);
    this.searchManager = new IntelligentSearchManager(this);
    this.notificationManager = new SequentialNotificationManager(this);
    this.matchingMonitor = new MatchingMonitor();
    
    // Initialiser RedisIntervalManager
    await this.intervalManager.initialize();
    
    // Nettoyer les états orphelins au démarrage
    await this.cleanupOrphanedStates();
    
    // Récupérer les matchings actifs
    await this.recoverActiveMatchings();
    
    console.log('✅ RideMatchingService initialisé (multi-instance ready)');
  }

  // ==================== API PRINCIPALE ====================

  async startMatching(rideRequest) {
    try {
      console.log(`🚀 Début matching pour course ${rideRequest.rideId}`);
      
      this.validateRideRequest(rideRequest);
      
      const existingState = await this.getMatchingState(rideRequest.rideId);
      if (existingState) {
        console.log(`⚠️  Matching déjà en cours pour ${rideRequest.rideId}`);
        return await this.getQueueStatus(rideRequest.rideId);
      }
      
      const matchingState = {
        rideId: rideRequest.rideId,
        customerId: rideRequest.customerId,
        pickupLocation: rideRequest.pickupLocation,
        rideTypeId: rideRequest.rideTypeId,
        status: 'searching',
        constraints: rideRequest.constraints || {},
        createdAt: Date.now(),
        expiresAt: Date.now() + (this.CONFIG.MATCHING_DURATION * 1000),
        notifiedDrivers: [],
        availableDrivers: [],
        stats: {
          searches: 0,
          driversFound: 0,
          driversNotified: 0,
          timeouts: 0
        }
      };
      
      await this.saveMatchingState(rideRequest.rideId, matchingState);
      
      const continuousMatching = new ContinuousMatching(this);
      await continuousMatching.start(rideRequest.rideId, rideRequest);
      
      await this.socketService.notifyMatchingStarted(
        rideRequest.customerId,
        rideRequest.rideId,
        {
          status: 'searching',
          message: 'Recherche de chauffeurs en cours',
          estimatedWaitTime: this.CONFIG.MATCHING_DURATION,
          searchRadius: rideRequest.constraints?.searchRadius || this.CONFIG.SEARCH_RADIUS_KM
        }
      );
      
      await this.startMatchingUpdates(rideRequest.rideId, rideRequest.customerId);
      await this.matchingMonitor.logEvent(rideRequest.rideId, 'matching_started', {
        rideRequest: this.sanitizeRideRequest(rideRequest)
      });
      
      return await this.getQueueStatus(rideRequest.rideId);
      
    } catch (error) {
      console.error('❌ Erreur démarrage matching:', error);
      await this.matchingMonitor.logError(rideRequest.rideId, 'startMatching', error);
      throw error;
    }
  }

  async handleDriverAcceptance(driverId, rideId) {
    try {
      console.log(`✅ Chauffeur ${driverId} accepte la course ${rideId}`);
      
      const matchingState = await this.getMatchingState(rideId);
      if (!matchingState || matchingState.status !== 'searching') {
        throw new Error('Course non disponible ou matching terminé');
      }
      
      const wasNotified = matchingState.notifiedDrivers?.some(
        d => d.driverId === driverId && d.status === 'pending'
      );
      
      if (!wasNotified) {
        throw new Error('Chauffeur non notifié pour cette course');
      }
      
      await this.driverReservation.release(driverId);
      
      const continuousMatching = new ContinuousMatching(this);
      await continuousMatching.stop(rideId);
      await this.stopMatchingUpdates(rideId);
      
      matchingState.status = 'accepted';
      matchingState.selectedDriver = driverId;
      matchingState.acceptedAt = Date.now();
      matchingState.endedAt = Date.now();
      
      await this.saveMatchingState(rideId, matchingState);
      
      const driver = await this.driverDiscovery.getDriverDetails(driverId);
      if (!driver) {
        throw new Error('Chauffeur non trouvé');
      }
      
      await this.socketService.notifyCustomerDriverAccepted(
        matchingState.customerId,
        driver,
        rideId
      );
      
      await this.updateRideWithDriver(rideId, driverId);
      await this.driverDiscovery.updateDriverStatus(driverId, 'in_ride', {
        currentRideId: rideId,
        rideAcceptedAt: Date.now()
      });
      
      await this.storeRideInfoInRedis(rideId, driverId);
      await this.startDriverLocationUpdates(rideId, driverId, matchingState.customerId);
      
      setTimeout(() => {
        this.cleanupMatchingState(rideId);
      }, 60000);
      
      await this.matchingMonitor.logEvent(rideId, 'driver_accepted', {
        driverId,
        matchingDuration: Date.now() - matchingState.createdAt
      });
      
      return {
        success: true,
        driver,
        rideId
      };
      
    } catch (error) {
      console.error('❌ Erreur acceptation chauffeur:', error);
      await this.matchingMonitor.logError(rideId, 'handleDriverAcceptance', error);
      
      const continuousMatching = new ContinuousMatching(this);
      await continuousMatching.performSearch(rideId, null);
      
      return {
        success: false,
        error: error.message
      };
    }
  }

  async handleDriverRejection(driverId, rideId, reason = 'refused') {
    try {
      console.log(`❌ Chauffeur ${driverId} refuse la course ${rideId}: ${reason}`);
      
      await this.driverReservation.release(driverId);
      
      const matchingState = await this.getMatchingState(rideId);
      if (matchingState) {
        const driverIndex = matchingState.notifiedDrivers?.findIndex(
          d => d.driverId === driverId
        );
        
        if (driverIndex !== -1) {
          matchingState.notifiedDrivers[driverIndex].status = reason;
          matchingState.notifiedDrivers[driverIndex].respondedAt = Date.now();
          await this.saveMatchingState(rideId, matchingState);
        }
        
        if (matchingState.status === 'searching') {
          const continuousMatching = new ContinuousMatching(this);
          await continuousMatching.performSearch(rideId, null);
        }
      }
      
      await this.matchingMonitor.logEvent(rideId, 'driver_rejected', {
        driverId,
        reason
      });
      
      return { success: true };
      
    } catch (error) {
      console.error('❌ Erreur gestion refus chauffeur:', error);
      return { success: false, error: error.message };
    }
  }

  // ==================== GESTION DES ÉTATS ====================

  async saveMatchingState(rideId, state) {
    const key = this.REDIS_KEYS.MATCHING_STATE + rideId;
    await redis.set(key, {
      ...state,
      instanceId: this.intervalManager.instanceId,
      lastUpdated: Date.now()
    }, this.CONFIG.MATCHING_DURATION + 300);
  }

  async getMatchingState(rideId) {
    const key = this.REDIS_KEYS.MATCHING_STATE + rideId;
    const state = await redis.get(key);
    
    if (!state) return null;
    
    if (state.instanceId !== this.intervalManager.instanceId) {
      const heartbeatKey = `instance:heartbeat:${state.instanceId}`;
      const heartbeat = await redis.get(heartbeatKey);
      
      if (!heartbeat || (Date.now() - parseInt(heartbeat)) > 300000) {
        state.instanceId = this.intervalManager.instanceId;
        state.lastUpdated = Date.now();
        await this.saveMatchingState(rideId, state);
      }
    }
    
    return state;
  }

  async getRideRequestFromState(rideId) {
    const state = await this.getMatchingState(rideId);
    if (!state) return null;
    
    return {
      rideId: state.rideId,
      customerId: state.customerId,
      pickupLocation: state.pickupLocation,
      rideTypeId: state.rideTypeId,
      constraints: state.constraints
    };
  }

  // ==================== UTILITAIRES ====================

  async startMatchingUpdates(rideId, customerId) {
    const intervalKey = `matching_updates:${rideId}`;
    
    const existingIntervals = await this.intervalManager.getIntervalsByKey(intervalKey);
    if (existingIntervals.length > 0) {
      console.log(`⚠️  Mises à jour déjà en cours pour ${rideId}`);
      return;
    }
    
    await this.intervalManager.createInterval(
      intervalKey,
      async (data) => {
        await this.executeMatchingUpdate(data.rideId, data.customerId);
      },
      10000,
      { rideId, customerId }
    );
    
    console.log(`🔄 Mises à jour démarrées pour ${rideId}`);
  }

  async executeMatchingUpdate(rideId, customerId) {
    try {
      const matchingState = await this.getMatchingState(rideId);
      
      if (!matchingState || matchingState.status !== 'searching') {
        console.log(`⏹️  Arrêt mises à jour pour ${rideId}`);
        await this.stopMatchingUpdates(rideId);
        return;
      }
      
      const elapsedTime = Math.floor((Date.now() - matchingState.createdAt) / 1000);
      const remainingTime = Math.floor((matchingState.expiresAt - Date.now()) / 1000);
      
      const updateData = {
        status: matchingState.status,
        elapsedTime,
        remainingTime,
        driversNotified: matchingState.notifiedDrivers?.length || 0,
        driversAvailable: matchingState.availableDrivers?.length || 0,
        searchRadius: matchingState.constraints?.searchRadius || this.CONFIG.SEARCH_RADIUS_KM,
        stats: matchingState.stats
      };
      
      await this.socketService.notifyMatchingStatus(customerId, rideId, updateData);
      
      if (elapsedTime % 30 === 0) {
        console.log(`📊 Matching ${rideId}: ${elapsedTime}s écoulées, ${remainingTime}s restantes`);
      }
      
    } catch (error) {
      console.error(`❌ Erreur mise à jour matching ${rideId}:`, error);
    }
  }

  async stopMatchingUpdates(rideId) {
    const intervalKey = `matching_updates:${rideId}`;
    await this.intervalManager.clearIntervalsByKey(intervalKey);
  }

  async startDriverLocationUpdates(rideId, driverId, customerId) {
    const intervalKey = `driver_location:${rideId}:${driverId}`;
    
    await this.intervalManager.createInterval(
      intervalKey,
      async (data) => {
        await this.executeLocationUpdate(data.rideId, data.driverId, data.customerId);
      },
      5000,
      { rideId, driverId, customerId }
    );
    
    console.log(`📍 Mises à jour position démarrées pour ${driverId}`);
  }

  async executeLocationUpdate(rideId, driverId, customerId) {
    try {
      const location = await this.driverDiscovery.getDriverLocation(driverId);
      
      if (location) {
        await this.socketService.notifyDriverLocationUpdate(
          customerId,
          rideId,
          {
            driverId,
            location,
            timestamp: Date.now(),
            rideId
          }
        );
      }
      
    } catch (error) {
      console.error(`❌ Erreur mise à jour position ${driverId}:`, error);
    }
  }

  async stopDriverLocationUpdates(rideId, driverId) {
    const intervalKey = `driver_location:${rideId}:${driverId}`;
    await this.intervalManager.clearIntervalsByKey(intervalKey);
  }

  // ==================== MAINTENANCE ====================

  async cleanupOrphanedStates() {
    console.log('🧹 Nettoyage états orphelins...');
    
    await this.searchManager.cleanupOrphanedSearchStates();
    await this.notificationManager.recoverOrphanedQueues();
    
    const pattern = this.REDIS_KEYS.MATCHING_STATE + '*';
    const keys = await redis.keys(pattern);
    
    for (const key of keys) {
      const state = await redis.get(key);
      if (state && state.expiresAt && Date.now() > state.expiresAt) {
        const rideId = key.replace(this.REDIS_KEYS.MATCHING_STATE, '');
        await this.cleanupMatchingState(rideId);
      }
    }
    
    console.log('✅ Nettoyage terminé');
  }

  async recoverActiveMatchings() {
    try {
      console.log('🔍 Récupération matchings actifs...');
      const pattern = this.REDIS_KEYS.MATCHING_STATE + '*';
      const keys = await redis.keys(pattern);
      
      let recovered = 0;
      
      for (const key of keys) {
        const state = await redis.get(key);
        if (state && state.instanceId === this.intervalManager.instanceId) {
          const rideId = key.replace(this.REDIS_KEYS.MATCHING_STATE, '');
          
          if (state.status === 'searching') {
            console.log(`🔄 ${rideId}: Reprise matching actif`);
            
            const rideRequest = await this.getRideRequestFromState(rideId);
            if (rideRequest) {
              const continuousMatching = new ContinuousMatching(this);
              await continuousMatching.start(rideId, rideRequest);
              recovered++;
            }
          }
        }
      }
      
      console.log(`✅ ${recovered} matchings récupérés`);
    } catch (error) {
      console.error('❌ Erreur récupération matchings:', error);
    }
  }

  async cleanupMatchingState(rideId) {
    await redis.del(this.REDIS_KEYS.MATCHING_STATE + rideId);
    await this.notificationManager.stopSequentialNotifications(rideId);
    await redis.del(this.REDIS_KEYS.SEARCH_CACHE + rideId);
    console.log(`🧹 État matching nettoyé pour ${rideId}`);
  }

  async getQueueStatus(rideId) {
    const state = await this.getMatchingState(rideId);
    if (!state) return null;
    
    return {
      rideId,
      status: state.status,
      driversAvailable: state.availableDrivers?.length || 0,
      driversNotified: state.notifiedDrivers?.length || 0,
      searchRadius: state.constraints?.searchRadius || this.CONFIG.SEARCH_RADIUS_KM,
      elapsedTime: Math.floor((Date.now() - state.createdAt) / 1000),
      remainingTime: Math.floor((state.expiresAt - Date.now()) / 1000),
      stats: state.stats
    };
  }

  validateRideRequest(rideRequest) {
    if (!rideRequest.rideId) throw new Error('rideId requis');
    if (!rideRequest.customerId) throw new Error('customerId requis');
    if (!rideRequest.pickupLocation) throw new Error('pickupLocation requis');
    if (!rideRequest.rideTypeId) throw new Error('rideTypeId requis');
  }

  sanitizeRideRequest(rideRequest) {
    return {
      rideId: rideRequest.rideId,
      customerId: rideRequest.customerId,
      rideTypeId: rideRequest.rideTypeId,
      hasConstraints: !!rideRequest.constraints
    };
  }

  // ===================== NOTIFICATION CHAUFFEUR ===================

  /**
   * Notifier un chauffeur et informer le client
   */
  async notifySingleDriver(driverId, rideRequest) {
    try {
      console.log(`📨 Notification chauffeur ${driverId} pour ${rideRequest.rideId}`);
      
      // 1. Informer le client qu'un chauffeur est en cours de notification
      /*await this.notifyCustomerDriverNotificationStarted(
        rideRequest.customerId,
        rideRequest.rideId,
        driverId
      );*/
      
      // 2. Réserver le chauffeur
      await this.driverReservation.reserve(driverId, rideRequest.rideId);
      
      // 3. Récupérer les détails du chauffeur
      const driver = await this.driverDiscovery.getDriverDetails(driverId);
      if (!driver) {
        throw new Error('Chauffeur non trouvé');
      }
      
      // 4. Préparer la notification
      const notification = {
        rideId: rideRequest.rideId,
        customerId: rideRequest.customerId,
        pickupLocation: rideRequest.pickupLocation,
        rideTypeId: rideRequest.rideTypeId,
        constraints: rideRequest.constraints || {},
        driver,
        expiresIn: this.CONFIG.DRIVER_RESPONSE_TIMEOUT,
        timestamp: Date.now(),
        notificationType: 'sequential'
      };
      
      // 5. Envoyer la notification au chauffeur
      const notified = await this.socketService.notifyDriverForRide(driverId, notification);
      
      if (!notified) {
        await this.driverReservation.release(driverId);
        
        // Informer le client de l'échec de notification
        /*await this.notifyCustomerDriverNotificationFailed(
          rideRequest.customerId,
          rideRequest.rideId,
          driverId,
          'driver_unreachable'
        );*/
        
        return false;
      }
      
      // 6. Informer le client que le chauffeur a été notifié avec succès
      /*await this.notifyCustomerDriverNotified(
        rideRequest.customerId,
        rideRequest.rideId,
        {
          driverId,
          driverName: `${driver.firstName} ${driver.lastName}`,
          vehicle: `${driver.vehicleMake} ${driver.vehicleModel}`,
          licensePlate: driver.licensePlate,
          rating: driver.rating,
          responseTimeout: this.CONFIG.DRIVER_RESPONSE_TIMEOUT,
          timestamp: Date.now()
        }
      );*/


      // 7. Mettre à jour les statistiques
      const matchingState = await this.getMatchingState(rideRequest.rideId);
      if (matchingState) {
        matchingState.stats.driversNotified++;
        await this.saveMatchingState(rideRequest.rideId, matchingState);
      }
      
      console.log(`✅ Chauffeur ${driverId} notifié avec succès`);
      return true;
      
    } catch (error) {
      console.error(`❌ Erreur notification chauffeur ${driverId}:`, error);
      
      // Libérer la réservation en cas d'erreur
      await this.driverReservation.release(driverId);
      
      // Informer le client de l'erreur
      /*await this.notifyCustomerDriverNotificationFailed(
        rideRequest.customerId,
        rideRequest.rideId,
        driverId,
        'notification_error'
      );*/
      
      return false;
    }
  }

  /**
   * Gérer le timeout d'un chauffeur
   */
  async handleDriverTimeout(driverId, rideId) {
    try {
      console.log(`⏰ Timeout chauffeur ${driverId} pour ${rideId}`);
      
      // 1. Libérer la réservation
      await this.driverReservation.release(driverId);
      
      // 2. Récupérer l'état du matching
      const matchingState = await this.getMatchingState(rideId);
      if (!matchingState) return;
      
      // 3. Récupérer les infos du chauffeur
      const driver = await this.driverDiscovery.getDriverDetails(driverId);
      
      // 4. Informer le client du timeout
      await this.notifyCustomerDriverTimeout(
        matchingState.customerId,
        rideId,
        {
          driverId,
          driverName: driver ? `${driver.firstName} ${driver.lastName}` : 'Chauffeur',
          timeoutDuration: this.CONFIG.DRIVER_RESPONSE_TIMEOUT,
          timestamp: Date.now(),
          reason: 'no_response'
        }
      );
      
      // 5. Mettre à jour l'état du matching
      const driverIndex = matchingState.notifiedDrivers?.findIndex(
        d => d.driverId === driverId
      );
      
      if (driverIndex !== -1) {
        matchingState.notifiedDrivers[driverIndex].status = 'timeout';
        matchingState.notifiedDrivers[driverIndex].respondedAt = Date.now();
        matchingState.notifiedDrivers[driverIndex].timeoutAt = Date.now();
        await this.saveMatchingState(rideId, matchingState);
      }
      
      // 6. Mettre à jour les statistiques
      matchingState.stats.timeouts = (matchingState.stats.timeouts || 0) + 1;
      await this.saveMatchingState(rideId, matchingState);
      
      // 7. Log l'événement
      await this.matchingMonitor.logEvent(rideId, 'driver_timeout', {
        driverId,
        responseTime: this.CONFIG.DRIVER_RESPONSE_TIMEOUT
      });
      
      console.log(`📢 Client informé du timeout de ${driverId}`);
      
    } catch (error) {
      console.error(`❌ Erreur gestion timeout ${driverId}:`, error);
      await this.matchingMonitor.logError(rideId, 'handleDriverTimeout', error);
    }
  }

  /**
   * Gérer le refus d'un chauffeur
   */
  async handleDriverRejection(driverId, rideId, reason = 'refused') {
    try {
      console.log(`❌ Chauffeur ${driverId} refuse la course ${rideId}: ${reason}`);
      
      // 1. Libérer la réservation
      await this.driverReservation.release(driverId);
      
      // 2. Récupérer l'état du matching
      const matchingState = await this.getMatchingState(rideId);
      if (!matchingState) return { success: true };
      
      // 3. Récupérer les infos du chauffeur
      const driver = await this.driverDiscovery.getDriverDetails(driverId);
      
      // 4. Informer le client du refus
      await this.notifyCustomerDriverRejected(
        matchingState.customerId,
        rideId,
        {
          driverId,
          driverName: driver ? `${driver.firstName} ${driver.lastName}` : 'Chauffeur',
          vehicle: driver ? `${driver.vehicleMake} ${driver.vehicleModel}` : null,
          rating: driver ? driver.rating : null,
          reason: this.getRejectionReasonMessage(reason),
          timestamp: Date.now()
        }
      );
      
      // 5. Mettre à jour l'état du matching
      const driverIndex = matchingState.notifiedDrivers?.findIndex(
        d => d.driverId === driverId
      );
      
      if (driverIndex !== -1) {
        matchingState.notifiedDrivers[driverIndex].status = reason;
        matchingState.notifiedDrivers[driverIndex].respondedAt = Date.now();
        matchingState.notifiedDrivers[driverIndex].rejectionReason = reason;
        await this.saveMatchingState(rideId, matchingState);
      }
      
      // 6. Relancer la recherche si nécessaire
      if (matchingState.status === 'searching') {
        const continuousMatching = new ContinuousMatching(this);
        await continuousMatching.performSearch(rideId, null);
      }
      
      // 7. Log l'événement
      await this.matchingMonitor.logEvent(rideId, 'driver_rejected', {
        driverId,
        reason
      });
      
      console.log(`📢 Client informé du refus de ${driverId}`);
      
      return { success: true };
      
    } catch (error) {
      console.error('❌ Erreur gestion refus chauffeur:', error);
      await this.matchingMonitor.logError(rideId, 'handleDriverRejection', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Gérer l'acceptation d'un chauffeur
   */
  async handleDriverAcceptance(driverId, rideId) {
    try {
      console.log(`✅ Chauffeur ${driverId} accepte la course ${rideId}`);
      
      // 1. Récupérer l'état du matching
      const matchingState = await this.getMatchingState(rideId);
      if (!matchingState || matchingState.status !== 'searching') {
        throw new Error('Course non disponible ou matching terminé');
      }
      
      // 2. Vérifier que le chauffeur était bien notifié
      const wasNotified = matchingState.notifiedDrivers?.some(
        d => d.driverId === driverId && d.status === 'pending'
      );
      
      if (!wasNotified) {
        throw new Error('Chauffeur non notifié pour cette course');
      }
      
      // 3. Récupérer les infos du chauffeur
      const driver = await this.driverDiscovery.getDriverDetails(driverId);
      if (!driver) {
        throw new Error('Chauffeur non trouvé');
      }
      
      // 4. Informer le client de l'acceptation IMMÉDIATEMENT
      await this.notifyCustomerDriverAccepted(
        matchingState.customerId,
        rideId,
        {
          driverId,
          driverName: `${driver.firstName} ${driver.lastName}`,
          vehicle: `${driver.vehicleMake} ${driver.vehicleModel}`,
          licensePlate: driver.licensePlate,
          rating: driver.rating,
          phoneNumber: driver.phoneNumber,
          profilePicture: driver.profilePicture,
          estimatedArrival: this.calculateEstimatedArrival(driver.distance),
          timestamp: Date.now()
        }
      );
      
      // 5. Libérer la réservation
      await this.driverReservation.release(driverId);
      
      // 6. Arrêter tous les timeouts et intervalles
      const continuousMatching = new ContinuousMatching(this);
      await continuousMatching.stop(rideId);
      await this.stopMatchingUpdates(rideId);
      
      // 7. Mettre à jour l'état
      matchingState.status = 'accepted';
      matchingState.selectedDriver = driverId;
      matchingState.acceptedAt = Date.now();
      matchingState.endedAt = Date.now();
      
      await this.saveMatchingState(rideId, matchingState);
      
      // 8. Mettre à jour la base de données
      await this.updateRideWithDriver(rideId, driverId);
      
      // 9. Mettre à jour le statut du chauffeur
      await this.driverDiscovery.updateDriverStatus(driverId, 'in_ride', {
        currentRideId: rideId,
        rideAcceptedAt: Date.now()
      });
      
      // 10. Stocker dans Redis pour tracking
      await this.storeRideInfoInRedis(rideId, driverId);
      
      // 11. Démarrer les mises à jour de position
      await this.startDriverLocationUpdates(rideId, driverId, matchingState.customerId);
      
      // 12. Log l'événement
      await this.matchingMonitor.logEvent(rideId, 'driver_accepted', {
        driverId,
        matchingDuration: Date.now() - matchingState.createdAt,
        driversNotified: matchingState.notifiedDrivers?.length || 0
      });
      
      // 13. Nettoyer après délai
      setTimeout(() => {
        this.cleanupMatchingState(rideId);
      }, 60000);
      
      console.log(`📢 Client informé de l'acceptation de ${driverId}`);
      
      return {
        success: true,
        driver,
        rideId
      };
      
    } catch (error) {
      console.error('❌ Erreur acceptation chauffeur:', error);
      await this.matchingMonitor.logError(rideId, 'handleDriverAcceptance', error);
      
      // Réactiver le matching si erreur
      const continuousMatching = new ContinuousMatching(this);
      await continuousMatching.performSearch(rideId, null);
      
      return {
        success: false,
        error: error.message
      };
    }
  }

  // ==================== NOTIFICATIONS CLIENT ====================

  /**
   * Informer le client qu'un chauffeur est en cours de notification
   */
  async notifyCustomerDriverNotificationStarted(customerId, rideId, driverId) {
    try {
      await this.socketService.notifyCustomerDriverNotificationStarted(
        customerId,
        rideId,
        {
          driverId,
          status: 'notifying',
          message: 'Contact du chauffeur en cours...',
          timestamp: Date.now()
        }
      );
    } catch (error) {
      console.error(`❌ Erreur notification démarrage chauffeur:`, error);
    }
  }

  /**
   * Informer le client qu'un chauffeur a été notifié
   */
  async notifyCustomerDriverNotified(customerId, rideId, driverInfo) {
    try {
      await this.socketService.notifyCustomerDriverNotified(
        customerId,
        rideId,
        {
          ...driverInfo,
          status: 'waiting_response',
          message: `Chauffeur ${driverInfo.driverName} notifié. Attente de réponse...`,
          countdown: this.CONFIG.DRIVER_RESPONSE_TIMEOUT
        }
      );
    } catch (error) {
      console.error(`❌ Erreur notification chauffeur notifié:`, error);
    }
  }

  /**
   * Informer le client d'un échec de notification
   */
  async notifyCustomerDriverNotificationFailed(customerId, rideId, driverId, reason) {
    try {
      await this.socketService.notifyCustomerDriverNotificationFailed(
        customerId,
        rideId,
        {
          driverId,
          reason,
          status: 'notification_failed',
          message: this.getNotificationFailedMessage(reason),
          timestamp: Date.now(),
          nextAction: 'searching_next_driver'
        }
      );
    } catch (error) {
      console.error(`❌ Erreur notification échec chauffeur:`, error);
    }
  }

  /**
   * Informer le client d'un timeout
   */
  async notifyCustomerDriverTimeout(customerId, rideId, timeoutInfo) {
    try {
      await this.socketService.notifyCustomerDriverTimeout(
        customerId,
        rideId,
        {
          ...timeoutInfo,
          status: 'driver_timeout',
          message: `${timeoutInfo.driverName} n'a pas répondu dans les délais`,
          nextAction: 'searching_next_driver',
          estimatedNextSearch: this.CONFIG.NOTIFICATION_COOLDOWN / 1000
        }
      );
    } catch (error) {
      console.error(`❌ Erreur notification timeout:`, error);
    }
  }

  /**
   * Informer le client d'un refus
   */
  async notifyCustomerDriverRejected(customerId, rideId, rejectionInfo) {
    try {
      await this.socketService.notifyCustomerDriverRejected(
        customerId,
        rideId,
        {
          ...rejectionInfo,
          status: 'driver_rejected',
          message: `${rejectionInfo.driverName} a décliné la course`,
          nextAction: 'searching_next_driver',
          estimatedNextSearch: this.CONFIG.NOTIFICATION_COOLDOWN / 1000
        }
      );
    } catch (error) {
      console.error(`❌ Erreur notification refus:`, error);
    }
  }

  /**
   * Informer le client d'une acceptation
   */
  async notifyCustomerDriverAccepted(customerId, rideId, driverInfo) {
    try {
      await this.socketService.notifyCustomerDriverAccepted(
        customerId,
        rideId,
        {
          ...driverInfo,
          status: 'driver_accepted',
          message: `🎉 ${driverInfo.driverName} a accepté votre course !`,
          nextSteps: [
            'Le chauffeur se dirige vers votre point de prise en charge',
            'Vous pouvez suivre sa position en temps réel',
            'Préparez-vous pour le départ'
          ]
        }
      );
    } catch (error) {
      console.error(`❌ Erreur notification acceptation:`, error);
    }
  }

  // ==================== UTILITAIRES DE MESSAGES ====================

  /**
   * Obtenir le message d'échec de notification
   */
  getNotificationFailedMessage(reason) {
    const messages = {
      'driver_unreachable': 'Le chauffeur est actuellement injoignable',
      'notification_error': 'Erreur lors de la notification du chauffeur',
      'driver_offline': 'Le chauffeur est hors ligne',
      'reservation_failed': 'Impossible de réserver le chauffeur',
      'default': 'Impossible de contacter le chauffeur'
    };
    
    return messages[reason] || messages.default;
  }

  /**
   * Obtenir le message de refus
   */
  getRejectionReasonMessage(reason) {
    const messages = {
      'refused': 'A refusé la course',
      'busy': 'Actuellement occupé',
      'too_far': 'Trop éloigné de votre position',
      'off_duty': 'Hors service',
      'vehicle_issue': 'Problème avec le véhicule',
      'default': 'A décliné la course'
    };
    
    return messages[reason] || messages.default;
  }

  /**
   * Calculer l'arrivée estimée
   */
  calculateEstimatedArrival(distanceKm) {
    // Estimation: 2 minutes de base + 2 minutes par km
    const baseMinutes = 2;
    const minutesPerKm = 2;
    const estimatedMinutes = baseMinutes + (distanceKm * minutesPerKm);
    
    const arrivalTime = new Date(Date.now() + (estimatedMinutes * 60000));
    
    return {
      minutes: Math.round(estimatedMinutes),
      time: arrivalTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      timestamp: arrivalTime.getTime()
    };
  }

  async handleDriverResponse(driverId, rideId, response) {
    try {
      console.log(`📨 Réponse chauffeur ${driverId} pour ${rideId}: ${response}`);
      
      const result = await this.notificationManager.handleDriverResponse(
        rideId, 
        driverId, 
        response
      );
      
      if (response === 'accepted') {
        return await this.handleDriverAcceptance(driverId, rideId);
      } else {
        await this.handleDriverRejection(driverId, rideId, response);
        
        if (result?.action === 'continue') {
          return { action: 'continue', nextDriverExpected: true };
        }
      }
      
      return { success: true };
      
    } catch (error) {
      console.error('❌ Erreur traitement réponse chauffeur:', error);
      return { success: false, error: error.message };
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
    
    await redis.set(rideKey, rideData, 3600);
    await redis.hset('driver:active:rides', driverId, rideId);
    await redis.expire('driver:active:rides', 3600);
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

  // ==================== RECHERCHE DE CHAUFFEURS DISPONIBLES ====================

  /**
   * Trouver les chauffeurs disponibles pour une course
   */
  async findAvailableDrivers(rideRequest) {
    try {
      console.log(`🔍 Recherche chauffeurs pour ${rideRequest.rideId}`);
      
      const {
        pickupLocation,
        rideTypeId,
        constraints = {}
      } = rideRequest;
      
      const radiusKm = constraints.searchRadius || this.CONFIG.SEARCH_RADIUS_KM;
      
      // 1. Rechercher les chauffeurs libres (connectés et disponibles)
      const freeDrivers = await this.driverDiscovery.findFreeDrivers(
        pickupLocation,
        rideTypeId,
        radiusKm
      );
      
      console.log(`✅ ${freeDrivers.length} chauffeurs libres trouvés`);
      
      // 2. Rechercher les chauffeurs en fin de course
      const finishingDrivers = await this.driverDiscovery.findFinishingRideDrivers(
        pickupLocation,
        rideTypeId,
        radiusKm
      );
      
      console.log(`⏳ ${finishingDrivers.length} chauffeurs en fin de course trouvés`);
      
      // 3. Fusionner et dédupliquer les listes
      const allDrivers = this.driverDiscovery.mergeDrivers(freeDrivers, finishingDrivers);
      
      console.log(`📊 Total chauffeurs potentiels: ${allDrivers.length}`);
      
      // 4. Filtrer les chauffeurs déjà réservés
      const filteredDrivers = [];
      
      for (const driver of allDrivers) {
        const isReserved = await this.driverReservation.isDriverReserved(driver.driverId);
        
        if (!isReserved) {
          // Calculer le score de matching
          const score = this.calculateDriverMatchingScore(driver);
          
          filteredDrivers.push({
            ...driver,
            score,
            matchingScore: score // Alias pour compatibilité
          });
        } else {
          console.log(`⏸️  Chauffeur ${driver.driverId} déjà réservé, ignoré`);
        }
      }
      
      console.log(`🎯 ${filteredDrivers.length} chauffeurs disponibles après filtrage`);
      
      // 5. Trier par priorité et score
      const sortedDrivers = this.sortAvailableDrivers(filteredDrivers);
      
      // 6. Limiter le nombre de résultats
      const maxDrivers = constraints.maxDrivers || this.CONFIG.MAX_QUEUE_SIZE;
      const limitedDrivers = sortedDrivers.slice(0, maxDrivers);
      
      console.log(`📋 ${limitedDrivers.length} chauffeurs retenus pour notification`);
      
      // 7. Mettre en cache les résultats
      if (limitedDrivers.length > 0) {
        await this.cacheSearchResults(rideRequest.rideId, limitedDrivers);
      }
      
      return limitedDrivers;
      
    } catch (error) {
      console.error('❌ Erreur recherche chauffeurs disponibles:', error);
      await this.matchingMonitor.logError(rideRequest.rideId, 'findAvailableDrivers', error);
      return [];
    }
  }

  /**
   * Calculer le score de matching pour un chauffeur
   */
  calculateDriverMatchingScore(driver) {
    const weights = {
      distance: 0.35,          // Plus proche = meilleur
      rating: 0.25,            // Meilleure note = meilleur
      acceptanceRate: 0.15,    // Taux d'acceptation élevé = meilleur
      experience: 0.10,        // Plus d'expérience = meilleur
      statusBonus: 0.10,       // Libre vs fin de course
      responseTime: 0.05       // Temps de réponse historique
    };
    
    // Normaliser la distance (0-100 score)
    // Ex: 0km = 100 points, 10km = 0 points
    const distanceScore = Math.max(0, 100 - (driver.distance * 10));
    
    // Normaliser le rating (1-5 étoiles → 0-100)
    const ratingScore = Math.min(100, ((driver.rating || 4.0) - 1) * 25);
    
    // Taux d'acceptation (0-100%)
    const acceptanceScore = Math.min(100, driver.acceptanceRate || 50);
    
    // Expérience (nombre de courses)
    const experienceScore = Math.min(100, Math.log10((driver.totalRides || 0) + 1) * 20);
    
    // Bonus selon le statut
    let statusBonus = 0;
    if (driver.status === 'available') {
      statusBonus = 100; // Chauffeur libre = meilleur
    } else if (driver.status === 'in_ride' && driver.estimatedCompletionIn) {
      // Chauffeur en fin de course: plus il finit tôt, mieux c'est
      const completionInSeconds = driver.estimatedCompletionIn;
      if (completionInSeconds <= 60) {
        statusBonus = 80; // Finit dans 1 minute
      } else if (completionInSeconds <= 180) {
        statusBonus = 60; // Finit dans 3 minutes
      } else {
        statusBonus = 40; // Finit dans plus de 3 minutes
      }
    }
    
    // Temps de réponse historique (plus rapide = mieux)
    const avgResponseTime = driver.avgResponseTime || 30; // secondes par défaut
    const responseTimeScore = Math.max(0, 100 - avgResponseTime);
    
    // Calcul final pondéré
    const totalScore = Math.round(
      distanceScore * weights.distance +
      ratingScore * weights.rating +
      acceptanceScore * weights.acceptanceRate +
      experienceScore * weights.experience +
      statusBonus * weights.statusBonus +
      responseTimeScore * weights.responseTime
    );
    
    return Math.min(100, Math.max(0, totalScore));
  }

  /**
   * Trier les chauffeurs disponibles
   */
  sortAvailableDrivers(drivers) {
    return drivers.sort((a, b) => {
      // 1. Par priorité (libres > en fin de course)
      if (a.priority !== b.priority) {
        return a.priority - b.priority;
      }
      
      // 2. Par score de matching (décroissant)
      if (a.score !== b.score) {
        return b.score - a.score;
      }
      
      // 3. Par distance (croissant)
      if (a.distance !== b.distance) {
        return a.distance - b.distance;
      }
      
      // 4. Par rating (décroissant)
      return (b.rating || 0) - (a.rating || 0);
    });
  }

  /**
   * Mettre en cache les résultats de recherche
   */
  async cacheSearchResults(rideId, drivers) {
    try {
      const cacheKey = this.REDIS_KEYS.SEARCH_CACHE + rideId;
      const cacheData = {
        rideId,
        drivers: drivers.map(d => ({
          driverId: d.driverId,
          score: d.score,
          distance: d.distance,
          status: d.status,
          cachedAt: Date.now()
        })),
        cachedAt: Date.now(),
        expiresAt: Date.now() + (30 * 1000) // 30 secondes
      };
      
      await redis.setex(cacheKey, 30, cacheData);
      console.log(`💾 ${rideId}: ${drivers.length} chauffeurs mis en cache`);
      
    } catch (error) {
      console.error('❌ Erreur mise en cache:', error);
    }
  }

  /**
   * Obtenir les résultats de recherche depuis le cache
   */
  async getCachedSearchResults(rideId) {
    try {
      const cacheKey = this.REDIS_KEYS.SEARCH_CACHE + rideId;
      const cached = await redis.get(cacheKey);
      
      if (cached && cached.expiresAt > Date.now()) {
        console.log(`💾 ${rideId}: Utilisation cache (${cached.drivers.length} chauffeurs)`);
        return cached.drivers;
      }
      
      return null;
    } catch (error) {
      console.error('❌ Erreur récupération cache:', error);
      return null;
    }
  }
}

// ==================== SOUS-CLASSES RESTANTES ====================
/*
class DriverDiscovery {
  constructor(config) {
    this.config = config;
  }
  
  async findFreeDrivers(pickupLocation, rideTypeId, radiusKm) {
    const geoKey = 'drivers:geo:locations';
    
    try {
      const radiusMeters = radiusKm * 1000;
      const geoResults = await redis.georadius(
        geoKey,
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
        const [driverId, distance, coordinates] = result;
        
        const driverData = await this.getDriverData(driverId);
        
        if (driverData && this.isDriverEligible(driverData, rideTypeId, 'available')) {
          drivers.push({
            driverId,
            ...driverData,
            distance: parseFloat(distance) / 1000,
            priority: 1,
            status: 'available',
            source: 'connected',
            coordinates: coordinates ? {
              longitude: parseFloat(coordinates[0]),
              latitude: parseFloat(coordinates[1])
            } : null
          });
        }
      }
      
      return this.sortDriversByPriority(drivers);
      
    } catch (error) {
      console.error('❌ Erreur recherche chauffeurs libres:', error);
      return [];
    }
  }
  
  async findFinishingRideDrivers(pickupLocation, rideTypeId, radiusKm) {
    try {
      const inRideDriverIds = await redis.zrange('drivers:status:in_ride', 0, -1);
      if (inRideDriverIds.length === 0) return [];
      
      const finishingDrivers = [];
      const now = Date.now();
      
      for (const driverId of inRideDriverIds) {
        try {
          const driverKey = `driver:${driverId}`;
          const driverData = await redis.get(driverKey);
          
          if (!driverData || driverData.vehicleType !== rideTypeId) continue;
          
          const rideId = await redis.hget('driver:active:rides', driverId);
          if (!rideId) continue;
          
          const rideKey = `ride:active:${rideId}`;
          const rideData = await redis.get(rideKey);
          
          if (!rideData) continue;
          
          const rideProgress = await this.calculateRideProgress(rideId, driverData);
          
          if (rideProgress.percentage >= 75 && rideProgress.estimatedCompletion) {
            const timeToCompletion = rideProgress.estimatedCompletion - now;
            
            if (timeToCompletion <= 5 * 60 * 1000) {
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
                    estimatedCompletionIn: Math.floor(timeToCompletion / 1000),
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
      
      return finishingDrivers;
    } catch (error) {
      console.error('Erreur recherche chauffeurs en fin de course:', error);
      return [];
    }
  }
  
  async getDriverDetails(driverId) {
    const driverKey = `driver:${driverId}`;
    const driverData = await redis.get(driverKey);
    
    if (driverData) return driverData;
    
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
  
  // ... autres méthodes ...
}

class DriverReservation {
  constructor(config) {
    this.config = config;
    this.RESERVATION_PREFIX = 'reservation:';
  }
  
  async reserve(driverId, rideId) {
    try {
      if (await this.isDriverReserved(driverId)) {
        throw new Error(`Driver ${driverId} already reserved`);
      }
      
      const reservation = {
        driverId,
        rideId,
        reservedUntil: Date.now() + (this.config.RESERVATION_DURATION * 1000),
        createdAt: Date.now()
      };
      
      const reservationKey = `${this.RESERVATION_PREFIX}${driverId}`;
      await redis.set(reservationKey, reservation, this.config.RESERVATION_DURATION);
      
      const rideReservationKey = `ride:reservations:${rideId}`;
      await redis.sadd(rideReservationKey, driverId);
      await redis.expire(rideReservationKey, this.config.RESERVATION_DURATION);
      
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
      const rideReservationKey = `ride:reservations:${reservation.rideId}`;
      await redis.srem(rideReservationKey, driverId);
      await redis.del(reservationKey);
      console.log(`🔓 Chauffeur ${driverId} libéré`);
      return true;
    }
    
    return false;
  }
}
*/

class MatchingMonitor {
  async logEvent(rideId, event, data) {
    const key = `matching:events:${rideId}`;
    await redis.lpush(key, JSON.stringify({
      event,
      data,
      timestamp: Date.now(),
      instanceId: require('./RedisIntervalManager').instanceId
    }));
    await redis.ltrim(key, 0, 99);
  }
  
  async logError(rideId, context, error) {
    const errorKey = `matching:errors:${rideId}`;
    await redis.lpush(errorKey, JSON.stringify({
      context,
      error: error.message,
      stack: error.stack,
      timestamp: Date.now()
    }));
    await redis.ltrim(errorKey, 0, 49);
  }
  
  async logMetrics(rideId, metrics) {
    const key = `metrics:matching:${rideId}`;
    await redis.lpush(key, JSON.stringify({
      ...metrics,
      timestamp: Date.now()
    }));
    await redis.ltrim(key, 0, 49);
  }
}

// ==================== INTELLIGENT SEARCH MANAGER (REDIS) ====================

class IntelligentSearchManager {
  constructor(parentService) {
    this.parent = parentService;
    this.instanceId = parentService.intervalManager.instanceId;
  }

  async initializeSearchState(rideId) {
    const searchKey = this.parent.REDIS_KEYS.SEARCH_STATE + rideId;
    
    const state = {
      rideId,
      instanceId: this.instanceId,
      searchRadius: this.parent.CONFIG.INITIAL_SEARCH_RADIUS,
      lastSearchAt: null,
      nextSearchAt: Date.now(),
      searchInterval: this.parent.CONFIG.SEARCH_INTERVAL_INITIAL,
      searchCount: 0,
      driversFound: 0,
      driversInQueue: 0,
      lastDriverFoundAt: null,
      status: 'active',
      createdAt: Date.now(),
      lastUpdated: Date.now()
    };
    
    await redis.set(searchKey, state, this.parent.CONFIG.MATCHING_DURATION + 300);
    await redis.zadd(this.parent.REDIS_KEYS.ACTIVE_SEARCHES, Date.now(), rideId);
    
    console.log(`🔍 ${rideId}: État recherche initialisé dans Redis`);
    return state;
  }

  async getSearchState(rideId) {
    const searchKey = this.parent.REDIS_KEYS.SEARCH_STATE + rideId;
    return await redis.get(searchKey);
  }

  async updateSearchState(rideId, updates) {
    const searchKey = this.parent.REDIS_KEYS.SEARCH_STATE + rideId;
    const currentState = await this.getSearchState(rideId) || {};
    
    const newState = {
      ...currentState,
      ...updates,
      instanceId: this.instanceId,
      lastUpdated: Date.now()
    };
    
    await redis.set(searchKey, newState, this.parent.CONFIG.MATCHING_DURATION + 300);
    return newState;
  }

  async shouldSearchNow(rideId, currentQueueSize = 0) {
    const state = await this.getSearchState(rideId);
    if (!state || state.status !== 'active') return false;
    
    const now = Date.now();
    
    if (state.nextSearchAt && now < state.nextSearchAt) {
      return false;
    }
    
    if (currentQueueSize >= this.parent.CONFIG.MAX_QUEUE_SIZE) {
      await this.updateSearchInterval(rideId, 'queue_full');
      return false;
    }
    
    if (currentQueueSize >= this.parent.CONFIG.IDEAL_QUEUE_SIZE) {
      await this.updateSearchInterval(rideId, 'good_queue');
      return false;
    }
    
    if (currentQueueSize < this.parent.CONFIG.MIN_QUEUE_SIZE) {
      await this.updateSearchInterval(rideId, 'small_queue');
      return true;
    }
    
    return true;
  }

  async updateSearchInterval(rideId, reason) {
    const state = await this.getSearchState(rideId);
    if (!state) return;
    
    const now = Date.now();
    let newInterval = state.searchInterval;
    let newRadius = state.searchRadius;
    
    switch (reason) {
      case 'small_queue':
        newInterval = this.parent.CONFIG.SEARCH_INTERVAL_NO_DRIVERS;
        newRadius = Math.min(
          state.searchRadius * this.parent.CONFIG.RADIUS_EXPANSION_FACTOR,
          this.parent.CONFIG.MAX_SEARCH_RADIUS
        );
        break;
      case 'good_queue':
        newInterval = this.parent.CONFIG.SEARCH_INTERVAL_EXTENDED;
        break;
      case 'queue_full':
        newInterval = 60;
        break;
      case 'no_drivers_found':
        newInterval = this.parent.CONFIG.SEARCH_INTERVAL_NO_DRIVERS;
        newRadius = Math.min(
          state.searchRadius * this.parent.CONFIG.RADIUS_EXPANSION_FACTOR,
          this.parent.CONFIG.MAX_SEARCH_RADIUS
        );
        break;
      case 'drivers_found':
        newInterval = this.parent.CONFIG.SEARCH_INTERVAL_EXTENDED;
        break;
    }
    
    await this.updateSearchState(rideId, {
      searchInterval: newInterval,
      searchRadius: newRadius,
      nextSearchAt: now + (newInterval * 1000),
      lastSearchAt: now
    });
    
    console.log(`⏱️  ${rideId}: Intervalle ${newInterval}s (${reason}), rayon: ${newRadius}km`);
  }

  async updateAfterSearch(rideId, driversFound, currentQueueSize) {
    const state = await this.getSearchState(rideId);
    if (!state) return;
    
    const updates = {
      searchCount: (state.searchCount || 0) + 1,
      driversFound: (state.driversFound || 0) + driversFound,
      driversInQueue: currentQueueSize,
      lastDriverFoundAt: driversFound > 0 ? Date.now() : state.lastDriverFoundAt
    };
    
    let reason = 'drivers_found';
    if (driversFound === 0) {
      reason = 'no_drivers_found';
    } else if (currentQueueSize >= this.parent.CONFIG.MAX_QUEUE_SIZE) {
      reason = 'queue_full';
    } else if (currentQueueSize >= this.parent.CONFIG.IDEAL_QUEUE_SIZE) {
      reason = 'good_queue';
    } else if (currentQueueSize < this.parent.CONFIG.MIN_QUEUE_SIZE) {
      reason = 'small_queue';
    }
    
    await this.updateSearchInterval(rideId, reason);
    await this.updateSearchState(rideId, updates);
    
    return await this.getSearchState(rideId);
  }

  async stopSearch(rideId) {
    await this.updateSearchState(rideId, { status: 'stopped' });
    await redis.zrem(this.parent.REDIS_KEYS.ACTIVE_SEARCHES, rideId);
  }

  async cleanupOrphanedSearchStates() {
    try {
      console.log('🧹 Nettoyage états recherche orphelins...');
      const activeRideIds = await redis.zrange(this.parent.REDIS_KEYS.ACTIVE_SEARCHES, 0, -1);
      
      for (const rideId of activeRideIds) {
        const state = await this.getSearchState(rideId);
        if (!state) {
          await redis.zrem(this.parent.REDIS_KEYS.ACTIVE_SEARCHES, rideId);
          continue;
        }
        
        const matchingKey = this.parent.REDIS_KEYS.MATCHING_STATE + rideId;
        const matchingExists = await redis.exists(matchingKey);
        
        if (!matchingExists) {
          console.log(`🧹 ${rideId}: Matching inexistant, nettoyage recherche`);
          await this.stopSearch(rideId);
          await redis.del(this.parent.REDIS_KEYS.SEARCH_STATE + rideId);
        }
      }
    } catch (error) {
      console.error('❌ Erreur nettoyage états recherche:', error);
    }
  }
}

// ==================== SEQUENTIAL NOTIFICATION MANAGER (REDIS) ====================

class SequentialNotificationManager {
  constructor(parentService) {
    this.parent = parentService;
    this.instanceId = parentService.intervalManager.instanceId;
    this.activeTimeouts = new Map(); // Timeouts locaux seulement
  }

  async startSequentialNotifications(rideId, drivers) {
    const queueKey = this.parent.REDIS_KEYS.NOTIFICATION_QUEUE + rideId;
    
    const queue = {
      rideId,
      instanceId: this.instanceId,
      drivers: drivers.map(d => ({
        driverId: d.driverId,
        priority: d.priority,
        score: d.score,
        distance: d.distance,
        addedAt: Date.now()
      })),
      notified: [],
      pendingResponse: null,
      status: 'active',
      startedAt: Date.now(),
      lastUpdated: Date.now()
    };
    
    await redis.set(queueKey, queue, this.parent.CONFIG.MATCHING_DURATION + 300);
    await redis.zadd(this.parent.REDIS_KEYS.ACTIVE_NOTIFICATIONS, Date.now(), rideId);
    
    console.log(`📋 ${rideId}: File notifications démarrée (${drivers.length} chauffeurs)`);
    await this.processNextDriver(rideId);
    
    return queue;
  }

  async getQueue(rideId) {
    const queueKey = this.parent.REDIS_KEYS.NOTIFICATION_QUEUE + rideId;
    return await redis.get(queueKey);
  }

  async updateQueue(rideId, updates) {
    const queueKey = this.parent.REDIS_KEYS.NOTIFICATION_QUEUE + rideId;
    const currentQueue = await this.getQueue(rideId) || {};
    
    const newQueue = {
      ...currentQueue,
      ...updates,
      instanceId: this.instanceId,
      lastUpdated: Date.now()
    };
    
    await redis.set(queueKey, newQueue, this.parent.CONFIG.MATCHING_DURATION + 300);
    return newQueue;
  }

  async getNotificationStatus(rideId) {
    const queue = await this.getQueue(rideId);
    if (!queue) return null;
    
    if (queue.instanceId !== this.instanceId) {
      const heartbeatKey = `instance:heartbeat:${queue.instanceId}`;
      const heartbeat = await redis.get(heartbeatKey);
      
      if (!heartbeat || (Date.now() - parseInt(heartbeat)) > 300000) {
        console.log(`🔄 ${rideId}: Reprise notifications depuis instance ${queue.instanceId}`);
        queue.instanceId = this.instanceId;
        await this.updateQueue(rideId, queue);
      }
    }
    
    return {
      rideId,
      status: queue.status,
      totalDrivers: queue.drivers?.length || 0,
      notifiedCount: queue.notified?.length || 0,
      pendingResponse: queue.pendingResponse,
      currentIndex: queue.notified?.length || 0,
      elapsed: Date.now() - queue.startedAt
    };
  }

  async processNextDriver(rideId) {
    const queue = await this.getQueue(rideId);
    if (!queue || queue.status !== 'active') return;
    
    if (queue.pendingResponse) {
      const timeLeft = Math.max(0, queue.pendingResponse.expiresAt - Date.now());
      if (timeLeft < 5000) {
        console.log(`⏳ ${rideId}: ${queue.pendingResponse.driverId} répond bientôt`);
      }
      return;
    }
    
    const nextDriver = this.findNextDriverToNotify(queue);
    if (!nextDriver) {
      console.log(`📭 ${rideId}: Plus de chauffeurs à notifier`);
      return;
    }
    
    await this.notifySingleDriver(rideId, nextDriver, queue);
  }

  findNextDriverToNotify(queue) {
    const notifiedIds = new Set(queue.notified?.map(n => n.driverId) || []);
    
    for (const driver of queue.drivers || []) {
      if (!notifiedIds.has(driver.driverId)) {
        return driver;
      }
    }
    
    return null;
  }
  
  /**
   * Notifier un seul chauffeur avec notifications client
   */
  async notifySingleDriver(rideId, driver, queue) {
    console.log(`👉 ${rideId}: Notification à ${driver.driverId}`);
    
    // 1. Informer le client que la notification commence
    const rideRequest = await this.parent.getRideRequestFromState(rideId);
    /*if (rideRequest) {
      await this.parent.notifyCustomerDriverNotificationStarted(
        rideRequest.customerId,
        rideId,
        driver.driverId
      );
    }*/
    
    // 2. Marquer comme en attente
    const updatedQueue = await this.updateQueue(rideId, {
      pendingResponse: {
        driverId: driver.driverId,
        notifiedAt: Date.now(),
        expiresAt: Date.now() + (this.parent.CONFIG.DRIVER_RESPONSE_TIMEOUT * 1000)
      },
      notified: [
        ...(queue.notified || []),
        {
          driverId: driver.driverId,
          notifiedAt: Date.now(),
          status: 'pending'
        }
      ]
    });
    
    // 3. Notifier le chauffeur via le service parent
    if (rideRequest) {
      const notificationSuccess = await this.parent.notifySingleDriver(driver.driverId, rideRequest);
      
      if (!notificationSuccess) {
        // Si échec de notification, passer au chauffeur suivant
        await this.handleNotificationFailure(rideId, driver.driverId);
        return;
      }
    }
    
    // 4. Démarrer le timeout
    await this.startDriverResponseTimeout(rideId, driver.driverId);
  }

  
  /**
   * Démarrer le timeout avec notification client
   */
  async startDriverResponseTimeout(rideId, driverId) {
    const timeoutKey = this.parent.REDIS_KEYS.DRIVER_TIMEOUT + rideId + ':' + driverId;
    const expiresAt = Date.now() + (this.parent.CONFIG.DRIVER_RESPONSE_TIMEOUT * 1000);
    
    await redis.set(timeoutKey, {
      rideId,
      driverId,
      expiresAt,
      createdAt: Date.now(),
      instanceId: this.instanceId
    }, this.parent.CONFIG.DRIVER_RESPONSE_TIMEOUT + 5);
    
    const timeout = setTimeout(async () => {
      console.log(`⏰ ${rideId}: Timeout chauffeur ${driverId}`);
      
      // 1. Gérer le timeout (notifier le client)
      await this.parent.handleDriverTimeout(driverId, rideId);
      
      // 2. Libérer la réservation
      await this.parent.driverReservation.release(driverId);
      
      // 3. Mettre à jour la file
      const queue = await this.getQueue(rideId);
      if (queue && queue.pendingResponse?.driverId === driverId) {
        await this.updateQueue(rideId, {
          pendingResponse: null,
          notified: queue.notified.map(n => 
            n.driverId === driverId 
              ? { ...n, status: 'timeout', respondedAt: Date.now() }
              : n
          )
        });
        
        // 4. Passer au suivant après délai
        setTimeout(async () => {
          await this.processNextDriver(rideId);
        }, this.parent.CONFIG.NOTIFICATION_COOLDOWN);
      }
      
      // 5. Nettoyer
      this.activeTimeouts.delete(timeoutKey);
      await redis.del(timeoutKey);
      
    }, this.parent.CONFIG.DRIVER_RESPONSE_TIMEOUT * 1000);
    
    this.activeTimeouts.set(timeoutKey, timeout);
  }

  /**
   * Gérer la réponse d'un chauffeur avec notifications client
   */
  async handleDriverResponse(rideId, driverId, response) {
    console.log(`📨 ${rideId}: Réponse chauffeur ${driverId}: ${response}`);
    
    // 1. Nettoyer le timeout
    const timeoutKey = this.parent.REDIS_KEYS.DRIVER_TIMEOUT + rideId + ':' + driverId;
    const localTimeout = this.activeTimeouts.get(timeoutKey);
    if (localTimeout) {
      clearTimeout(localTimeout);
      this.activeTimeouts.delete(timeoutKey);
    }
    await redis.del(timeoutKey);
    
    // 2. Mettre à jour la file
    const queue = await this.getQueue(rideId);
    if (!queue) return { action: 'stop' };
    
    let updatedQueue = { ...queue };
    
    if (queue.pendingResponse?.driverId === driverId) {
      updatedQueue.pendingResponse = null;
    }
    
    updatedQueue.notified = (queue.notified || []).map(n => 
      n.driverId === driverId 
        ? { ...n, status: response, respondedAt: Date.now() }
        : n
    );
    
    await this.updateQueue(rideId, updatedQueue);
    
    // 3. Gérer selon la réponse
    if (response === 'accepted') {
      // Acceptation - le service parent notifie le client
      //await this.parent.handleDriverAcceptance(driverId, rideId);
      return { action: 'stop', driverId };
    } else {
      // Refus - le service parent notifie le client
      await this.parent.handleDriverRejection(driverId, rideId, response);
      
      // Passer au suivant
      setTimeout(async () => {
        await this.processNextDriver(rideId);
      }, this.parent.CONFIG.NOTIFICATION_COOLDOWN);
      
      return { action: 'continue', driverId };
    }
  }

  /**
   * Gérer l'échec de notification
   */
  async handleNotificationFailure(rideId, driverId) {
    console.log(`❌ ${rideId}: Échec notification ${driverId}`);
    
    // 1. Libérer la réservation
    await this.parent.driverReservation.release(driverId);
    
    // 2. Mettre à jour la file
    const queue = await this.getQueue(rideId);
    if (queue) {
      await this.updateQueue(rideId, {
        pendingResponse: null,
        notified: queue.notified.map(n => 
          n.driverId === driverId 
            ? { ...n, status: 'notification_failed', respondedAt: Date.now() }
            : n
        )
      });
      
      // 3. Informer le client via le service parent
      const rideRequest = await this.parent.getRideRequestFromState(rideId);
      /*if (rideRequest) {
        await this.parent.notifyCustomerDriverNotificationFailed(
          rideRequest.customerId,
          rideId,
          driverId,
          'notification_failed'
        );
      }*/
      
      // 4. Passer au suivant
      setTimeout(async () => {
        await this.processNextDriver(rideId);
      }, this.parent.CONFIG.NOTIFICATION_COOLDOWN);
    }
  }

  async stopSequentialNotifications(rideId) {
    await this.updateQueue(rideId, { status: 'stopped' });
    await this.clearAllTimeoutsForRide(rideId);
    await redis.zrem(this.parent.REDIS_KEYS.ACTIVE_NOTIFICATIONS, rideId);
    console.log(`🛑 ${rideId}: Notifications arrêtées`);
  }

  async clearAllTimeoutsForRide(rideId) {
    for (const [key, timeout] of this.activeTimeouts.entries()) {
      if (key.includes(`:${rideId}:`)) {
        clearTimeout(timeout);
        this.activeTimeouts.delete(key);
      }
    }
    
    const pattern = this.parent.REDIS_KEYS.DRIVER_TIMEOUT + rideId + ':*';
    const keys = await redis.keys(pattern);
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  }

  async addDriversToQueue(rideId, newDrivers) {
    const queue = await this.getQueue(rideId);
    if (!queue || queue.status !== 'active') return 0;
    
    const existingIds = new Set([
      ...(queue.drivers || []).map(d => d.driverId),
      ...(queue.notified || []).map(n => n.driverId)
    ]);
    
    const uniqueDrivers = newDrivers.filter(d => !existingIds.has(d.driverId));
    
    if (uniqueDrivers.length === 0) return 0;
    
    const updatedDrivers = [
      ...(queue.drivers || []),
      ...uniqueDrivers.map(d => ({
        driverId: d.driverId,
        priority: d.priority,
        score: d.score,
        distance: d.distance,
        addedAt: Date.now()
      }))
    ];
    
    await this.updateQueue(rideId, { drivers: updatedDrivers });
    
    console.log(`➕ ${rideId}: ${uniqueDrivers.length} chauffeurs ajoutés`);
    
    if (!queue.pendingResponse) {
      await this.processNextDriver(rideId);
    }
    
    return uniqueDrivers.length;
  }

  async recoverOrphanedQueues() {
    try {
      console.log('🔍 Récupération files notifications orphelines...');
      const activeRideIds = await redis.zrange(this.parent.REDIS_KEYS.ACTIVE_NOTIFICATIONS, 0, -1);
      
      for (const rideId of activeRideIds) {
        const queue = await this.getQueue(rideId);
        
        if (!queue) {
          await redis.zrem(this.parent.REDIS_KEYS.ACTIVE_NOTIFICATIONS, rideId);
          continue;
        }
        
        if (queue.instanceId !== this.instanceId) {
          const heartbeatKey = `instance:heartbeat:${queue.instanceId}`;
          const heartbeat = await redis.get(heartbeatKey);
          
          if (!heartbeat || (Date.now() - parseInt(heartbeat)) > 300000) {
            console.log(`🔄 ${rideId}: Reprise file depuis instance ${queue.instanceId}`);
            queue.instanceId = this.instanceId;
            await this.updateQueue(rideId, queue);
            await this.recoverPendingTimeoutsForQueue(rideId, queue);
          }
        }
      }
    } catch (error) {
      console.error('❌ Erreur récupération files:', error);
    }
  }

  async recoverPendingTimeoutsForQueue(rideId, queue) {
    if (!queue.pendingResponse) return;
    
    const { driverId, expiresAt } = queue.pendingResponse;
    const remainingTime = expiresAt - Date.now();
    
    if (remainingTime > 0) {
      console.log(`⏰ ${rideId}: Récupération timeout ${driverId} (${remainingTime}ms)`);
      await this.startDriverResponseTimeout(rideId, driverId);
    } else {
      console.log(`🧹 ${rideId}: Nettoyage timeout expiré ${driverId}`);
      await this.updateQueue(rideId, { pendingResponse: null });
    }
  }
}

// ==================== CONTINUOUS MATCHING ====================

class ContinuousMatching {
  constructor(parentService) {
    this.parent = parentService;
    this.searchManager = parentService.searchManager;
  }

  async start(rideId, rideRequest) {
    const matchingState = await this.parent.getMatchingState(rideId);
    if (!matchingState) return;

    console.log(`🔄 Matching continu démarré pour ${rideId}`);

    await this.searchManager.initializeSearchState(rideId);
    await this.performSearch(rideId, rideRequest);

    const intervalKey = `continuous:matching:${rideId}`;
    
    await this.parent.intervalManager.createInterval(
      intervalKey,
      async (data) => {
        await this.executeIntelligentSearch(data.rideId, data.rideRequest);
      },
      10000,
      { rideId, rideRequest }
    );

    console.log(`✅ Matching continu démarré (recherches intelligentes)`);
    await this.startMatchingTimeout(rideId);
  }

  async executeIntelligentSearch(rideId, rideRequest) {
    try {
      const notificationStatus = await this.parent.notificationManager.getNotificationStatus(rideId);
      const currentQueueSize = notificationStatus ? 
        (notificationStatus.totalDrivers - notificationStatus.notifiedCount) : 0;

      const shouldSearch = await this.searchManager.shouldSearchNow(rideId, currentQueueSize);
      
      if (!shouldSearch) {
        const searchState = await this.searchManager.getSearchState(rideId);
        if (searchState) {
          const nextIn = Math.max(0, Math.floor((searchState.nextSearchAt - Date.now()) / 1000));
          if (nextIn > 0 && nextIn % 30 === 0) {
            console.log(`⏳ ${rideId}: Prochaine recherche dans ${nextIn}s (file: ${currentQueueSize})`);
          }
        }
        return;
      }

      console.log(`🔍 ${rideId}: Recherche déclenchée (file: ${currentQueueSize})`);
      await this.performSearch(rideId, rideRequest);

    } catch (error) {
      console.error(`❌ Erreur recherche intelligente ${rideId}:`, error);
    }
  }

  async performSearch(rideId, rideRequest) {
    try {
      const matchingState = await this.parent.getMatchingState(rideId);
      if (!matchingState || matchingState.status !== 'searching') {
        await this.cleanupMatching(rideId);
        return;
      }

      if (matchingState.expiresAt && Date.now() > matchingState.expiresAt) {
        await this.handleMatchingTimeout(rideId);
        return;
      }

      const searchState = await this.searchManager.getSearchState(rideId);
      const searchRadius = searchState ? searchState.searchRadius : this.parent.CONFIG.SEARCH_RADIUS_KM;

      console.log(`🔍 ${rideId}: Recherche avec rayon ${searchRadius}km`);

      const rideRequestWithRadius = {
        ...rideRequest,
        constraints: {
          ...rideRequest.constraints,
          searchRadius: searchRadius
        }
      };

      const availableDrivers = await this.parent.findAvailableDrivers(rideRequestWithRadius);
      
      matchingState.stats.searches++;
      matchingState.stats.driversFound += availableDrivers.length;
      matchingState.lastSearchAt = Date.now();
      
      await this.parent.saveMatchingState(rideId, matchingState);

      if (availableDrivers.length === 0) {
        console.log(`❌ ${rideId}: Aucun chauffeur trouvé dans ${searchRadius}km`);
        
        const notificationStatus = await this.parent.notificationManager.getNotificationStatus(rideId);
        const currentQueueSize = notificationStatus ? 
          (notificationStatus.totalDrivers - notificationStatus.notifiedCount) : 0;
        
        await this.searchManager.updateAfterSearch(rideId, 0, currentQueueSize);
        return;
      }

      console.log(`✅ ${rideId}: ${availableDrivers.length} chauffeurs trouvés`);

      const notificationStatus = await this.parent.notificationManager.getNotificationStatus(rideId);
      const currentQueueSize = notificationStatus ? 
        (notificationStatus.totalDrivers - notificationStatus.notifiedCount) : 0;

      await this.addDriversToNotificationQueue(rideId, availableDrivers, currentQueueSize);

      const newQueueSize = currentQueueSize + availableDrivers.length;
      await this.searchManager.updateAfterSearch(rideId, availableDrivers.length, newQueueSize);

      this.logSearchMetrics(rideId, availableDrivers.length, newQueueSize);

    } catch (error) {
      console.error(`❌ ${rideId}: Erreur recherche:`, error);
      await this.parent.matchingMonitor.logError(rideId, 'performSearch', error);
    }
  }

  async addDriversToNotificationQueue(rideId, newDrivers, currentQueueSize) {
    const notificationStatus = await this.parent.notificationManager.getNotificationStatus(rideId);
    
    if (!notificationStatus || notificationStatus.status !== 'active') {
      console.log(`🚀 ${rideId}: Démarrage nouvelle file (${newDrivers.length} chauffeurs)`);
      await this.parent.notificationManager.startSequentialNotifications(rideId, newDrivers);
    } else {
      console.log(`➕ ${rideId}: Ajout de ${newDrivers.length} chauffeurs à la file existante`);
      await this.parent.notificationManager.addDriversToQueue(rideId, newDrivers);
    }
  }

  logSearchMetrics(rideId, driversFound, queueSize) {
    console.log(`📊 ${rideId}: Trouvés: ${driversFound}, File: ${queueSize}`);
    
    this.parent.matchingMonitor.logMetrics(rideId, {
      driversFound,
      queueSize,
      timestamp: Date.now()
    });
  }

  async startMatchingTimeout(rideId) {
    const timeoutKey = this.parent.REDIS_KEYS.GLOBAL_TIMEOUT + rideId;
    
    await redis.set(timeoutKey, {
      rideId,
      scheduledAt: Date.now(),
      expiresAt: Date.now() + (this.parent.CONFIG.MATCHING_DURATION * 1000)
    }, this.parent.CONFIG.MATCHING_DURATION + 10);
    
    const timeoutCheckInterval = await this.parent.intervalManager.createInterval(
      `matching:timeout:check:${rideId}`,
      async () => {
        await this.checkAndHandleTimeout(rideId);
      },
      10000,
      { rideId }
    );
    
    console.log(`⏰ Timeout global programmé pour ${rideId}`);
  }

  async checkAndHandleTimeout(rideId) {
    try {
      const matchingState = await this.parent.getMatchingState(rideId);
      
      if (!matchingState) {
        await this.cleanupMatching(rideId);
        return;
      }
      
      if (matchingState.expiresAt && Date.now() > matchingState.expiresAt) {
        console.log(`⏰ Timeout matching pour ${rideId}`);
        await this.handleMatchingTimeout(rideId);
        await this.cleanupMatching(rideId);
      }
      
    } catch (error) {
      console.error(`❌ Erreur vérification timeout ${rideId}:`, error);
    }
  }

  async handleMatchingTimeout(rideId) {
    const matchingState = await this.parent.getMatchingState(rideId);
    if (!matchingState) return;
    
    console.log(`⏰ Timeout matching pour ${rideId}`);
    
    matchingState.status = 'timeout';
    matchingState.endedAt = Date.now();
    
    await this.parent.saveMatchingState(rideId, matchingState);
    
    await this.parent.socketService.notifyCustomerNoDrivers(
      matchingState.customerId,
      rideId,
      {
        totalDriversNotified: matchingState.notifiedDrivers?.length || 0,
        totalDriversAvailable: matchingState.availableDrivers?.length || 0,
        matchingDuration: this.parent.CONFIG.MATCHING_DURATION
      }
    );
    await this.parent.socketService.notifyMatchingTimeout(
      matchingState.customerId,
      rideId,
      {
        //statistics: {
          totalDriversNotified: matchingState.notifiedDrivers?.length || 0,
          totalDriversAvailable: matchingState.availableDrivers?.length || 0,
          matchingDuration: this.parent.CONFIG.MATCHING_DURATION,
        //},
        message: "Aucun chauffeur disponible pour effectuer cette course",
        alternatives: []
      }
    );
    
    await this.stop(rideId);
  }

  async stop(rideId) {
    await this.searchManager.stopSearch(rideId);
    await this.parent.intervalManager.clearIntervalsByKey(`continuous:matching:${rideId}`);
    await this.parent.intervalManager.clearIntervalsByKey(`matching:timeout:check:${rideId}`);
    await redis.del(this.parent.REDIS_KEYS.GLOBAL_TIMEOUT + rideId);
    console.log(`🛑 Matching continu arrêté pour ${rideId}`);
  }

  async cleanupMatching(rideId) {
    await this.stop(rideId);
    await this.parent.intervalManager.clearIntervalsByKey(`matching:${rideId}`);
    console.log(`🧹 Matching complètement nettoyé pour ${rideId}`);
  }

  async cleanupOrphanedMatching() {
    try {
      console.log('🔍 Vérification matchings orphelins...');
      const activeSearches = await redis.zrange(this.parent.REDIS_KEYS.ACTIVE_SEARCHES, 0, -1);
      
      for (const rideId of activeSearches) {
        const matchingState = await this.parent.getMatchingState(rideId);
        
        if (!matchingState || matchingState.status !== 'searching') {
          console.log(`🧹 Nettoyage matching orphelin: ${rideId}`);
          await this.cleanupMatching(rideId);
        }
      }
      
      console.log(`✅ Nettoyage matchings orphelins terminé`);
    } catch (error) {
      console.error('❌ Erreur nettoyage matchings orphelins:', error);
    }
  }
}

module.exports = RideMatchingService;