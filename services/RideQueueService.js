// services/RideQueueService.js
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