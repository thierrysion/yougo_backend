// services/DriverReservation.js
const redis = require('../config/redis');

class DriverReservation {
  constructor(config) {
    this.config = config || {
      RESERVATION_DURATION: 20, // 20 secondes
      RESERVATION_PREFIX: 'reservation:',
      RIDE_RESERVATIONS_PREFIX: 'ride:reservations:',
      CLEANUP_INTERVAL: 60000 // 1 minute
    };
    
    // Démarrer le nettoyage périodique
    this.startCleanupInterval();
  }

  // ==================== RÉSERVATION ====================

  /**
   * Réserver un chauffeur pour une course
   */
  async reserve(driverId, rideId) {
    try {
      console.log(`🔒 Tentative réservation: ${driverId} pour ${rideId}`);
      
      // Vérifier que le chauffeur n'est pas déjà réservé
      if (await this.isDriverReserved(driverId)) {
        throw new Error(`Chauffeur ${driverId} déjà réservé`);
      }
      
      const reservation = {
        driverId,
        rideId,
        reservedAt: Date.now(),
        reservedUntil: Date.now() + (this.config.RESERVATION_DURATION * 1000),
        status: 'reserved'
      };
      
      const reservationKey = `${this.config.RESERVATION_PREFIX}${driverId}`;
      
      // Stocker la réservation avec TTL
      await redis.setex(
        reservationKey,
        this.config.RESERVATION_DURATION,
        reservation
      );
      
      // Ajouter à la liste des réservations de la course
      const rideReservationKey = `${this.config.RIDE_RESERVATIONS_PREFIX}${rideId}`;
      await redis.sadd(rideReservationKey, driverId);
      await redis.expire(rideReservationKey, this.config.RESERVATION_DURATION);
      
      console.log(`✅ Chauffeur ${driverId} réservé pour ${rideId} (${this.config.RESERVATION_DURATION}s)`);
      return reservation;
      
    } catch (error) {
      console.error(`❌ Erreur réservation ${driverId}:`, error);
      throw error;
    }
  }

  /**
   * Vérifier si un chauffeur est réservé
   */
  async isDriverReserved(driverId) {
    try {
      const reservationKey = `${this.config.RESERVATION_PREFIX}${driverId}`;
      const reservation = await redis.get(reservationKey);
      
      if (!reservation) {
        return false;
      }
      
      // Vérifier l'expiration
      if (reservation.reservedUntil < Date.now()) {
        // Réservation expirée, nettoyer
        await this.release(driverId);
        return false;
      }
      
      return true;
      
    } catch (error) {
      console.error(`❌ Erreur vérification réservation ${driverId}:`, error);
      return false;
    }
  }

  /**
   * Obtenir les détails d'une réservation
   */
  async getReservation(driverId) {
    try {
      const reservationKey = `${this.config.RESERVATION_PREFIX}${driverId}`;
      const reservation = await redis.get(reservationKey);
      
      if (!reservation) {
        return null;
      }
      
      // Vérifier l'expiration
      if (reservation.reservedUntil < Date.now()) {
        await this.release(driverId);
        return null;
      }
      
      return reservation;
      
    } catch (error) {
      console.error(`❌ Erreur récupération réservation ${driverId}:`, error);
      return null;
    }
  }

  /**
   * Libérer un chauffeur réservé
   */
  async release(driverId) {
    try {
      const reservationKey = `${this.config.RESERVATION_PREFIX}${driverId}`;
      const reservation = await redis.get(reservationKey);
      
      if (reservation) {
        const { rideId } = reservation;
        
        // Retirer de la liste des réservations de la course
        const rideReservationKey = `${this.config.RIDE_RESERVATIONS_PREFIX}${rideId}`;
        await redis.srem(rideReservationKey, driverId);
        
        // Supprimer la réservation
        await redis.del(reservationKey);
        
        console.log(`🔓 Chauffeur ${driverId} libéré`);
        return true;
      }
      
      return false;
      
    } catch (error) {
      console.error(`❌ Erreur libération ${driverId}:`, error);
      return false;
    }
  }

  /**
   * Libérer tous les chauffeurs d'une course
   */
  async releaseAllForRide(rideId) {
    try {
      console.log(`🔓 Libération tous chauffeurs pour ${rideId}`);
      
      const rideReservationKey = `${this.config.RIDE_RESERVATIONS_PREFIX}${rideId}`;
      const driverIds = await redis.smembers(rideReservationKey);
      
      let released = 0;
      
      for (const driverId of driverIds) {
        await this.release(driverId);
        released++;
      }
      
      // Supprimer la liste des réservations
      await redis.del(rideReservationKey);
      
      console.log(`✅ ${released} chauffeurs libérés pour ${rideId}`);
      return released;
      
    } catch (error) {
      console.error(`❌ Erreur libération tous chauffeurs ${rideId}:`, error);
      return 0;
    }
  }

