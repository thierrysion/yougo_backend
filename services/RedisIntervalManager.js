// services/RedisIntervalManager.js
const redis = require('../config/redis');
//const { v4: uuidv4 } = require('uuid');
const { randomUUID } = require('crypto');

class RedisIntervalManager {
  constructor() {
    this.localIntervals = new Map(); // Pour nettoyage local seulement
    this.localCallbacks = new Map(); // Stockage local des callbacks
    this.instanceId = randomUUID(); //uuidv4(); // Identifiant unique de l'instance
    this.INTERVAL_TTL = 300; // 5 minutes (doit être > interval duration)
  
    // Clés Redis structurées
    this.REDIS_KEYS = {
      INTERVAL: 'interval:', // interval:{intervalId}
      INTERVAL_INDEX: 'index:intervals', // Sorted set de tous les intervalles
      INSTANCE_INTERVALS: 'instance:intervals:', // instance:intervals:{instanceId}
      KEY_INTERVALS: 'key:intervals:', // key:intervals:{key}
      INSTANCE_HEARTBEAT: 'instance:heartbeat:', // instance:heartbeat:{instanceId}
      INTERVAL_LOCK: 'lock:interval:' // lock:interval:{intervalId}
    };
  }

  /**
   * Créer un intervalle géré par Redis
   */
  async createInterval(key, callback, intervalMs, data = {}) {
    const intervalId = `${key}:${this.instanceId}:${randomUUID()/*uuidv4()*/}`;
    
    console.log(`⏱️  Création intervalle Redis: ${intervalId}`);
    
    // Stocker le callback localement (NE PAS stocker dans Redis)
    this.localCallbacks.set(intervalId, {
      fn: callback,
      data,
      key
    });
    
    // Données de l'intervalle pour Redis (sans callback)
    const intervalData = {
      intervalId,
      key,
      instanceId: this.instanceId,
      intervalMs,
      dataKey: this.hashData(data), // Hash pour identifier les données
      createdAt: Date.now(),
      lastExecuted: null,
      nextExecution: Date.now() + intervalMs,
      status: 'active'
    };
    
    // Stocker dans Redis avec TTL
    await redis.set(
      `interval:${intervalId}`,
      intervalData,
      this.INTERVAL_TTL
    );
    
    // Ajouter à l'index par clé (avec score pour tri)
    await redis.zadd(`index:intervals:by_key`, Date.now(), intervalId);
    await redis.zadd(`index:intervals:key:${key}`, Date.now(), intervalId);
    
    // Ajouter à l'index d'instance
    await redis.zadd(`index:intervals:instance:${this.instanceId}`, Date.now(), intervalId);
    
    // Créer l'intervalle local
    const localInterval = setInterval(async () => {
      await this.executeInterval(intervalId);
    }, intervalMs);
    
    // Stocker localement pour nettoyage
    this.localIntervals.set(intervalId, {
      interval: localInterval,
      key,
      data
    });
    
    console.log(`✅ Intervalle créé: ${intervalId} (${intervalMs}ms)`);
    return intervalId;
  }

