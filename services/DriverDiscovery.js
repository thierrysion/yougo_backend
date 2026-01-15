// services/DriverDiscovery.js
const redis = require('../config/redis');
const { Driver, User, Ride } = require('../models');

class DriverDiscovery {
  constructor(config) {
    this.config = config || {
      DRIVER_LOCATION_TTL: 300, // 5 minutes
      DRIVER_DATA_TTL: 7200, // 2 heures
      FINISHING_RIDE_THRESHOLD: 0.75, // 75% de progression
      MAX_FINISHING_TIME: 5 * 60 * 1000, // 5 minutes
      CACHE_TTL: 30 // 30 secondes pour le cache des recherches
    };
  }

  // ==================== ENREGISTREMENT DES CHAUFFEURS ====================

  /**
   * Enregistrer ou mettre à jour un chauffeur dans Redis
   */
  async registerDriver(driverId, driverData) {
    try {
      console.log(`🚗 Enregistrement chauffeur: ${driverId}`);
      
      const driverKey = `driver:${driverId}`;
      const geoKey = 'drivers:geo:locations';
      
      // Données complètes du chauffeur
      const fullDriverData = {
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
        currentLocation: driverData.currentLocation || null,
        lastLocationUpdate: driverData.currentLocation ? Date.now() : null,
        lastActiveAt: Date.now(),
        connectedAt: Date.now(),
        registeredAt: Date.now(),
        lastUpdated: Date.now()
      };

      // 1. Sauvegarder les données complètes
      await redis.setex(
        driverKey,
        this.config.DRIVER_DATA_TTL,
        fullDriverData
      );

      // 2. Mettre à jour les métadonnées
      await redis.hset('drivers:metadata', driverId, JSON.stringify({
        lastSeen: Date.now(),
        status: fullDriverData.driverStatus,
        vehicleType: fullDriverData.vehicleType,
        isOnline: true
      }));

      // 3. Si position disponible, mettre à jour GEO
      if (driverData.currentLocation) {
        await this.updateDriverLocation(driverId, driverData.currentLocation);
      }

      // 4. Mettre à jour l'index par statut
      await this.updateDriverStatusIndex(driverId, fullDriverData.driverStatus);

      // 5. Ajouter à la liste des chauffeurs en ligne
      await redis.sadd('drivers:online', driverId);
      await redis.expire('drivers:online', this.config.DRIVER_DATA_TTL);

      console.log(`✅ Chauffeur ${driverId} enregistré (${fullDriverData.driverStatus})`);
      return fullDriverData;

    } catch (error) {
      console.error('❌ Erreur enregistrement chauffeur:', error);
      throw error;
    }
  }

  /**
   * Mettre à jour la position d'un chauffeur
   */
  async updateDriverLocation(driverId, location) {
    try {
      const geoKey = 'drivers:geo:locations';
      const driverKey = `driver:${driverId}`;

      // Récupérer les données existantes
      let driverData = await redis.get(driverKey) || {};
      
      // Mettre à jour les données
      driverData.currentLocation = location;
      driverData.lastLocationUpdate = Date.now();
      driverData.lastActiveAt = Date.now();
      driverData.lastUpdated = Date.now();

      // Sauvegarder
      await redis.setex(
        driverKey,
        this.config.DRIVER_DATA_TTL,
        driverData
      );

      // Mettre à jour l'index GEO
      await redis.geoadd(
        geoKey,
        location.longitude,
        location.latitude,
        driverId
      );

      // Mettre à jour l'expiration
      await redis.expire(geoKey, this.config.DRIVER_LOCATION_TTL);

      console.log(`📍 Position ${driverId} mise à jour`);
      return true;

    } catch (error) {
      console.error('❌ Erreur mise à jour position:', error);
      return false;
    }
  }

  /**
   * Mettre à jour le statut d'un chauffeur
   */
  async updateDriverStatus(driverId, status, additionalData = {}) {
    try {
      const driverKey = `driver:${driverId}`;
      const driverData = await redis.get(driverKey);

      if (driverData) {
        // Mettre à jour le statut
        driverData.driverStatus = status;
        driverData.lastActiveAt = Date.now();
        driverData.lastStatusUpdate = Date.now();
        driverData.lastUpdated = Date.now();

        // Ajouter les données supplémentaires
        Object.assign(driverData, additionalData);

        // Sauvegarder
        await redis.setex(
          driverKey,
          this.config.DRIVER_DATA_TTL,
          driverData
        );

        // Mettre à jour les métadonnées
        await redis.hset('drivers:metadata', driverId, JSON.stringify({
          lastSeen: Date.now(),
          status: status,
          vehicleType: driverData.vehicleType,
          isOnline: driverData.isOnline
        }));

        // Mettre à jour l'index par statut
        await this.updateDriverStatusIndex(driverId, status);

        console.log(`🔄 Statut ${driverId}: ${status}`);
        return driverData;
      }

      return null;

    } catch (error) {
      console.error('❌ Erreur mise à jour statut:', error);
      return null;
    }
  }

