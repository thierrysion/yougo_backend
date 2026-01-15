// services/RideQueueService.js
const redis = require('../config/redis');

class RideQueueService {
  constructor() {
    this.QUEUE_KEY = 'ride:queue';
    this.QUEUE_DATA_PREFIX = 'ride:queue:data:';
    this.EXPIRY_TIME = 3600; // 1 heure
  }

  async addToQueue(rideId, matchingState) {
    const queueData = {
      ...matchingState,
      queuePosition: await this.getQueueSize() + 1,
      addedAt: Date.now(),
      lastUpdated: Date.now()
    };

    // Ajouter à la file d'attente (sorted set par timestamp)
    const score = Date.now();
    await redis.zadd(this.QUEUE_KEY, score, rideId);

    // Stocker les données de la course
    const dataKey = `${this.QUEUE_DATA_PREFIX}${rideId}`;
    await redis.set(dataKey, queueData, this.EXPIRY_TIME);

    console.log(`📝 Course ${rideId} ajoutée à la file d'attente Redis`);
    
    return queueData;
  }

  async getQueueStatus(rideId) {
    const dataKey = `${this.QUEUE_DATA_PREFIX}${rideId}`;
    const rideQueue = await redis.get(dataKey);
    
    if (!rideQueue) return null;

    // Obtenir la position dans la file
    const position = await redis.zrank(this.QUEUE_KEY, rideId);
    
    if (position === null) return null;

    const queueSize = await this.getQueueSize();
    const estimatedWaitTime = this.calculateWaitTime(position, rideQueue.notifiedDrivers.length);

    return {
      queuePosition: position + 1,
      totalInQueue: queueSize,
      estimatedWaitTime,
      notifiedDrivers: rideQueue.notifiedDrivers.length,
      driversAvailable: rideQueue.availableDrivers.length - rideQueue.notifiedDrivers.length,
      currentDriverIndex: rideQueue.currentDriverIndex,
      status: rideQueue.status
    };
  }

  calculateWaitTime(position, notifiedCount) {
    const baseTimePerDriver = 20;
    const bufferBetweenDrivers = 2;
    return (position * bufferBetweenDrivers) + (notifiedCount * baseTimePerDriver);
  }

  async updateRideState(rideId, updates) {
    const dataKey = `${this.QUEUE_DATA_PREFIX}${rideId}`;
    const rideQueue = await redis.get(dataKey);
    
    if (rideQueue) {
      Object.assign(rideQueue, updates, { lastUpdated: Date.now() });
      await redis.set(dataKey, rideQueue, this.EXPIRY_TIME);
      return true;
    }
    
    return false;
  }

  async removeFromQueue(rideId) {
    // Retirer de la file d'attente
    await redis.zrem(this.QUEUE_KEY, rideId);
    
    // Supprimer les données
    const dataKey = `${this.QUEUE_DATA_PREFIX}${rideId}`;
    await redis.del(dataKey);
    
    console.log(`🗑️ Course ${rideId} retirée de la file d'attente Redis`);
    return true;
  }

  async getQueueSize() {
    return await redis.zcard(this.QUEUE_KEY);
  }

  async getAllActiveRides() {
    const rideIds = await redis.zrange(this.QUEUE_KEY, 0, -1);
    const rides = [];
    
    for (const rideId of rideIds) {
      const dataKey = `${this.QUEUE_DATA_PREFIX}${rideId}`;
      const data = await redis.get(dataKey);
      if (data) {
        rides.push({
          rideId,
          ...data
        });
      }
    }
    
    return rides;
  }

  async cleanupExpiredQueueEntries() {
    // Supprimer les entrées expirées (plus vieilles que 30 minutes)
    const cutoffScore = Date.now() - (30 * 60 * 1000);
    await redis.zremrangebyscore(this.QUEUE_KEY, 0, cutoffScore);
    
    // Les données associées seront supprimées automatiquement par TTL
  }
}

module.exports = RideQueueService;



///////////////////////// OLD IMPLEMENTATION ///////////////////////////////


/*// services/RideQueueService.js
class RideQueueService {
  constructor() {
    this.activeRides = new Map(); // rideId -> queue data
  }

  addToQueue(rideId, matchingState) {
    const queueData = {
      ...matchingState,
      queuePosition: this.activeRides.size + 1,
      addedAt: new Date(),
      lastUpdated: new Date()
    };

    this.activeRides.set(rideId, queueData);
    console.log(`📝 Course ${rideId} ajoutée à la file d'attente. Position: ${queueData.queuePosition}`);
    
    return queueData;
  }

  getQueueStatus(rideId) {
    const rideQueue = this.activeRides.get(rideId);
    if (!rideQueue) return null;

    // Calculer la position actuelle dans la file
    const allRides = Array.from(this.activeRides.entries());
    const position = allRides.findIndex(([id]) => id === rideId) + 1;

    const estimatedWaitTime = this.calculateWaitTime(position, rideQueue.notifiedDrivers.length);

    return {
      queuePosition: position,
      totalInQueue: this.activeRides.size,
      estimatedWaitTime,
      notifiedDrivers: rideQueue.notifiedDrivers.length,
      driversAvailable: rideQueue.availableDrivers.length - rideQueue.notifiedDrivers.length,
      currentDriverIndex: rideQueue.currentDriverIndex,
      status: rideQueue.status
    };
  }

  calculateWaitTime(position, notifiedCount) {
    // 20 secondes par chauffeur notifié + 2 secondes de buffer
    const baseTimePerDriver = 20;
    const bufferBetweenDrivers = 2;
    
    return (position * bufferBetweenDrivers) + (notifiedCount * baseTimePerDriver);
  }

  updateRideState(rideId, updates) {
    const rideQueue = this.activeRides.get(rideId);
    if (rideQueue) {
      Object.assign(rideQueue, updates, { lastUpdated: new Date() });
      return true;
    }
    return false;
  }

  removeFromQueue(rideId) {
    const existed = this.activeRides.has(rideId);
    this.activeRides.delete(rideId);
    if (existed) {
      console.log(`🗑️ Course ${rideId} retirée de la file d'attente`);
    }
    return existed;
  }

  getAllActiveRides() {
    return Array.from(this.activeRides.entries()).map(([rideId, data]) => ({
      rideId,
      ...data
    }));
  }
}

module.exports = RideQueueService;
*/