  /**
   * Exécuter un intervalle
   */
  async executeInterval(intervalId) {
    try {
      // Vérifier que l'intervalle existe dans Redis
      const intervalData = await redis.get(`interval:${intervalId}`);
      
      if (!intervalData) {
        console.log(`⏱️  Intervalle ${intervalId} expiré dans Redis, arrêt...`);
        this.clearLocalInterval(intervalId);
        return;
      }
      
      // Vérifier le statut
      if (intervalData.status === 'paused') {
        return;
      }
      
      // Vérifier si déjà exécuté récemment par une autre instance
      const now = Date.now();
      const lastExecuted = intervalData.lastExecuted;
      const executionThreshold = intervalData.intervalMs * 0.8; // 80% de l'intervalle
      
      if (lastExecuted && (now - lastExecuted) < executionThreshold) {
        console.log(`⏱️  Intervalle ${intervalId} déjà exécuté récemment, skip...`);
        return;
      }
      
      // Verrouiller l'exécution pour éviter les doublons
      const lockKey = `lock:interval:${intervalId}`;
      const lockAcquired = await redis.setnx(lockKey, this.instanceId);
      await redis.expire(lockKey, 5); // Lock de 5 secondes
      
      if (!lockAcquired) {
        console.log(`🔒 Intervalle ${intervalId} verrouillé par une autre instance`);
        return;
      }
      
      try {
        // Marquer comme en cours d'exécution
        intervalData.lastExecuted = now;
        intervalData.nextExecution = now + intervalData.intervalMs;
        
        await redis.set(
          `interval:${intervalId}`,
          intervalData,
          this.INTERVAL_TTL
        );
        
        // Récupérer et exécuter le callback local
        const callbackData = this.localCallbacks.get(intervalId);
        if (callbackData) {
          await callbackData.fn(callbackData.data);
          console.log(`✅ Intervalle ${intervalId} exécuté`);
        } else {
          console.warn(`⚠️  Callback non trouvé pour ${intervalId}`);
        }
        
      } finally {
        // Libérer le lock
        await redis.del(lockKey);
      }
      
    } catch (error) {
      console.error(`❌ Erreur exécution intervalle ${intervalId}:`, error);
      // Log l'erreur dans Redis pour monitoring
      await this.logError(intervalId, error);
    }
  }

  /**
   * Mettre en pause un intervalle
   */
  async pauseInterval(intervalId) {
    const intervalData = await redis.get(`interval:${intervalId}`);
    if (intervalData) {
      intervalData.status = 'paused';
      await redis.set(
        `interval:${intervalId}`,
        intervalData,
        this.INTERVAL_TTL
      );
      console.log(`⏸️  Intervalle ${intervalId} mis en pause`);
    }
  }

  /**
   * Reprendre un intervalle
   */
  async resumeInterval(intervalId) {
    const intervalData = await redis.get(`interval:${intervalId}`);
    if (intervalData) {
      intervalData.status = 'active';
      intervalData.lastExecuted = Date.now(); // Réinitialiser le timestamp
      await redis.set(
        `interval:${intervalId}`,
        intervalData,
        this.INTERVAL_TTL
        
      );
      console.log(`▶️  Intervalle ${intervalId} repris`);
    }
  }

  /**
   * Mettre à jour les données d'un intervalle
   */
  async updateIntervalData(intervalId, newData) {
    const callbackData = this.localCallbacks.get(intervalId);
    if (callbackData) {
      callbackData.data = { ...callbackData.data, ...newData };
      this.localCallbacks.set(intervalId, callbackData);
      
      // Mettre à jour dans Redis
      const intervalData = await redis.get(`interval:${intervalId}`);
      if (intervalData) {
        intervalData.dataKey = this.hashData(callbackData.data);
        await redis.set(
          `interval:${intervalId}`,
          intervalData,
          this.INTERVAL_TTL
        );
      }
    }
  }

  /**
   * Supprimer un intervalle
   */
  async clearInterval(intervalId) {
    try {
      // Nettoyer localement
      this.clearLocalInterval(intervalId);
      
      // Récupérer les données pour cleanup
      const intervalData = await redis.get(`interval:${intervalId}`);
      
      if (intervalData) {
        const { key, instanceId } = intervalData;
        
        // Supprimer de Redis
        await redis.del(`interval:${intervalId}`);
        await redis.del(`lock:interval:${intervalId}`);
        
        // Nettoyer les index
        await redis.zrem(`index:intervals:by_key`, intervalId);
        await redis.zrem(`index:intervals:key:${key}`, intervalId);
        await redis.zrem(`index:intervals:instance:${instanceId}`, intervalId);
        
        // Nettoyer les callbacks locaux
        this.localCallbacks.delete(intervalId);
        
        console.log(`🗑️  Intervalle ${intervalId} nettoyé`);
      }
      
    } catch (error) {
      console.error('Erreur nettoyage intervalle:', error);
      await this.logError('clearInterval', error);
    }
  }