  // ==================== RÉSERVATION ATOMIQUE ====================

  /**
   * Réservation atomique (pour éviter les conflits)
   */
  async reserveAtomic(driverId, rideId) {
    try {
      const lockKey = `lock:reservation:${driverId}`;
      const reservationKey = `${this.config.RESERVATION_PREFIX}${driverId}`;
      
      // Essayer d'acquérir un lock
      const lockAcquired = await redis.setnx(lockKey, Date.now());
      
      if (!lockAcquired) {
        // Vérifier si le lock est expiré
        const lockTimestamp = await redis.get(lockKey);
        if (lockTimestamp && (Date.now() - parseInt(lockTimestamp)) > 5000) {
          // Lock expiré, le supprimer
          await redis.del(lockKey);
          return await this.reserveAtomic(driverId, rideId); // Réessayer
        }
        throw new Error(`Chauffeur ${driverId} en cours de réservation`);
      }
      
      // Définir une expiration pour le lock
      await redis.expire(lockKey, 5);
      
      try {
        // Vérifier la disponibilité
        if (await this.isDriverReserved(driverId)) {
          throw new Error(`Chauffeur ${driverId} déjà réservé`);
        }
        
        // Créer la réservation
        const reservation = {
          driverId,
          rideId,
          reservedAt: Date.now(),
          reservedUntil: Date.now() + (this.config.RESERVATION_DURATION * 1000),
          status: 'reserved'
        };
        
        await redis.setex(
          reservationKey,
          this.config.RESERVATION_DURATION,
          reservation
        );
        
        // Ajouter à la liste de la course
        const rideReservationKey = `${this.config.RIDE_RESERVATIONS_PREFIX}${rideId}`;
        await redis.sadd(rideReservationKey, driverId);
        await redis.expire(rideReservationKey, this.config.RESERVATION_DURATION);
        
        console.log(`✅ Réservation atomique réussie: ${driverId} pour ${rideId}`);
        return reservation;
        
      } finally {
        // Toujours libérer le lock
        await redis.del(lockKey);
      }
      
    } catch (error) {
      console.error(`❌ Erreur réservation atomique ${driverId}:`, error);
      throw error;
    }
  }

  // ==================== GESTION DES RÉSERVATIONS ====================

  /**
   * Obtenir toutes les réservations actives
   */
  async getAllActiveReservations() {
    try {
      const pattern = `${this.config.RESERVATION_PREFIX}*`;
      const keys = await redis.keys(pattern);
      
      const reservations = [];
      const now = Date.now();
      
      for (const key of keys) {
        const reservation = await redis.get(key);
        
        if (reservation && reservation.reservedUntil > now) {
          reservations.push(reservation);
        } else if (reservation) {
          // Réservation expirée, nettoyer
          const driverId = key.replace(this.config.RESERVATION_PREFIX, '');
          await this.release(driverId);
        }
      }
      
      return reservations;
      
    } catch (error) {
      console.error('❌ Erreur récupération réservations actives:', error);
      return [];
    }
  }

  /**
   * Obtenir les chauffeurs réservés pour une course
   */
  async getReservedDriversForRide(rideId) {
    try {
      const rideReservationKey = `${this.config.RIDE_RESERVATIONS_PREFIX}${rideId}`;
      const driverIds = await redis.smembers(rideReservationKey);
      
      const reservedDrivers = [];
      
      for (const driverId of driverIds) {
        const reservation = await this.getReservation(driverId);
        if (reservation) {
          reservedDrivers.push(reservation);
        }
      }
      
      return reservedDrivers;
      
    } catch (error) {
      console.error(`❌ Erreur récupération chauffeurs réservés ${rideId}:`, error);
      return [];
    }
  }

  /**
   * Vérifier si un chauffeur est réservé pour une course spécifique
   */
  async isDriverReservedForRide(driverId, rideId) {
    try {
      const reservation = await this.getReservation(driverId);
      
      if (!reservation) {
        return false;
      }
      
      return reservation.rideId === rideId;
      
    } catch (error) {
      console.error(`❌ Erreur vérification réservation spécifique ${driverId}:`, error);
      return false;
    }
  }

