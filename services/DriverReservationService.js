// services/DriverReservationService.js
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

module.exports = DriverReservationService;