  /**
   * Nettoyer tous les intervalles d'une clé
   */
  async clearIntervalsByKey(key) {
    try {
      const intervalIds = await redis.zrange(`index:intervals:key:${key}`, 0, -1);
      
      console.log(`🗑️  Nettoyage de ${intervalIds.length} intervalles pour ${key}`);
      
      for (const intervalId of intervalIds) {
        await this.clearInterval(intervalId);
      }
      
      // Supprimer l'index
      await redis.del(`index:intervals:key:${key}`);
      
      console.log(`✅ Tous les intervalles nettoyés pour ${key}`);
      
    } catch (error) {
      console.error('Erreur nettoyage intervalles par clé:', error);
      await this.logError('clearIntervalsByKey', error);
    }
  }

  /**
   * Nettoyer tous les intervalles de cette instance
   */
  async clearInstanceIntervals() {
    try {
      const intervalIds = await redis.zrange(`index:intervals:instance:${this.instanceId}`, 0, -1);
      
      console.log(`🗑️  Nettoyage de ${intervalIds.length} intervalles d'instance`);
      
      for (const intervalId of intervalIds) {
        await this.clearInterval(intervalId);
      }
      
      // Nettoyer localement aussi
      this.clearAllLocalIntervals();
      this.localCallbacks.clear();
      
      console.log(`✅ Tous les intervalles d'instance nettoyés`);
      
    } catch (error) {
      console.error('Erreur nettoyage intervalles instance:', error);
      await this.logError('clearInstanceIntervals', error);
    }
  }

  /**
   * Nettoyer les intervalles orphelins (exécuté périodiquement)
   */
  async cleanupOrphanedIntervals() {
    try {
      //console.log('🧹 Recherche intervalles orphelins...');
      
      // Récupérer tous les intervalles
      const allIntervalIds = await redis.zrange(`index:intervals:by_key`, 0, -1);
      const orphanedCount = { total: 0, cleaned: 0 };
      
      for (const intervalId of allIntervalIds) {
        try {
          const intervalData = await redis.get(`interval:${intervalId}`);
          
          if (!intervalData) {
            // Données manquantes, nettoyer
            await this.cleanupOrphanedInterval(intervalId);
            orphanedCount.cleaned++;
          } else {
            // Vérifier si l'instance existe encore
            const instanceKey = `instance:heartbeat:${intervalData.instanceId}`;
            const heartbeat = await redis.get(instanceKey);
            
            if (!heartbeat || (Date.now() - parseInt(heartbeat)) > 300000) { // 5 minutes
              // Instance morte, nettoyer l'intervalle
              await this.cleanupOrphanedInterval(intervalId);
              orphanedCount.cleaned++;
            }
          }
          
          orphanedCount.total++;
          
        } catch (error) {
          console.error(`Erreur vérification intervalle ${intervalId}:`, error);
          continue;
        }
      }
      
      //console.log(`✅ Nettoyage orphelins terminé: ${orphanedCount.cleaned}/${orphanedCount.total}`);
      return orphanedCount;
      
    } catch (error) {
      console.error('Erreur nettoyage intervalles orphelins:', error);
      return { total: 0, cleaned: 0, error: error.message };
    }
  }

  /**
   * Nettoyer un intervalle orphelin
   */
  async cleanupOrphanedInterval(intervalId) {
    try {
      // Nettoyer dans Redis
      await redis.del(`interval:${intervalId}`);
      await redis.del(`lock:interval:${intervalId}`);
      await redis.zrem(`index:intervals:by_key`, intervalId);
      
      // Trouver et nettoyer les index spécifiques
      const pattern = `index:intervals:*`;
      const indexKeys = await redis.keys(pattern);
      
      for (const key of indexKeys) {
        await redis.zrem(key, intervalId);
      }
      
      console.log(`🧹 Intervalle orphelin nettoyé: ${intervalId}`);
      
    } catch (error) {
      console.error(`Erreur nettoyage orphelin ${intervalId}:`, error);
    }
  }

