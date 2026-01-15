// services/DriverReservationService.js
const redis = require('../config/redis');

class DriverReservationService {
  constructor() {
    this.RESERVATION_DURATION = 20; // 20 secondes
    this.RESERVATION_KEY_PREFIX = 'reservation:';
    this.RIDE_RESERVATION_KEY_PREFIX = 'ride:reservations:';
  }

  async reserveDriver(driverId, rideId) {
    try {
      // Vérifier que le chauffeur n'est pas déjà réservé
      const existingReservation = await this.getReservation(driverId);
      if (existingReservation) {
        throw new Error(`Driver ${driverId} already reserved`);
      }

      const reservation = {
        driverId,
        rideId,
        reservedUntil: Date.now() + (this.RESERVATION_DURATION * 1000),
        status: 'reserved',
        createdAt: Date.now()
      };

      // Stocker la réservation avec TTL
      const reservationKey = `${this.RESERVATION_KEY_PREFIX}${driverId}`;
      await redis.set(reservationKey, reservation, this.RESERVATION_DURATION);

      // Ajouter à la liste des réservations de la course
      const rideReservationKey = `${this.RIDE_RESERVATION_KEY_PREFIX}${rideId}`;
      await redis.sadd(rideReservationKey, driverId);
      await redis.expire(rideReservationKey, this.RESERVATION_DURATION);

      console.log(`✅ Chauffeur ${driverId} réservé pour la course ${rideId}`);
      return reservation;

    } catch (error) {
      console.error('Erreur réservation chauffeur:', error);
      throw error;
    }
  }

  async isDriverReserved(driverId) {
    const reservationKey = `${this.RESERVATION_KEY_PREFIX}${driverId}`;
    const reservation = await redis.get(reservationKey);
    
    if (!reservation) return false;
    
    // Vérifier si la réservation est expirée
    if (reservation.reservedUntil < Date.now()) {
      await this.releaseDriver(driverId);
      return false;
    }
    
    return true;
  }

  async releaseDriver(driverId) {
    const reservationKey = `${this.RESERVATION_KEY_PREFIX}${driverId}`;
    const reservation = await redis.get(reservationKey);
    
    if (reservation) {
      // Supprimer de la liste des réservations de la course
      const rideReservationKey = `${this.RIDE_RESERVATION_KEY_PREFIX}${reservation.rideId}`;
      await redis.srem(rideReservationKey, driverId);
      
      // Supprimer la réservation
      await redis.del(reservationKey);
      console.log(`🔓 Chauffeur ${driverId} libéré`);
      return true;
    }
    
    return false;
  }

  async getReservation(driverId) {
    const reservationKey = `${this.RESERVATION_KEY_PREFIX}${driverId}`;
    return await redis.get(reservationKey);
  }

  async getRideReservations(rideId) {
    const rideReservationKey = `${this.RIDE_RESERVATION_KEY_PREFIX}${rideId}`;
    return await redis.smembers(rideReservationKey);
  }

  async cleanupExpiredReservations() {
    // Cette méthode peut être appelée périodiquement pour nettoyer
    // mais avec TTL Redis le fait automatiquement
    console.log('🧹 Redis TTL gère automatiquement les réservations expirées');
  }
}

module.exports = DriverReservationService;



////////////////////// OLD IMPLEMENTATION ////////////////////////////////




/*// services/DriverReservationService.js
const { Driver } = require('../models');

class DriverReservationService {
  constructor() {
    this.reservedDrivers = new Map(); // driverId -> reservationData
    this.RESERVATION_DURATION = 20000; // 20 secondes
  }

  async reserveDriver(driverId, rideId) {
    try {
      // Vérifier que le chauffeur existe et est disponible
      const driver = await Driver.findOne({
        where: { 
          user_id: driverId,
          driver_status: 'approved',
          is_online: true
        }
      });

      if (!driver) {
        throw new Error(`Driver ${driverId} not available`);
      }

      const reservation = {
        driverId,
        rideId,
        reservedUntil: new Date(Date.now() + this.RESERVATION_DURATION),
        status: 'reserved',
        createdAt: new Date()
      };
      
      this.reservedDrivers.set(driverId, reservation);
      console.log(`✅ Chauffeur ${driverId} réservé pour la course ${rideId}`);
      return reservation;
    } catch (error) {
      console.error('Erreur réservation chauffeur:', error);
      throw error;
    }
  }

  isDriverReserved(driverId) {
    const reservation = this.reservedDrivers.get(driverId);
    if (!reservation) return false;
    
    // Nettoyage des réservations expirées
    if (reservation.reservedUntil < new Date()) {
      console.log(`🕒 Réservation expirée pour le chauffeur ${driverId}`);
      this.reservedDrivers.delete(driverId);
      return false;
    }
    
    return true;
  }

  releaseDriver(driverId) {
    const existed = this.reservedDrivers.has(driverId);
    this.reservedDrivers.delete(driverId);
    if (existed) {
      console.log(`🔓 Chauffeur ${driverId} libéré`);
    }
    return existed;
  }

  getReservation(driverId) {
    return this.reservedDrivers.get(driverId);
  }

  // Nettoyage périodique des réservations expirées
  startCleanupInterval() {
    setInterval(() => {
      const now = new Date();
      let cleanedCount = 0;
      
      for (const [driverId, reservation] of this.reservedDrivers.entries()) {
        if (reservation.reservedUntil < now) {
          this.reservedDrivers.delete(driverId);
          cleanedCount++;
        }
      }
      
      if (cleanedCount > 0) {
        console.log(`🧹 Nettoyage: ${cleanedCount} réservations expirées`);
      }
    }, 30000); // Toutes les 30 secondes
  }
}

module.exports = DriverReservationService;*/