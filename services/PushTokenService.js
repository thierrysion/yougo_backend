// services/PushTokenService.js
const { PushToken } = require('../models');

class PushTokenService {
  constructor() {
    this.supportedPlatforms = ['ios', 'android', 'web'];
  }

  /**
   * Enregistrement d'un token push pour un utilisateur
   */
  async registerToken(userId, tokenData) {
    try {
      const { token, platform, device_id, app_version } = tokenData;

      if (!this.supportedPlatforms.includes(platform)) {
        throw new Error(`Plateforme non supportée: ${platform}`);
      }

      // Vérifier si le token existe déjà
      const existingToken = await PushToken.findOne({
        where: { token, platform }
      });

      if (existingToken) {
        // Mettre à jour l'utilisateur et les métadonnées
        await PushToken.update(
          {
            user_id: userId,
            device_id,
            app_version,
            last_used_at: new Date(),
            is_active: true
          },
          { where: { id: existingToken.id } }
        );
        return { action: 'updated', token: existingToken };
      }

      // Créer un nouveau token
      const newToken = await PushToken.create({
        user_id: userId,
        token,
        platform,
        device_id,
        app_version,
        is_active: true,
        last_used_at: new Date()
      });

      return { action: 'created', token: newToken };

    } catch (error) {
      console.error('Erreur enregistrement token push:', error);
      throw error;
    }
  }

  /**
   * Révocation d'un token push
   */
  async revokeToken(tokenId, userId) {
    try {
      const token = await PushToken.findOne({
        where: {
          id: tokenId,
          user_id: userId
        }
      });

      if (!token) {
        throw new Error('Token non trouvé');
      }

      await PushToken.update(
        {
          is_active: false,
          revoked_at: new Date()
        },
        { where: { id: tokenId } }
      );

      console.log(`🔒 Token push révoqué: ${tokenId} pour l'utilisateur ${userId}`);
      return true;

    } catch (error) {
      console.error('Erreur révocation token:', error);
      throw error;
    }
  }

  /**
   * Révocation de tous les tokens d'un utilisateur
   */
  async revokeAllUserTokens(userId) {
    try {
      await PushToken.update(
        {
          is_active: false,
          revoked_at: new Date()
        },
        { where: { user_id: userId, is_active: true } }
      );

      console.log(`🔒 Tous les tokens révoqués pour l'utilisateur ${userId}`);
      return true;

    } catch (error) {
      console.error('Erreur révocation tokens utilisateur:', error);
      throw error;
    }
  }

  /**
   * Récupération des tokens actifs d'un utilisateur
   */
  async getUserActiveTokens(userId, platform = null) {
    try {
      const where = {
        user_id: userId,
        is_active: true
      };

      if (platform) {
        where.platform = platform;
      }

      const tokens = await PushToken.findAll({
        where,
        order: [['last_used_at', 'DESC']]
      });

      return tokens;

    } catch (error) {
      console.error('Erreur récupération tokens utilisateur:', error);
      return [];
    }
  }

  /**
   * Nettoyage des tokens expirés/inactifs
   */
  async cleanupExpiredTokens() {
    try {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const result = await PushToken.destroy({
        where: {
          is_active: false,
          revoked_at: {
            [Op.lt]: thirtyDaysAgo
          }
        }
      });

      if (result > 0) {
        console.log(`🧹 ${result} tokens expirés nettoyés`);
      }

      return result;

    } catch (error) {
      console.error('Erreur nettoyage tokens:', error);
      return 0;
    }
  }

  /**
   * Validation de la structure d'un token
   */
  validateTokenStructure(token, platform) {
    const validators = {
      ios: (t) => t.length === 64 && /^[a-fA-F0-9]+$/.test(t),
      android: (t) => t.startsWith('c') || t.startsWith('d') || t.length > 100,
      web: (t) => t.startsWith('https://') || t.length > 100
    };

    const validator = validators[platform];
    if (!validator) {
      throw new Error(`Validateur non disponible pour la plateforme: ${platform}`);
    }

    return validator(token);
  }

  /**
   * Démarrage du nettoyage périodique
   */
  startCleanupInterval() {
    // Nettoyer tous les jours à 2h du matin
    setInterval(() => {
      this.cleanupExpiredTokens();
    }, 24 * 60 * 60 * 1000);
  }
}

module.exports = PushTokenService;