  /**
   * Envoyer un heartbeat pour cette instance
   */
  async sendHeartbeat() {
    const heartbeatKey = `instance:heartbeat:${this.instanceId}`;
    await redis.set(heartbeatKey, Date.now(), 600); // 10 minutes TTL
  }

  /**
   * Méthodes utilitaires locales
   */
  clearLocalInterval(intervalId) {
    const localIntervalData = this.localIntervals.get(intervalId);
    if (localIntervalData) {
      clearInterval(localIntervalData.interval);
      this.localIntervals.delete(intervalId);
    }
  }

  clearAllLocalIntervals() {
    for (const [intervalId, localIntervalData] of this.localIntervals.entries()) {
      clearInterval(localIntervalData.interval);
    }
    this.localIntervals.clear();
  }

  hashData(data) {
    // Simple hash pour identifier les données
    return JSON.stringify(data)
      .split('')
      .reduce((acc, char) => acc + char.charCodeAt(0), 0)
      .toString(16);
  }

  async logError(context, error) {
    const errorKey = `errors:${this.instanceId}:${Date.now()}`;
    await redis.set(errorKey, JSON.stringify({
      context,
      error: error.message,
      stack: error.stack,
      timestamp: Date.now()
    }), 3600);
  }

  /**
   * Obtenir les statistiques
   */
  async getStats() {
    try {
      const totalIntervals = await redis.zcard(`index:intervals:by_key`) || 0;
      const instanceIntervals = await redis.zcard(`index:intervals:instance:${this.instanceId}`) || 0;
      
      // Récupérer les intervalles par statut
      const activeIntervals = await this.getIntervalsByStatus('active');
      const pausedIntervals = await this.getIntervalsByStatus('paused');
      
      return {
        instanceId: this.instanceId,
        totalIntervals,
        instanceIntervals,
        localIntervals: this.localIntervals.size,
        localCallbacks: this.localCallbacks.size,
        active: activeIntervals.length,
        paused: pausedIntervals.length,
        timestamp: Date.now()
      };
    } catch (error) {
      console.error('Erreur récupération statistiques:', error);
      return { error: error.message };
    }
  }

  async getIntervalsByStatus(status) {
    const allIntervalIds = await redis.zrange(`index:intervals:by_key`, 0, -1);
    const intervals = [];
    
    for (const intervalId of allIntervalIds) {
      const data = await redis.get(`interval:${intervalId}`);
      if (data && data.status === status) {
        intervals.push({ intervalId, ...data });
      }
    }
    
    return intervals;
  }

  /**
   * Obtenir les intervalles par clé
   */
  async getIntervalsByKey(key) {
    const intervalIds = await redis.zrange(`index:intervals:key:${key}`, 0, -1);
    const intervals = [];
    
    for (const intervalId of intervalIds) {
      const data = await redis.get(`interval:${intervalId}`);
      if (data) {
        intervals.push({ intervalId, ...data });
      }
    }
    
    return intervals;
  }

  /**
   * Initialiser le manager (à appeler au démarrage)
   */
  async initialize() {
    console.log(`🚀 Initialisation RedisIntervalManager - Instance: ${this.instanceId}`);
    
    // 1. Nettoyer les anciens intervalles de cette instance
    await this.clearInstanceIntervals();
    
    // 2. Démarrer le heartbeat
    await this.sendHeartbeat();
    setInterval(() => this.sendHeartbeat(), 30000); // Toutes les 30 secondes
    
    // 3. Démarrer le cleanup périodique
    setInterval(() => this.cleanupOrphanedIntervals(), 5 * 60 * 1000); // Toutes les 5 minutes
    
    console.log(`✅ RedisIntervalManager initialisé`);
  }
}

// Singleton
const instance = new RedisIntervalManager();
module.exports = instance;