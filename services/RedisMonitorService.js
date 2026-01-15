// services/RedisMonitorService.js
const redis = require('../config/redis');

class RedisMonitorService {
  constructor() {
    this.stats = {
      totalOperations: 0,
      cacheHits: 0,
      cacheMisses: 0,
      errors: 0
    };
  }

  async getRedisStats() {
    try {
      const info = await redis.client.info();
      const stats = {
        connected_clients: 0,
        used_memory_human: '0B',
        total_commands_processed: 0,
        keyspace_hits: 0,
        keyspace_misses: 0,
        uptime_in_seconds: 0
      };

      // Parser les informations Redis
      const lines = info.split('\r\n');
      lines.forEach(line => {
        if (line.startsWith('connected_clients:')) {
          stats.connected_clients = parseInt(line.split(':')[1]);
        } else if (line.startsWith('used_memory_human:')) {
          stats.used_memory_human = line.split(':')[1];
        } else if (line.startsWith('total_commands_processed:')) {
          stats.total_commands_processed = parseInt(line.split(':')[1]);
        } else if (line.startsWith('keyspace_hits:')) {
          stats.keyspace_hits = parseInt(line.split(':')[1]);
        } else if (line.startsWith('keyspace_misses:')) {
          stats.keyspace_misses = parseInt(line.split(':')[1]);
        } else if (line.startsWith('uptime_in_seconds:')) {
          stats.uptime_in_seconds = parseInt(line.split(':')[1]);
        }
      });

      // Obtenir les clés par pattern
      const matchingKeys = await redis.keys('matching:state:*');
      const reservationKeys = await redis.keys('reservation:*');
      const queueKeys = await redis.keys('ride:queue');

      return {
        ...stats,
        totalMatchingStates: matchingKeys.length,
        totalReservations: reservationKeys.length,
        queueSize: queueKeys.length,
        cacheHitRate: stats.keyspace_hits / (stats.keyspace_hits + stats.keyspace_misses) || 0,
        appStats: this.stats
      };

    } catch (error) {
      console.error('Erreur récupération stats Redis:', error);
      return null;
    }
  }

  async getActiveMatches() {
    const pattern = 'matching:state:*';
    const keys = await redis.keys(pattern);
    const matches = [];

    for (const key of keys) {
      const match = await redis.get(key);
      if (match) {
        const rideId = key.replace('matching:state:', '');
        matches.push({
          rideId,
          ...match,
          ttl: await redis.client.ttl(key)
        });
      }
    }

    return matches;
  }

  async getQueueStatus() {
    const queueKey = 'ride:queue';
    const rideIds = await redis.zrange(queueKey, 0, -1);
    
    const queue = [];
    for (const rideId of rideIds) {
      const dataKey = `ride:queue:data:${rideId}`;
      const data = await redis.get(dataKey);
      if (data) {
        const position = await redis.zrank(queueKey, rideId);
        queue.push({
          rideId,
          position: position + 1,
          ...data,
          ttl: await redis.client.ttl(dataKey)
        });
      }
    }

    return queue;
  }

  async cleanupAll() {
    // Nettoyer toutes les données (à utiliser avec précaution)
    const patterns = [
      'matching:state:*',
      'matching:timers:*',
      'continuous:matching:*',
      'matching:timeouts:*',
      'reservation:*',
      'ride:reservations:*',
      'ride:queue',
      'ride:queue:data:*'
    ];

    let totalDeleted = 0;
    for (const pattern of patterns) {
      const keys = await redis.keys(pattern);
      for (const key of keys) {
        await redis.del(key);
        totalDeleted++;
      }
    }

    return { totalDeleted };
  }

  incrementOperation() {
    this.stats.totalOperations++;
  }

  incrementCacheHit() {
    this.stats.cacheHits++;
  }

  incrementCacheMiss() {
    this.stats.cacheMisses++;
  }

  incrementError() {
    this.stats.errors++;
  }
}

module.exports = new RedisMonitorService();