  /**
   * Mettre à jour l'index par statut (sorted sets)
   */
  async updateDriverStatusIndex(driverId, status) {
    const now = Date.now();
    
    // Liste des statuts possibles
    const statuses = ['available', 'in_ride', 'offline', 'reconnecting'];
    
    // Retirer des anciens statuts
    for (const oldStatus of statuses) {
      if (oldStatus !== status) {
        await redis.zrem(`drivers:status:${oldStatus}`, driverId);
      }
    }
    
    // Ajouter au nouveau statut
    await redis.zadd(`drivers:status:${status}`, now, driverId);
    await redis.expire(`drivers:status:${status}`, this.config.DRIVER_DATA_TTL);
    
    // Mettre à jour le statut global
    await redis.hset('driver:status:global', driverId, status);
  }

  /**
   * Marquer un chauffeur comme hors ligne
   */
  async markDriverOffline(driverId) {
    try {
      console.log(`🚫 Marquage chauffeur hors ligne: ${driverId}`);
      
      // 1. Mettre à jour le statut
      await this.updateDriverStatus(driverId, 'offline', { isOnline: false });
      
      // 2. Retirer de l'index GEO
      await this.removeDriverFromGeo(driverId);
      
      // 3. Retirer de la liste des en ligne
      await redis.srem('drivers:online', driverId);
      
      // 4. Mettre à jour les métadonnées
      await redis.hset('drivers:metadata', driverId, JSON.stringify({
        lastSeen: Date.now(),
        status: 'offline',
        isOnline: false
      }));
      
      console.log(`✅ Chauffeur ${driverId} marqué comme hors ligne`);
      return true;
      
    } catch (error) {
      console.error('❌ Erreur marquage chauffeur hors ligne:', error);
      return false;
    }
  }

  /**
   * Retirer un chauffeur de l'index GEO
   */
  async removeDriverFromGeo(driverId) {
    try {
      const geoKey = 'drivers:geo:locations';
      await redis.zrem(geoKey, driverId);
      
      console.log(`🗺️ Chauffeur ${driverId} retiré de l'index GEO`);
      return true;
      
    } catch (error) {
      console.error('❌ Erreur retrait index GEO:', error);
      return false;
    }
  }

  // ==================== RECHERCHE DE CHAUFFEURS ====================

