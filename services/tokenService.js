const jwt = require('jsonwebtoken');
const { RefreshToken } = require('../models/index.js');
const { Op } = require('sequelize');
//const { v4: uuidv4 } = require('uuid');
//const { v4: uuidv4 } = async () => { await import('uuid') };
require('dotenv').config();

class TokenService {
  // Générer un access token
  generateAccessToken(payload) {
    return jwt.sign(
      payload,
      process.env.JWT_SECRET,
      { 
        expiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '15m',
        issuer: 'uber-cameroun-api',
        subject: payload.uid
      }
    );
  }

  // Générer un refresh token
  generateRefreshToken(payload) {
    //return uuidv4();
	return jwt.sign(
      payload,
      process.env.JWT_REFRESH_SECRET,
      { 
        expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '90d',
        issuer: 'uber-cameroun-api',
        subject: payload.uid
      }
    );
  }

  // Vérifier un access token
  verifyAccessToken(token) {
    try {
      return {
        success: true,
        decoded: jwt.verify(token, process.env.JWT_SECRET)
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Sauvegarder un refresh token en base
  async saveRefreshToken(userId, refreshToken, ipAddress = null, userAgent = null) {
    try {
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7); // 7 jours

      const token = await RefreshToken.create({
        user_id: userId,
        refresh_token: refreshToken,
        expires_at: expiresAt,
        ip_address: ipAddress,
        user_agent: userAgent
      });

      return {
        success: true,
        token
      };
    } catch (error) {
      console.error('❌ Erreur sauvegarde refresh token:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Vérifier et récupérer un refresh token
  async verifyRefreshToken(refreshToken) {
    try {
      const token = await RefreshToken.findOne({
        where: { 
          refresh_token: refreshToken,
          is_revoked: false,
          expires_at: {
            [Op.gt]: new Date()
          }
        },
        include: ['user']
      });

      if (!token) {
        return {
          success: false,
          error: 'Refresh token invalide ou expiré'
        };
      }

      // Mettre à jour la date d'utilisation
      await token.update({ last_used_at: new Date() });

      return {
        success: true,
        token,
        user: token.user
      };
    } catch (error) {
      console.error('❌ Erreur vérification refresh token:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Révoquer un refresh token
  async revokeRefreshToken(refreshToken) {
    try {
      const token = await RefreshToken.findOne({
        where: { refresh_token: refreshToken }
      });

      if (token) {
        await token.update({ is_revoked: true });
      }

      return { success: true };
    } catch (error) {
      console.error('❌ Erreur révocation refresh token:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Révoquer tous les tokens d'un utilisateur
  async revokeAllUserTokens(userId) {
    try {
      await RefreshToken.update(
        { is_revoked: true },
        { where: { user_id: userId } }
      );

      return { success: true };
    } catch (error) {
      console.error('❌ Erreur révocation tokens utilisateur:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Nettoyer les tokens expirés
  async cleanupExpiredTokens() {
    try {
      const result = await RefreshToken.destroy({
        where: {
          expires_at: {
            [Op.lt]: new Date()
          }
        }
      });

      console.log(`🧹 ${result} tokens expirés nettoyés`);
      return { success: true, count: result };
    } catch (error) {
      console.error('❌ Erreur nettoyage tokens expirés:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
}

module.exports = new TokenService();