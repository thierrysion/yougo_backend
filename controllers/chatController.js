// controllers/chatController.js
const { ChatMessage, Ride } = require('../models');

class ChatController {
  constructor(chatService) {
    this.chatService = chatService;
  }

  /**
   * Récupération de l'historique des messages
   */
  async getChatHistory(req, res) {
    try {
      const { rideId } = req.params;
      const userId = req.user.uid;
      const { limit = 50, offset = 0 } = req.query;

      // Validation de l'accès
      const hasAccess = await this.validateChatAccess(rideId, userId);
      if (!hasAccess) {
        return res.status(403).json({
          success: false,
          error: 'Accès non autorisé à ce chat'
        });
      }

      const messages = await this.chatService.getChatHistory(rideId, {
        limit: parseInt(limit),
        offset: parseInt(offset)
      });

      const stats = await this.chatService.getChatStats(rideId);

      res.json({
        success: true,
        rideId,
        messages,
        stats,
        pagination: {
          limit: parseInt(limit),
          offset: parseInt(offset),
          total: stats.totalMessages
        }
      });

    } catch (error) {
      console.error('Erreur récupération historique chat:', error);
      res.status(500).json({
        success: false,
        error: 'Erreur interne du serveur'
      });
    }
  }

  /**
   * Envoi d'un message (API REST alternative)
   */
  async sendMessage(req, res) {
    try {
      const { rideId } = req.params;
      const { content, messageType = 'text', mediaUrl } = req.body;
      const userId = req.user.uid;

      if (!content) {
        return res.status(400).json({
          success: false,
          error: 'Contenu du message requis'
        });
      }

      // Validation de l'accès
      const hasAccess = await this.validateChatAccess(rideId, userId);
      if (!hasAccess) {
        return res.status(403).json({
          success: false,
          error: 'Accès non autorisé à ce chat'
        });
      }

      // Créer le message
      const message = await this.chatService.createMessage({
        rideId,
        senderId: userId,
        content,
        messageType,
        mediaUrl
      });

      const messageData = await this.chatService.enrichMessageData(message);

      // Diffuser le message via Socket.IO
      const roomName = `ride_${rideId}`;
      this.chatService.io.to(roomName).emit('new_message', messageData);

      // Notifier les participants hors ligne
      await this.chatService.notifyOfflineParticipants(rideId, userId, messageData);

      res.json({
        success: true,
        message: messageData
      });

    } catch (error) {
      console.error('Erreur envoi message API:', error);
      res.status(500).json({
        success: false,
        error: 'Erreur lors de l\'envoi du message'
      });
    }
  }

  /**
   * Marquer les messages comme lus
   */
  async markMessagesAsRead(req, res) {
    try {
      const { rideId } = req.params;
      const { messageIds } = req.body;
      const userId = req.user.uid;

      if (!messageIds || !Array.isArray(messageIds)) {
        return res.status(400).json({
          success: false,
          error: 'Liste des IDs de messages requis'
        });
      }

      // Validation de l'accès
      const hasAccess = await this.validateChatAccess(rideId, userId);
      if (!hasAccess) {
        return res.status(403).json({
          success: false,
          error: 'Accès non autorisé à ce chat'
        });
      }

      await this.chatService.markMessagesAsRead(messageIds, userId);

      res.json({
        success: true,
        message: `${messageIds.length} messages marqués comme lus`
      });

    } catch (error) {
      console.error('Erreur marquage messages lus:', error);
      res.status(500).json({
        success: false,
        error: 'Erreur lors du marquage des messages'
      });
    }
  }

  /**
   * Récupération des statistiques de chat
   */
  async getChatStats(req, res) {
    try {
      const { rideId } = req.params;
      const userId = req.user.uid;

      // Validation de l'accès
      const hasAccess = await this.validateChatAccess(rideId, userId);
      if (!hasAccess) {
        return res.status(403).json({
          success: false,
          error: 'Accès non autorisé à ce chat'
        });
      }

      const stats = await this.chatService.getChatStats(rideId);

      res.json({
        success: true,
        rideId,
        stats
      });

    } catch (error) {
      console.error('Erreur statistiques chat:', error);
      res.status(500).json({
        success: false,
        error: 'Erreur interne du serveur'
      });
    }
  }

  /**
   * Validation de l'accès au chat
   */
  async validateChatAccess(rideId, userId) {
    try {
      const ride = await Ride.findOne({
        where: { id: rideId },
        attributes: ['id', 'customer_id', 'driver_id']
      });

      if (!ride) {
        return false;
      }

      const isCustomer = ride.customer_id === userId;
      const isDriver = ride.driver_id === userId;

      return isCustomer || isDriver;

    } catch (error) {
      console.error('Erreur validation accès chat:', error);
      return false;
    }
  }

  /**
   * Suppression d'un message (modérateur/admin)
   */
  async deleteMessage(req, res) {
    try {
      const { messageId } = req.params;
      const userId = req.user.uid;
      const userRole = req.user.role;

      // Seuls les admins et modérateurs peuvent supprimer les messages
      if (userRole !== 'admin') {
        return res.status(403).json({
          success: false,
          error: 'Autorisation insuffisante'
        });
      }

      const message = await ChatMessage.findByPk(messageId);
      if (!message) {
        return res.status(404).json({
          success: false,
          error: 'Message non trouvé'
        });
      }

      await ChatMessage.destroy({
        where: { id: messageId }
      });

      // Notifier les participants de la suppression
      const roomName = `ride_${message.ride_id}`;
      this.chatService.io.to(roomName).emit('message_deleted', {
        messageId,
        deletedBy: userId,
        timestamp: new Date().toISOString()
      });

      res.json({
        success: true,
        message: 'Message supprimé'
      });

    } catch (error) {
      console.error('Erreur suppression message:', error);
      res.status(500).json({
        success: false,
        error: 'Erreur lors de la suppression du message'
      });
    }
  }
}

module.exports = ChatController;