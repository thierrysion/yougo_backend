// services/DriverStatsService.js
const redis = require('../config/redis');

class DriverStatsService {
  constructor() {
    this.stats = {
      totalOnline: 0,
      totalAvailable: 0,
      totalInRide: 0,
      totalOffline: 0,
      lastUpdated: 0
    };
  }

  /**
   * Obtenir les statistiques actuelles
   */
  async getStats() {
    try {
      const onlineDrivers = await redis.smembers('drivers:online') || [];
      
      let available = 0;
      let inRide = 0;
      let offline = 0;
      
      for (const driverId of onlineDrivers) {
        const driverKey = `driver:${driverId}`;
        const driverData = await redis.get(driverKey);
        
        if (driverData) {
          if (driverData.driverStatus === 'available') {
            available++;
          } else if (driverData.driverStatus === 'in_ride') {
            inRide++;
          } else {
            offline++;
          }
        }
      }
      
      const stats = {
        totalOnline: onlineDrivers.length,
        totalAvailable: available,
        totalInRide: inRide,
        totalOffline: offline,
        lastUpdated: Date.now()
      };
      
      // Mettre en cache
      this.stats = stats;
      await redis.set('stats:drivers', JSON.stringify(stats), 60); // 1 minute
      
      return stats;
      
    } catch (error) {
      console.error('Erreur récupération stats chauffeurs:', error);
      return this.stats;
    }
  }

  /**
   * Obtenir la liste des chauffeurs en ligne
   */
  async getOnlineDrivers() {
    try {
      const driverIds = await redis.smembers('drivers:online') || [];
      const drivers = [];
      
      for (const driverId of driverIds) {
        const driverKey = `driver:${driverId}`;
        const driverData = await redis.get(driverKey);
        
        if (driverData && driverData.isOnline) {
          drivers.push({
            driverId,
            ...driverData
          });
        }
      }
      
      return drivers;
      
    } catch (error) {
      console.error('Erreur récupération chauffeurs en ligne:', error);
      return [];
    }
  }

  /**
   * Obtenir la répartition par type de véhicule
   */
  async getDistributionByVehicleType() {
    try {
      const drivers = await this.getOnlineDrivers();
      const distribution = {};
      
      drivers.forEach(driver => {
        const vehicleType = driver.vehicleType || 'unknown';
        distribution[vehicleType] = (distribution[vehicleType] || 0) + 1;
      });
      
      return distribution;
      
    } catch (error) {
      console.error('Erreur répartition véhicules:', error);
      return {};
    }
  }

  /**
   * Mettre à jour les stats en temps réel
   */
  startRealTimeUpdates() {
    setInterval(async () => {
      await this.getStats();
    }, 30000); // Toutes les 30 secondes
  }
}

module.exports = new DriverStatsService();