  /**
   * Prolonger une réservation
   */
  async extendReservation(driverId, additionalSeconds) {
    try {
      const reservation = await this.getReservation(driverId);
      
      if (!reservation) {
        throw new Error(`Aucune réservation trouvée pour ${driverId}`);
      }
      
      const newExpiry = reservation.reservedUntil + (additionalSeconds * 1000);
      reservation.reservedUntil = newExpiry;
      
      const reservationKey = `${this.config.RESERVATION_PREFIX}${driverId}`;
      const ttl = Math.ceil((newExpiry - Date.now()) / 1000);
      
      await redis.setex(reservationKey, ttl, reservation);
      
      console.log(`⏱️  Réservation ${driverId} prolongée de ${additionalSeconds}s`);
      return reservation;
      
    } catch (error) {
      console.error(`❌ Erreur prolongation réservation ${driverId}:`, error);
      throw error;
    }
  }

  // ==================== MAINTENANCE ====================

  /**
   * Démarrer l'intervalle de nettoyage
   */
  startCleanupInterval() {
    setInterval(async () => {
      await this.cleanupExpiredReservations();
    }, this.config.CLEANUP_INTERVAL);
    
    console.log('🧹 Intervalle nettoyage réservations démarré');
  }

  /**
   * Nettoyer les réservations expirées
   */
  async cleanupExpiredReservations() {
    try {
      //console.log('🧹 Nettoyage réservations expirées...');
      
      const pattern = `${this.config.RESERVATION_PREFIX}*`;
      const keys = await redis.keys(pattern);
      
      let cleaned = 0;
      const now = Date.now();
      
      for (const key of keys) {
        const reservation = await redis.get(key);
        
        if (reservation && reservation.reservedUntil < now) {
          const driverId = key.replace(this.config.RESERVATION_PREFIX, '');
          await this.release(driverId);
          cleaned++;
        }
      }
      
      if (cleaned > 0) {
        console.log(`✅ ${cleaned} réservations expirées nettoyées`);
      }
      
      return cleaned;
      
    } catch (error) {
      console.error('❌ Erreur nettoyage réservations:', error);
      return 0;
    }
  }

  /**
   * Obtenir les statistiques des réservations
   */
  async getReservationStats() {
    try {
      const activeReservations = await this.getAllActiveReservations();
      
      // Regrouper par course
      const byRide = {};
      activeReservations.forEach(reservation => {
        const { rideId } = reservation;
        if (!byRide[rideId]) {
          byRide[rideId] = [];
        }
        byRide[rideId].push(reservation);
      });
      
      return {
        totalActive: activeReservations.length,
        byRide: Object.keys(byRide).map(rideId => ({
          rideId,
          driverCount: byRide[rideId].length,
          drivers: byRide[rideId].map(r => r.driverId)
        })),
        timestamp: Date.now()
      };
      
    } catch (error) {
      console.error('❌ Erreur récupération statistiques réservations:', error);
      return {
        totalActive: 0,
        byRide: [],
        timestamp: Date.now()
      };
    }
  }

  /**
   * Vérifier l'état de santé du service
   */
  async healthCheck() {
    try {
      // Vérifier la connexion Redis
      await redis.ping();
      
      // Vérifier les réservations actives
      const stats = await this.getReservationStats();
      
      return {
        status: 'healthy',
        redis: 'connected',
        activeReservations: stats.totalActive,
        timestamp: Date.now()
      };
      
    } catch (error) {
      return {
        status: 'unhealthy',
        error: error.message,
        timestamp: Date.now()
      };
    }
  }

  /**
   * Forcer la libération de tous les chauffeurs (pour tests/securité)
   */
  async forceReleaseAll() {
    try {
      console.log('⚠️  FORCE libération tous chauffeurs...');
      
      const pattern = `${this.config.RESERVATION_PREFIX}*`;
      const keys = await redis.keys(pattern);
      
      let released = 0;
      
      for (const key of keys) {
        const driverId = key.replace(this.config.RESERVATION_PREFIX, '');
        await this.release(driverId);
        released++;
      }
      
      // Nettoyer aussi les listes de courses
      const ridePattern = `${this.config.RIDE_RESERVATIONS_PREFIX}*`;
      const rideKeys = await redis.keys(ridePattern);
      
      if (rideKeys.length > 0) {
        await redis.del(...rideKeys);
      }
      
      console.log(`✅ FORCE libération: ${released} chauffeurs libérés`);
      return released;
      
    } catch (error) {
      console.error('❌ Erreur force libération:', error);
      throw error;
    }
  }
}

module.exports = DriverReservation;