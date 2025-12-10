// routes/notifications.js
const express = require('express');
const router = express.Router();
const { authenticate, requireRole, requireDriver, requireAdmin, optionalAuth } = require('../middleware/auth');
const { check } = require('express-validator');
const NotificationController = require('../controllers/NotificationController.js');

let notificationController;

module.exports = (notificationService, pushTokenService) => {
  notificationController = new NotificationController(
    notificationService, 
    pushTokenService
  );

  // POST /api/notifications/tokens - Enregistrer token push
  router.post('/tokens', [
    authenticate,
    check('token').notEmpty(),
    check('platform').isIn(['ios', 'android', 'web'])
  ], notificationController.registerPushToken.bind(notificationController));

  // DELETE /api/notifications/tokens/:tokenId - Révoquer token
  router.delete('/tokens/:tokenId', authenticate, 
    notificationController.revokePushToken.bind(notificationController));

  // GET /api/notifications - Récupérer les notifications
  router.get('/', authenticate, notificationController.getNotifications.bind(notificationController));

  // POST /api/notifications/:notificationId/read - Marquer comme lue
  router.post('/:notificationId/read', authenticate, 
    notificationController.markAsRead.bind(notificationController));

  // POST /api/notifications/read-all - Tout marquer comme lu
  router.post('/read-all', authenticate, 
    notificationController.markAllAsRead.bind(notificationController));

  // DELETE /api/notifications/:notificationId - Supprimer notification
  router.delete('/:notificationId', authenticate, 
    notificationController.deleteNotification.bind(notificationController));

  // GET /api/notifications/stats - Statistiques
  router.get('/stats', authenticate, 
    notificationController.getNotificationStats.bind(notificationController));

  // POST /api/notifications/test - Notification de test
  router.post('/test', authenticate, 
    notificationController.testNotification.bind(notificationController));

  return router;
};