// routes/chat.js
const express = require('express');
const router = express.Router();
const { authenticate, requireRole, requireDriver, requireAdmin, optionalAuth } = require('../middleware/auth');
const { check } = require('express-validator');
const ChatController = require('../controllers/chatController.js');

let chatController;

module.exports = (chatService) => {
  chatController = new ChatController(chatService);

  // GET /api/chat/:rideId/history - Historique des messages
  router.get('/:rideId/history', authenticate, chatController.getChatHistory.bind(chatController));

  // POST /api/chat/:rideId/message - Envoyer un message
  router.post('/:rideId/message', [
    authenticate,
    check('content').notEmpty().isLength({ max: 1000 })
  ], chatController.sendMessage.bind(chatController));

  // POST /api/chat/:rideId/read - Marquer les messages comme lus
  router.post('/:rideId/read', [
    authenticate,
    check('messageIds').isArray()
  ], chatController.markMessagesAsRead.bind(chatController));

  // GET /api/chat/:rideId/stats - Statistiques du chat
  router.get('/:rideId/stats', authenticate, chatController.getChatStats.bind(chatController));

  // DELETE /api/chat/message/:messageId - Supprimer un message (admin)
  router.delete('/message/:messageId', authenticate, chatController.deleteMessage.bind(chatController));

  return router;
};