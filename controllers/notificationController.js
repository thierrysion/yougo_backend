// controllers/notificationController.js
const NotificationService = require('../services/NotificationService');
const PushTokenService = require('../services/PushTokenService');

class NotificationController {
  constructor(notificationService, pushTokenService) {
    this.notificationService = notificationService;
    this.pushTokenService = pushTokenService;
  }

  /**
   * Enregistrement d'un token push
   */
  async registerPushToken(req, res) {
    try {
      const { token, platform, device_id, app_version } = req.body;
      const userId = req.user.uid;

      if (!token || !platform) {
        return res.status(400).json({
          success: false,
          error: 'Token et plateforme requis'
        });
      }

      const result = await this.pushTokenService.registerToken(userId, {
        token, platform, device_id, app_version
      });

      res.json({
        success: true,
        action: result.action,
        token: {
          id: result.token.id,
          platform: result.token.platform,
          created_at: result.token.created_at
        }
      });

    } catch (error) {
      console.error('Erreur enregistrement token:', error);
      res.status(400).json({
        success: false,
        error: error.message
      });
    }
  }

  /**
   * Révocation d'un token push
   */
  async revokePushToken(req, res) {
    try {
      const { tokenId } = req.params;
      const userId = req.user.uid;

      await this.pushTokenService.revokeToken(tokenId, userId);

      res.json({
        success: true,
        message: 'Token révoqué avec succès'
      });

    } catch (error) {
      console.error('Erreur révocation token:', error);
      res.status(400).json({
        success: false,
        error: error.message
      });
    }
  }

  /**
   * Récupération des notifications
   */
  async getNotifications(req, res) {
    try {
      const userId = req.user.uid;
      const { limit = 20, offset = 0, unread_only } = req.query;

      const result = await this.notificationService.getUserNotifications(userId, {
        limit: parseInt(limit),
        offset: parseInt(offset),
        unreadOnly: unread_only === 'true'
      });

      res.json({
        success: true,
        ...result
      });

    } catch (error) {
      console.error('Erreur récupération notifications:', error);
      res.status(500).json({
        success: false,
        error: 'Erreur interne du serveur'
      });
    }
  }

  /**
   * Marquer une notification comme lue
   */
  async markAsRead(req, res) {
    try {
      const { notificationId } = req.params;
      const userId = req.user.uid;

      await this.notificationService.markAsRead(notificationId, userId);

      res.json({
        success: true,
        message: 'Notification marquée comme lue'
      });

    } catch (error) {
      console.error('Erreur marquage notification lue:', error);
      res.status(400).json({
        success: false,
        error: error.message
      });
    }
  }

  /**
   * Marquer toutes les notifications comme lues
   */
  async markAllAsRead(req, res) {
    try {
      const userId = req.user.uid;

      await this.notificationService.markAllAsRead(userId);

      res.json({
        success: true,
        message: 'Toutes les notifications marquées comme lues'
      });

    } catch (error) {
      console.error('Erreur marquage toutes notifications lues:', error);
      res.status(500).json({
        success: false,
        error: 'Erreur interne du serveur'
      });
    }
  }

  /**
   * Supprimer une notification
   */
  async deleteNotification(req, res) {
    try {
      const { notificationId } = req.params;
      const userId = req.user.uid;

      await this.notificationService.deleteNotification(notificationId, userId);

      res.json({
        success: true,
        message: 'Notification supprimée'
      });

    } catch (error) {
      console.error('Erreur suppression notification:', error);
      res.status(400).json({
        success: false,
        error: error.message
      });
    }
  }

  /**
   * Récupération des statistiques de notifications
   */
  async getNotificationStats(req, res) {
    try {
      const userId = req.user.uid;

      const { Notification } = require('../models');
      
      const total = await Notification.count({ where: { user_id: userId } });
      const unread = await Notification.count({ 
        where: { user_id: userId, is_read: false } 
      });
      const today = await Notification.count({
        where: {
          user_id: userId,
          created_at: {
            [Op.gte]: new Date(new Date().setHours(0, 0, 0, 0))
          }
        }
      });

      res.json({
        success: true,
        stats: {
          total,
          unread,
          today,
          read: total - unread
        }
      });

    } catch (error) {
      console.error('Erreur statistiques notifications:', error);
      res.status(500).json({
        success: false,
        error: 'Erreur interne du serveur'
      });
    }
  }

  /**
   * Test d'envoi de notification
   */
  async testNotification(req, res) {
    try {
      const userId = req.user.uid;
      const { type = 'system', title, body } = req.body;

      const notification = await this.notificationService.sendNotification(
        userId,
        type,
        {
          title: title || 'Notification de test',
          body: body || 'Ceci est une notification de test',
          test: true
        }
      );

      res.json({
        success: true,
        notification: {
          id: notification.id,
          title: notification.title,
          body: notification.body,
          type: notification.type
        },
        message: 'Notification de test envoyée'
      });

    } catch (error) {
      console.error('Erreur notification test:', error);
      res.status(400).json({
        success: false,
        error: error.message
      });
    }
  }
}

module.exports = NotificationController;