// config/redis.js
const Redis = require('ioredis');
require('dotenv').config();

class RedisClient {
  constructor() {
    this.client = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: process.env.REDIS_PORT || 6379,
      password: process.env.REDIS_PASSWORD,
      retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      showFriendlyErrorStack: true,
    });

    this.client.on('connect', () => {
      console.log('✅ Redis connecté');
    });

    this.client.on('ready', () => {
      console.log('🚀 Redis prêt');
    });

    this.client.on('error', (err) => {
      console.error('❌ Erreur Redis:', err);
    });

    this.client.on('reconnecting', () => {
      console.log('🔄 Reconnexion à Redis...');
    });
  }

  // ==================== MÉTHODES DE BASE ====================

  async set(key, value, ttl = null) {
    try {
      const serialized = JSON.stringify(value);
      if (ttl) {
        return await this.client.setex(key, ttl, serialized);
      }
      return await this.client.set(key, serialized);
    } catch (error) {
      console.error(`❌ Redis.set erreur pour ${key}:`, error);
      throw error;
    }
  }

  async get(key) {
    try {
      const data = await this.client.get(key);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      console.error(`❌ Redis.get erreur pour ${key}:`, error);
      return null;
    }
  }

  async del(key) {
    try {
      return await this.client.del(key);
    } catch (error) {
      console.error(`❌ Redis.del erreur pour ${key}:`, error);
      throw error;
    }
  }

  async exists(key) {
    try {
      return await this.client.exists(key);
    } catch (error) {
      console.error(`❌ Redis.exists erreur pour ${key}:`, error);
      return 0;
    }
  }

  async expire(key, seconds) {
    try {
      return await this.client.expire(key, seconds);
    } catch (error) {
      console.error(`❌ Redis.expire erreur pour ${key}:`, error);
      throw error;
    }
  }

  async ttl(key) {
    try {
      return await this.client.ttl(key);
    } catch (error) {
      console.error(`❌ Redis.ttl erreur pour ${key}:`, error);
      return -2;
    }
  }

  async keys(pattern) {
    try {
      return await this.client.keys(pattern);
    } catch (error) {
      console.error(`❌ Redis.keys erreur pour ${pattern}:`, error);
      return [];
    }
  }

  // ==================== HASH ====================

  async hset(key, field, value) {
    try {
      return await this.client.hset(key, field, JSON.stringify(value));
    } catch (error) {
      console.error(`❌ Redis.hset erreur pour ${key}.${field}:`, error);
      throw error;
    }
  }

  async hget(key, field) {
    try {
      const data = await this.client.hget(key, field);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      console.error(`❌ Redis.hget erreur pour ${key}.${field}:`, error);
      return null;
    }
  }

  async hgetall(key) {
    try {
      const data = await this.client.hgetall(key);
      if (!data) return null;
      
      const result = {};
      for (const [field, value] of Object.entries(data)) {
        try {
          result[field] = JSON.parse(value);
        } catch {
          result[field] = value; // Si ce n'est pas du JSON, garder la valeur brute
        }
      }
      return result;
    } catch (error) {
      console.error(`❌ Redis.hgetall erreur pour ${key}:`, error);
      return null;
    }
  }

  async hdel(key, field) {
    try {
      return await this.client.hdel(key, field);
    } catch (error) {
      console.error(`❌ Redis.hdel erreur pour ${key}.${field}:`, error);
      throw error;
    }
  }

  async hkeys(key) {
    try {
      return await this.client.hkeys(key);
    } catch (error) {
      console.error(`❌ Redis.hkeys erreur pour ${key}:`, error);
      return [];
    }
  }

  async hlen(key) {
    try {
      return await this.client.hlen(key);
    } catch (error) {
      console.error(`❌ Redis.hlen erreur pour ${key}:`, error);
      return 0;
    }
  }

  // ==================== SET ====================

  async sadd(key, value) {
    try {
      return await this.client.sadd(key, JSON.stringify(value));
    } catch (error) {
      console.error(`❌ Redis.sadd erreur pour ${key}:`, error);
      throw error;
    }
  }

  async srem(key, value) {
    try {
      return await this.client.srem(key, JSON.stringify(value));
    } catch (error) {
      console.error(`❌ Redis.srem erreur pour ${key}:`, error);
      throw error;
    }
  }

  async smembers(key) {
    try {
      const data = await this.client.smembers(key);
      return data.map(item => {
        try {
          return JSON.parse(item);
        } catch {
          return item; // Si ce n'est pas du JSON
        }
      });
    } catch (error) {
      console.error(`❌ Redis.smembers erreur pour ${key}:`, error);
      return [];
    }
  }

  async sismember(key, value) {
    try {
      return await this.client.sismember(key, JSON.stringify(value));
    } catch (error) {
      console.error(`❌ Redis.sismember erreur pour ${key}:`, error);
      return 0;
    }
  }

  async scard(key) {
    try {
      return await this.client.scard(key);
    } catch (error) {
      console.error(`❌ Redis.scard erreur pour ${key}:`, error);
      return 0;
    }
  }

  // ==================== SORTED SET ====================

  async zadd(key, score, value) {
    try {
      return await this.client.zadd(key, score, JSON.stringify(value));
    } catch (error) {
      console.error(`❌ Redis.zadd erreur pour ${key}:`, error);
      throw error;
    }
  }

  async zrange(key, start, stop, withScores = false) {
    try {
      const args = [key, start, stop];
      if (withScores) {
        args.push('WITHSCORES');
      }
      
      const data = await this.client.zrange(...args);
      
      if (!withScores) {
        return data.map(item => {
          try {
            return JSON.parse(item);
          } catch {
            return item;
          }
        });
      }
      
      // Avec scores
      const result = [];
      for (let i = 0; i < data.length; i += 2) {
        try {
          result.push({
            value: JSON.parse(data[i]),
            score: parseFloat(data[i + 1])
          });
        } catch {
          result.push({
            value: data[i],
            score: parseFloat(data[i + 1])
          });
        }
      }
      return result;
    } catch (error) {
      console.error(`❌ Redis.zrange erreur pour ${key}:`, error);
      return [];
    }
  }

  async zrem(key, value) {
    try {
      return await this.client.zrem(key, JSON.stringify(value));
    } catch (error) {
      console.error(`❌ Redis.zrem erreur pour ${key}:`, error);
      throw error;
    }
  }

  async zremrangebyscore(key, min, max) {
    try {
      return await this.client.zremrangebyscore(key, min, max);
    } catch (error) {
      console.error(`❌ Redis.zremrangebyscore erreur pour ${key}:`, error);
      throw error;
    }
  }

  async zcard(key) {
    try {
      return await this.client.zcard(key);
    } catch (error) {
      console.error(`❌ Redis.zcard erreur pour ${key}:`, error);
      return 0;
    }
  }

  async zscore(key, member) {
    try {
      return await this.client.zscore(key, JSON.stringify(member));
    } catch (error) {
      console.error(`❌ Redis.zscore erreur pour ${key}:`, error);
      return null;
    }
  }

  async zrank(key, member) {
    try {
      return await this.client.zrank(key, JSON.stringify(member));
    } catch (error) {
      console.error(`❌ Redis.zrank erreur pour ${key}:`, error);
      return null;
    }
  }

  // ==================== GEO ====================

  async geoadd(key, longitude, latitude, member) {
    try {
      return await this.client.geoadd(key, longitude, latitude, member);
    } catch (error) {
      console.error(`❌ Redis.geoadd erreur pour ${key}:`, error);
      throw error;
    }
  }

  async georadius(key, longitude, latitude, radius, unit, ...options) {
    try {
      const args = [key, longitude, latitude, radius, unit];
      
      // Ajouter les options
      if (options.includes('WITHDIST') || options.includes('WITHCOORD') || options.includes('WITHHASH')) {
        args.push(...options);
      }
      
      // Ajouter l'ordre si spécifié
      if (options.includes('ASC') || options.includes('DESC')) {
        args.push(options.find(opt => opt === 'ASC' || opt === 'DESC'));
      }
      
      return await this.client.georadius(...args);
    } catch (error) {
      console.error(`❌ Redis.georadius erreur pour ${key}:`, error);
      return [];
    }
  }

  async georadiusbymember(key, member, radius, unit, ...options) {
    try {
      const args = [key, member, radius, unit];
      
      if (options.includes('WITHDIST') || options.includes('WITHCOORD') || options.includes('WITHHASH')) {
        args.push(...options);
      }
      
      if (options.includes('ASC') || options.includes('DESC')) {
        args.push(options.find(opt => opt === 'ASC' || opt === 'DESC'));
      }
      
      return await this.client.georadiusbymember(...args);
    } catch (error) {
      console.error(`❌ Redis.georadiusbymember erreur pour ${key}:`, error);
      return [];
    }
  }

  async geopos(key, members) {
    try {
      if (!Array.isArray(members)) {
        members = [members];
      }
      return await this.client.geopos(key, ...members);
    } catch (error) {
      console.error(`❌ Redis.geopos erreur pour ${key}:`, error);
      return [];
    }
  }

  async geodist(key, member1, member2, unit = 'm') {
    try {
      return await this.client.geodist(key, member1, member2, unit);
    } catch (error) {
      console.error(`❌ Redis.geodist erreur pour ${key}:`, error);
      return null;
    }
  }

  async zrem(key, member) {
    try {
      // Pour retirer un membre d'un GEO set, on utilise zrem car GEO est implémenté avec Sorted Set
      return await this.client.zrem(key, member);
    } catch (error) {
      console.error(`❌ Redis.zrem (GEO) erreur pour ${key}:`, error);
      throw error;
    }
  }

  // ==================== LIST ====================

  async lpush(key, value) {
    try {
      return await this.client.lpush(key, JSON.stringify(value));
    } catch (error) {
      console.error(`❌ Redis.lpush erreur pour ${key}:`, error);
      throw error;
    }
  }

  async rpush(key, value) {
    try {
      return await this.client.rpush(key, JSON.stringify(value));
    } catch (error) {
      console.error(`❌ Redis.rpush erreur pour ${key}:`, error);
      throw error;
    }
  }

  async lpop(key) {
    try {
      const data = await this.client.lpop(key);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      console.error(`❌ Redis.lpop erreur pour ${key}:`, error);
      return null;
    }
  }

  async rpop(key) {
    try {
      const data = await this.client.rpop(key);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      console.error(`❌ Redis.rpop erreur pour ${key}:`, error);
      return null;
    }
  }

  async lrange(key, start, stop) {
    try {
      const data = await this.client.lrange(key, start, stop);
      return data.map(item => {
        try {
          return JSON.parse(item);
        } catch {
          return item;
        }
      });
    } catch (error) {
      console.error(`❌ Redis.lrange erreur pour ${key}:`, error);
      return [];
    }
  }

  async llen(key) {
    try {
      return await this.client.llen(key);
    } catch (error) {
      console.error(`❌ Redis.llen erreur pour ${key}:`, error);
      return 0;
    }
  }

  async ltrim(key, start, stop) {
    try {
      return await this.client.ltrim(key, start, stop);
    } catch (error) {
      console.error(`❌ Redis.ltrim erreur pour ${key}:`, error);
      throw error;
    }
  }

  // ==================== PUB/SUB ====================

  async publish(channel, message) {
    try {
      return await this.client.publish(channel, JSON.stringify(message));
    } catch (error) {
      console.error(`❌ Redis.publish erreur pour ${channel}:`, error);
      throw error;
    }
  }

  async subscribe(channel, callback) {
    try {
      const subscriber = this.client.duplicate();
      await subscriber.subscribe(channel);
      subscriber.on('message', (ch, msg) => {
        if (ch === channel) {
          try {
            callback(JSON.parse(msg));
          } catch (error) {
            console.error(`❌ Erreur parsing message ${channel}:`, error);
            callback(msg); // Retourner le message brut
          }
        }
      });
      
      subscriber.on('error', (err) => {
        console.error(`❌ Subscriber erreur ${channel}:`, err);
      });
      
      return subscriber;
    } catch (error) {
      console.error(`❌ Redis.subscribe erreur pour ${channel}:`, error);
      throw error;
    }
  }

  // ==================== ATOMIC OPERATIONS ====================

  async setnx(key, value) {
    try {
      return await this.client.setnx(key, JSON.stringify(value));
    } catch (error) {
      console.error(`❌ Redis.setnx erreur pour ${key}:`, error);
      throw error;
    }
  }

  async incr(key) {
    try {
      return await this.client.incr(key);
    } catch (error) {
      console.error(`❌ Redis.incr erreur pour ${key}:`, error);
      throw error;
    }
  }

  async decr(key) {
    try {
      return await this.client.decr(key);
    } catch (error) {
      console.error(`❌ Redis.decr erreur pour ${key}:`, error);
      throw error;
    }
  }

  async incrby(key, increment) {
    try {
      return await this.client.incrby(key, increment);
    } catch (error) {
      console.error(`❌ Redis.incrby erreur pour ${key}:`, error);
      throw error;
    }
  }

  async decrby(key, decrement) {
    try {
      return await this.client.decrby(key, decrement);
    } catch (error) {
      console.error(`❌ Redis.decrby erreur pour ${key}:`, error);
      throw error;
    }
  }

  // ==================== PIPELINE ====================

  async pipeline(operations) {
    try {
      const pipeline = this.client.pipeline();
      
      operations.forEach(([command, ...args]) => {
        // Serialiser les valeurs si nécessaire
        const serializedArgs = args.map(arg => {
          if (typeof arg === 'object' && arg !== null) {
            return JSON.stringify(arg);
          }
          return arg;
        });
        
        pipeline[command](...serializedArgs);
      });
      
      const results = await pipeline.exec();
      return results.map(([err, result]) => {
        if (err) throw err;
        return result;
      });
    } catch (error) {
      console.error('❌ Redis.pipeline erreur:', error);
      throw error;
    }
  }

  // ==================== UTILITAIRES ====================

  async ping() {
    try {
      return await this.client.ping();
    } catch (error) {
      console.error('❌ Redis.ping erreur:', error);
      return null;
    }
  }

  async info(section = null) {
    try {
      if (section) {
        return await this.client.info(section);
      }
      return await this.client.info();
    } catch (error) {
      console.error('❌ Redis.info erreur:', error);
      return null;
    }
  }

  async flushdb() {
    try {
      return await this.client.flushdb();
    } catch (error) {
      console.error('❌ Redis.flushdb erreur:', error);
      throw error;
    }
  }

  async flushall() {
    try {
      return await this.client.flushall();
    } catch (error) {
      console.error('❌ Redis.flushall erreur:', error);
      throw error;
    }
  }

  async dbsize() {
    try {
      return await this.client.dbsize();
    } catch (error) {
      console.error('❌ Redis.dbsize erreur:', error);
      return 0;
    }
  }

  // ==================== MÉTHODES SPÉCIALES POUR LE MATCHING ====================

  /**
   * Méthode utilitaire pour les opérations GEO avec parsing automatique
   */
  async findNearbyDrivers(key, longitude, latitude, radiusKm, options = {}) {
    try {
      const radiusMeters = radiusKm * 1000;
      const defaultOptions = ['WITHDIST', 'WITHCOORD', 'ASC'];
      
      // Fusionner les options
      const geoOptions = [...defaultOptions];
      if (options.withHash) geoOptions.push('WITHHASH');
      if (options.order === 'DESC') {
        geoOptions[geoOptions.indexOf('ASC')] = 'DESC';
      }
      
      const results = await this.georadius(
        key,
        longitude,
        latitude,
        radiusMeters,
        'm',
        ...geoOptions
      );
      
      // Parser les résultats
      return results.map(result => {
        // Format de retour ioredis: [member, distance, coordinates]
        const [member, distance, coordinates] = result;
        return {
          member,
          distance: parseFloat(distance),
          coordinates: coordinates ? {
            longitude: parseFloat(coordinates[0]),
            latitude: parseFloat(coordinates[1])
          } : null
        };
      });
    } catch (error) {
      console.error(`❌ findNearbyDrivers erreur pour ${key}:`, error);
      return [];
    }
  }

  /**
   * Batch set avec TTL
   */
  async msetex(items, ttl) {
    try {
      const pipeline = this.client.pipeline();
      
      items.forEach(({ key, value }) => {
        pipeline.setex(key, ttl, JSON.stringify(value));
      });
      
      await pipeline.exec();
      return items.length;
    } catch (error) {
      console.error('❌ Redis.msetex erreur:', error);
      throw error;
    }
  }

  /**
   * Batch get
   */
  async mget(keys) {
    try {
      const values = await this.client.mget(...keys);
      return values.map(value => value ? JSON.parse(value) : null);
    } catch (error) {
      console.error('❌ Redis.mget erreur:', error);
      return keys.map(() => null);
    }
  }

  /**
   * Atomic get and set
   */
  async getset(key, value) {
    try {
      const oldValue = await this.client.getset(key, JSON.stringify(value));
      return oldValue ? JSON.parse(oldValue) : null;
    } catch (error) {
      console.error(`❌ Redis.getset erreur pour ${key}:`, error);
      throw error;
    }
  }

  // ==================== SANTÉ ET MONITORING ====================

  async healthCheck() {
    try {
      const startTime = Date.now();
      await this.ping();
      const latency = Date.now() - startTime;
      
      const info = await this.info('memory');
      const memoryLine = info.split('\n').find(line => line.startsWith('used_memory_human:'));
      const memory = memoryLine ? memoryLine.split(':')[1].trim() : 'N/A';
      
      return {
        status: 'healthy',
        latency: `${latency}ms`,
        memory,
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
   * Surveiller les performances Redis
   */
  async monitorPerformance(sampleSize = 100) {
    const results = {
      operations: [],
      avgLatency: 0,
      successRate: 0,
      timestamp: Date.now()
    };
    
    // Exemple d'opérations de test
    const testKey = `perf_test_${Date.now()}`;
    const testValue = { test: true, timestamp: Date.now() };
    
    try {
      // Test SET
      const setStart = Date.now();
      await this.set(testKey, testValue, 10);
      results.operations.push({
        type: 'SET',
        latency: Date.now() - setStart,
        success: true
      });
      
      // Test GET
      const getStart = Date.now();
      await this.get(testKey);
      results.operations.push({
        type: 'GET',
        latency: Date.now() - getStart,
        success: true
      });
      
      // Calculer les métriques
      const successfulOps = results.operations.filter(op => op.success);
      results.avgLatency = successfulOps.reduce((sum, op) => sum + op.latency, 0) / successfulOps.length;
      results.successRate = (successfulOps.length / results.operations.length) * 100;
      
    } catch (error) {
      console.error('❌ Performance monitoring error:', error);
    }
    
    return results;
  }
}

// Singleton
const redisClient = new RedisClient();

// Export avec toutes les méthodes
module.exports = redisClient;