// services/RedisSyncService.js
class RedisSyncService {
  constructor() {
    this.syncInterval = 30000; // 30 secondes
  }
  
  startSyncService() {
    console.log('🔄 Démarrage service de synchronisation Redis ↔ DB');
    
    // Synchroniser périodiquement
    setInterval(() => {
      this.syncActiveRidesToRedis();
      this.syncDriverStatusFromRedis();
    }, this.syncInterval);
  }
  
  /**
   * Synchroniser les courses actives depuis DB vers Redis
   */
  async syncActiveRidesToRedis() {
    try {
      console.log('🔄 Synchronisation courses actives DB → Redis');
      
      const activeRides = await Ride.findAll({
        where: {
          status: ['accepted', 'driver_en_route', 'in_progress'],
          updated_at: {
            [Op.gte]: new Date(Date.now() - 2 * 60 * 60 * 1000) // 2 dernières heures
          }
        },
        include: [{
          model: Driver,
          as: 'driver',
          include: ['user']
        }],
        limit: 100
      });
      
      for (const ride of activeRides) {
        if (ride.driver && ride.driver.user_id) {
          const driverId = ride.driver.user_id;
          
          // Mettre à jour Redis
          await redis.set(`ride:active:${ride.id}`, {
            rideId: ride.id,
            driverId,
            status: ride.status,
            startedAt: ride.started_at ? new Date(ride.started_at).getTime() : null,
            estimatedDuration: ride.estimated_duration,
            customerId: ride.customer_id,
            lastUpdated: Date.now()
          }, 3600);
          
          // Associer chauffeur → course
          await redis.hset('driver:active:rides', driverId, ride.id);
          
          // Mettre à jour le statut du chauffeur
          await redis.zadd('drivers:status:in_ride', Date.now(), driverId);
          await redis.expire('drivers:status:in_ride', 300);
        }
      }
      
      console.log(`✅ ${activeRides.length} courses synchronisées DB → Redis`);
      
    } catch (error) {
      console.error('❌ Erreur synchronisation courses:', error);
    }
  }
  
  /**
   * Synchroniser les statuts chauffeurs depuis Redis vers DB
   */
  async syncDriverStatusFromRedis() {
    try {
      console.log('🔄 Synchronisation statuts chauffeurs Redis → DB');
      
      // Récupérer tous les chauffeurs avec statut depuis Redis
      const statuses = ['available', 'in_ride', 'offline'];
      let updatedCount = 0;
      
      for (const status of statuses) {
        const driverIds = await redis.zrange(`drivers:status:${status}`, 0, -1);
        
        for (const driverId of driverIds) {
          try {
            // Mettre à jour la DB
            await Driver.update({
              driver_status: status === 'in_ride' ? 'on_ride' : status,
              last_status_update: new Date(),
              is_online: status !== 'offline'
            }, {
              where: { user_id: driverId }
            });
            
            updatedCount++;
            
          } catch (error) {
            console.error(`Erreur mise à jour chauffeur ${driverId}:`, error);
          }
        }
      }
      
      console.log(`✅ ${updatedCount} chauffeurs synchronisés Redis → DB`);
      
    } catch (error) {
      console.error('❌ Erreur synchronisation statuts:', error);
    }
  }
}