  /**
   * Rechercher les chauffeurs libres
   */
  async findFreeDrivers(pickupLocation, rideTypeId, radiusKm) {
    const geoKey = 'drivers:geo:locations';
    
    try {
      console.log(`🔍 Recherche chauffeurs libres dans ${radiusKm}km`);
      
      const radiusMeters = radiusKm * 1000;
      
      // Recherche GEO dans Redis
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
        const [driverId, distance] = result;
        
        // Récupérer les données du chauffeur
        const driverData = await this.getDriverData(driverId);
        
        if (driverData && this.isDriverEligible(driverData, rideTypeId, 'available')) {
          drivers.push({
            driverId,
            ...driverData,
            distance: parseFloat(distance) / 1000, // Convertir en km
            priority: 1, // Chauffeurs libres ont priorité 1
            status: 'available',
            source: 'connected'
          });
        }
      }
      
      console.log(`✅ ${drivers.length} chauffeurs libres trouvés`);
      return drivers;
      
    } catch (error) {
      console.error('❌ Erreur recherche chauffeurs libres:', error);
      return [];
    }
  }

  /**
   * Rechercher les chauffeurs en fin de course
   */
  async findFinishingRideDrivers(pickupLocation, rideTypeId, radiusKm) {
    try {
      console.log(`🔍 Recherche chauffeurs en fin de course dans ${radiusKm}km`);
      
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
            if (timeToCompletion <= this.config.MAX_FINISHING_TIME) {
              // 6. Calculer la distance au pickup
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
                    priority: 2 // Priorité inférieure aux chauffeurs libres
                  });
                }
              }
            }
          }
          
        } catch (error) {
          console.error(`❌ Erreur traitement chauffeur ${driverId}:`, error);
          continue;
        }
      }
      
      console.log(`✅ ${finishingDrivers.length} chauffeurs en fin de course trouvés`);
      return finishingDrivers;
      
    } catch (error) {
      console.error('❌ Erreur recherche chauffeurs en fin de course:', error);
      return [];
    }
  }

  /**
   * Fusionner et dédupliquer les listes de chauffeurs
   */
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
   * Trier les chauffeurs par priorité et score
   */
  sortDriversByPriority(drivers) {
    return drivers.sort((a, b) => {
      // 1. Priorité (libres > en fin de course)
      if (a.priority !== b.priority) {
        return a.priority - b.priority;
      }
      
      // 2. Score de matching
      const scoreA = this.calculateMatchingScore(a);
      const scoreB = this.calculateMatchingScore(b);
      
      if (scoreA !== scoreB) {
        return scoreB - scoreA; // Ordre décroissant
      }
      
      // 3. Distance
      return a.distance - b.distance;
    });
  }

  /**
   * Calculer un score de matching pour un chauffeur
   */
  calculateMatchingScore(driver) {
    const weights = {
      distance: 0.35,
      rating: 0.25,
      acceptanceRate: 0.20,
      experience: 0.10,
      statusBonus: 0.10
    };
    
    // Score de distance (meilleur = plus proche)
    const distanceScore = Math.max(0, 100 - (driver.distance * 20));
    
    // Score de rating (1-5 étoiles)
    const ratingScore = ((driver.rating || 4.0) - 1) * 25;
    
    // Score d'acceptation (0-100%)
    const acceptanceScore = Math.min(100, driver.acceptanceRate || 50);
    
    // Score d'expérience (basé sur nombre de courses)
    const experienceBonus = Math.min(20, (driver.totalRides || 0) / 50);
    
    // Bonus de statut (libre vs en fin de course)
    const statusBonus = driver.status === 'available' ? 30 : 10;
    
    // Calcul final
    return Math.round(
      distanceScore * weights.distance +
      ratingScore * weights.rating +
      acceptanceScore * weights.acceptanceRate +
      experienceBonus * weights.experience +
      statusBonus * weights.statusBonus
    );
  }

  // ==================== UTILITAIRES ====================

  /**
   * Obtenir les données d'un chauffeur
   */
  async getDriverData(driverId) {
    const driverKey = `driver:${driverId}`;
    const driverData = await redis.get(driverKey);
    
    if (driverData) {
      return driverData;
    }
    
    // Fallback à la base de données
    return await this.getDriverDetails(driverId);
  }

  /**
   * Obtenir les détails complets d'un chauffeur
   */
  async getDriverDetails(driverId) {
    try {
      const driverKey = `driver:${driverId}`;
      
      // Vérifier le cache Redis d'abord
      const cached = await redis.get(driverKey);
      if (cached) {
        return cached;
      }
      
      // Récupérer depuis la base de données
      const driver = await Driver.findOne({
        where: { user_id: driverId },
        include: [{
          model: User,
          as: 'user',
          attributes: ['first_name', 'last_name', 'profile_picture_url', 'phone_number']
        }]
      });
      
      if (!driver) {
        return null;
      }
      
      const driverData = {
        driverId,
        userId: driverId,
        firstName: driver.user.first_name,
        lastName: driver.user.last_name,
        profilePicture: driver.user.profile_picture_url,
        phoneNumber: driver.user.phone_number,
        vehicleType: driver.ride_type_id,
        vehicleMake: driver.vehicle_make,
        vehicleModel: driver.vehicle_model,
        licensePlate: driver.license_plate,
        rating: parseFloat(driver.driver_rating) || 4.0,
        acceptanceRate: parseFloat(driver.acceptance_rate) || 50,
        totalRides: driver.total_completed_rides || 0,
        driverStatus: driver.driver_status || 'offline',
        isOnline: false,
        lastUpdated: Date.now()
      };
      
      // Mettre en cache
      await redis.setex(driverKey, this.config.DRIVER_DATA_TTL, driverData);
      
      return driverData;
      
    } catch (error) {
      console.error(`❌ Erreur récupération détails chauffeur ${driverId}:`, error);
      return null;
    }
  }

  /**
   * Obtenir la position d'un chauffeur
   */
  async getDriverLocation(driverId) {
    try {
      const driverKey = `driver:${driverId}`;
      const driverData = await redis.get(driverKey);
      
      if (driverData && driverData.currentLocation) {
        return driverData.currentLocation;
      }
      
      return null;
    } catch (error) {
      console.error(`❌ Erreur récupération position ${driverId}:`, error);
      return null;
    }
  }

  /**
   * Calculer la progression d'une course
   */
  async calculateRideProgress(rideId, driverData) {
    try {
      const rideKey = `ride:active:${rideId}`;
      const rideData = await redis.get(rideKey);
      
      if (!rideData || !rideData.startedAt) {
        return { percentage: 0, estimatedCompletion: null };
      }
      
      const now = Date.now();
      const startedAt = rideData.startedAt;
      const estimatedDuration = rideData.estimatedDuration || 15; // 15 minutes par défaut
      
      const elapsed = now - startedAt;
      const totalDuration = estimatedDuration * 60 * 1000; // minutes → ms
      
      const percentage = Math.min(95, (elapsed / totalDuration) * 100);
      const estimatedCompletion = startedAt + totalDuration;
      
      return {
        percentage: Math.round(percentage),
        estimatedCompletion,
        elapsedMinutes: Math.floor(elapsed / 60000),
        remainingMinutes: Math.floor((totalDuration - elapsed) / 60000)
      };
      
    } catch (error) {
      console.error('❌ Erreur calcul progression:', error);
      return { percentage: 0, estimatedCompletion: null };
    }
  }

  /**
   * Vérifier si un chauffeur est éligible
   */
  isDriverEligible(driverData, rideTypeId, requiredStatus) {
    if (!driverData) return false;
    
    // Vérifier le type de véhicule
    if (rideTypeId && driverData.vehicleType !== rideTypeId) {
      return false;
    }
    
    // Vérifier le statut
    if (requiredStatus && driverData.driverStatus !== requiredStatus) {
      return false;
    }
    
    // Vérifier si en ligne
    if (!driverData.isOnline) {
      return false;
    }
    
    // Vérifier l'inactivité (dernière activité < 5 minutes)
    const lastActive = driverData.lastActiveAt || 0;
    const inactiveThreshold = Date.now() - (5 * 60 * 1000);
    
    return lastActive > inactiveThreshold;
  }

  /**
   * Calculer la distance entre deux points (Haversine formula)
   */
  calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Rayon de la Terre en km
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

  /**
   * Obtenir tous les chauffeurs en ligne
   */
  async getOnlineDrivers() {
    try {
      const onlineDriverIds = await redis.smembers('drivers:online');
      const drivers = [];
      
      for (const driverId of onlineDriverIds) {
        const driverData = await this.getDriverData(driverId);
        if (driverData) {
          drivers.push(driverData);
        }
      }
      
      return drivers;
    } catch (error) {
      console.error('❌ Erreur récupération chauffeurs en ligne:', error);
      return [];
    }
  }

  /**
   * Obtenir les statistiques des chauffeurs
   */
  async getDriverStats() {
    try {
      const totalOnline = await redis.scard('drivers:online') || 0;
      const availableCount = await redis.zcard('drivers:status:available') || 0;
      const inRideCount = await redis.zcard('drivers:status:in_ride') || 0;
      
      return {
        totalOnline,
        available: availableCount,
        inRide: inRideCount,
        timestamp: Date.now()
      };
    } catch (error) {
      console.error('❌ Erreur récupération statistiques:', error);
      return { totalOnline: 0, available: 0, inRide: 0, timestamp: Date.now() };
    }
  }

  /**
   * Nettoyer les données de chauffeurs expirées
   */
  async cleanupExpiredDrivers() {
    try {
      console.log('🧹 Nettoyage chauffeurs expirés...');
      
      // Récupérer tous les chauffeurs
      const driverKeys = await redis.keys('driver:*');
      const now = Date.now();
      let cleaned = 0;
      
      for (const key of driverKeys) {
        const driverData = await redis.get(key);
        
        if (driverData) {
          const lastActive = driverData.lastActiveAt || 0;
          
          // Si inactif depuis plus de 2 heures
          if (now - lastActive > (2 * 60 * 60 * 1000)) {
            const driverId = key.replace('driver:', '');
            
            // Marquer comme hors ligne
            await this.markDriverOffline(driverId);
            
            // Supprimer de GEO
            await this.removeDriverFromGeo(driverId);
            
            cleaned++;
          }
        }
      }
      
      console.log(`✅ ${cleaned} chauffeurs nettoyés`);
      return cleaned;
      
    } catch (error) {
      console.error('❌ Erreur nettoyage chauffeurs:', error);
      return 0;
    }
  }
}

module.exports = DriverDiscovery;