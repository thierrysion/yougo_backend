// services/ChatService.js
const { ChatMessage, Ride, User, Driver } = require('../models');
const { Op } = require('sequelize');

class DriverService {
  constructor(io) {
    this.io = io;
    this.activeChats = new Map(); // rideId -> { participants, messages }
    this.setupSocketHandlers();
  }

  setupSocketHandlers() {
    this.io.on('connection', (socket) => {
      console.log(`💬 Nouvelle connexion chat: ${socket.id}`);

      // Rejoindre une room de chat pour une course
      socket.on('join_ride_chat', async (data) => {
        await this.handleJoinRideChat(socket, data);
      });

      // Envoyer un message
      socket.on('send_message', async (data) => {
        await this.handleSendMessage(socket, data);
      });

      // Marquer les messages comme lus
      socket.on('mark_messages_read', async (data) => {
        await this.handleMarkMessagesRead(socket, data);
      });

      // Typing indicator
      socket.on('typing_start', async (data) => {
        await this.handleTypingStart(socket, data);
      });

      socket.on('typing_stop', async (data) => {
        await this.handleTypingStop(socket, data);
      });

      // Déconnexion
      socket.on('disconnect', () => {
        this.handleDisconnect(socket);
      });
    });
  }

  /**
   * Gestion de la connexion au chat d'une course
   */
  async handleJoinRideChat(socket, data) {
    try {
      const { rideId, userId } = data;

      if (!rideId || !userId) {
        socket.emit('error', { message: 'Ride ID et User ID requis' });
        return;
      }

      // Vérifier que l'utilisateur a accès à cette course
      const hasAccess = await this.validateChatAccess(rideId, userId);
      if (!hasAccess) {
        socket.emit('error', { message: 'Accès non autorisé à ce chat' });
        return;
      }

      // Rejoindre la room Socket.IO
      const roomName = `ride_${rideId}`;
      socket.join(roomName);

      // Initialiser ou récupérer l'état du chat
      if (!this.activeChats.has(rideId)) {
        await this.initializeChat(rideId);
      }

      // Ajouter l'utilisateur aux participants actifs
      const chat = this.activeChats.get(rideId);
      chat.participants.set(userId, {
        socketId: socket.id,
        joinedAt: new Date(),
        isTyping: false
      });

      // Envoyer l'historique des messages
      const messages = await this.getChatHistory(rideId);
      socket.emit('chat_history', {
        rideId,
        messages,
        total: messages.length
      });

      console.log(`👤 Utilisateur ${userId} a rejoint le chat de la course ${rideId}`);

      // Notifier les autres participants
      socket.to(roomName).emit('user_joined_chat', {
        userId,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('Erreur connexion chat:', error);
      socket.emit('error', { message: 'Erreur de connexion au chat' });
    }
  }

  /**
   * Gestion de l'envoi de message
   */
  async handleSendMessage(socket, data) {
    try {
      const { rideId, userId, content, messageType = 'text' } = data;

      if (!rideId || !userId || !content) {
        socket.emit('error', { message: 'Données manquantes' });
        return;
      }

      // Validation du type de message
      const allowedTypes = ['text', 'image', 'location', 'system'];
      if (!allowedTypes.includes(messageType)) {
        socket.emit('error', { message: 'Type de message non supporté' });
        return;
      }

      // Validation de l'accès
      const hasAccess = await this.validateChatAccess(rideId, userId);
      if (!hasAccess) {
        socket.emit('error', { message: 'Accès non autorisé' });
        return;
      }

      // Créer le message en base de données
      const message = await this.createMessage({
        rideId,
        senderId: userId,
        content,
        messageType
      });

      // Préparer le message pour l'envoi
      const messageData = await this.enrichMessageData(message);

      // Envoyer à tous les participants de la room
      const roomName = `ride_${rideId}`;
      this.io.to(roomName).emit('new_message', messageData);

      console.log(`💌 Message envoyé dans le chat ${rideId} par ${userId}`);

      // Notifications push pour les utilisateurs non connectés
      await this.notifyOfflineParticipants(rideId, userId, messageData);

    } catch (error) {
      console.error('Erreur envoi message:', error);
      socket.emit('error', { message: 'Erreur lors de l\'envoi du message' });
    }
  }

  /**
   * Création d'un message en base de données
   */
  async createMessage(messageData) {
    try {
      const { rideId, senderId, content, messageType, mediaUrl } = messageData;

      const message = await ChatMessage.create({
        ride_id: rideId,
        sender_id: senderId,
        message_type: messageType,
        content: content,
        media_url: mediaUrl,
        is_read: false,
        created_at: new Date()
      });

      // Récupérer le message avec les informations de l'expéditeur
      const enrichedMessage = await ChatMessage.findByPk(message.id, {
        include: [
          {
            model: User,
            as: 'sender',
            attributes: ['uid', 'first_name', 'last_name', 'profile_picture_url', 'role']
          }
        ]
      });

      return enrichedMessage;

    } catch (error) {
      console.error('Erreur création message:', error);
      throw error;
    }
  }

  /**
   * Enrichissement des données du message
   */
  async enrichMessageData(message) {
    const senderInfo = {
      id: message.sender.uid,
      firstName: message.sender.first_name,
      lastName: message.sender.last_name,
      profilePicture: message.sender.profile_picture_url,
      role: message.sender.role
    };

    return {
      id: message.id,
      rideId: message.ride_id,
      sender: senderInfo,
      content: message.content,
      messageType: message.message_type,
      mediaUrl: message.media_url,
      isRead: message.is_read,
      createdAt: message.created_at,
      timestamp: message.created_at
    };
  }

  /**
   * Gestion de l'indicateur de frappe
   */
  async handleTypingStart(socket, data) {
    try {
      const { rideId, userId } = data;

      const roomName = `ride_${rideId}`;
      const chat = this.activeChats.get(rideId);

      if (chat && chat.participants.has(userId)) {
        chat.participants.get(userId).isTyping = true;

        // Notifier les autres participants
        socket.to(roomName).emit('user_typing', {
          userId,
          isTyping: true
        });
      }

    } catch (error) {
      console.error('Erreur typing start:', error);
    }
  }

  async handleTypingStop(socket, data) {
    try {
      const { rideId, userId } = data;

      const roomName = `ride_${rideId}`;
      const chat = this.activeChats.get(rideId);

      if (chat && chat.participants.has(userId)) {
        chat.participants.get(userId).isTyping = false;

        // Notifier les autres participants
        socket.to(roomName).emit('user_typing', {
          userId,
          isTyping: false
        });
      }

    } catch (error) {
      console.error('Erreur typing stop:', error);
    }
  }

  /**
   * Marquer les messages comme lus
   */
  async handleMarkMessagesRead(socket, data) {
    try {
      const { rideId, userId, messageIds } = data;

      if (!rideId || !userId) {
        socket.emit('error', { message: 'Données manquantes' });
        return;
      }

      // Vérifier l'accès
      const hasAccess = await this.validateChatAccess(rideId, userId);
      if (!hasAccess) return;

      // Marquer les messages comme lus
      await this.markMessagesAsRead(messageIds, userId);

      // Notifier les autres participants
      const roomName = `ride_${rideId}`;
      socket.to(roomName).emit('messages_read', {
        userId,
        messageIds,
        readAt: new Date().toISOString()
      });

      console.log(`👀 Messages marqués comme lus par ${userId}: ${messageIds.length} messages`);

    } catch (error) {
      console.error('Erreur marquage messages lus:', error);
      socket.emit('error', { message: 'Erreur lors du marquage des messages' });
    }
  }

  /**
   * Récupération de l'historique des messages
   */
  async getChatHistory(rideId, options = {}) {
    try {
      const { limit = 50, offset = 0 } = options;

      const messages = await ChatMessage.findAll({
        where: { ride_id: rideId },
        include: [
          {
            model: User,
            as: 'sender',
            attributes: ['uid', 'first_name', 'last_name', 'profile_picture_url', 'role']
          }
        ],
        order: [['created_at', 'ASC']],
        limit,
        offset
      });

      // Enrichir les données des messages
      const enrichedMessages = messages.map(message => ({
        id: message.id,
        rideId: message.ride_id,
        sender: {
          id: message.sender.uid,
          firstName: message.sender.first_name,
          lastName: message.sender.last_name,
          profilePicture: message.sender.profile_picture_url,
          role: message.sender.role
        },
        content: message.content,
        messageType: message.message_type,
        mediaUrl: message.media_url,
        isRead: message.is_read,
        readAt: message.read_at,
        createdAt: message.created_at,
        timestamp: message.created_at
      }));

      return enrichedMessages;

    } catch (error) {
      console.error('Erreur récupération historique:', error);
      return [];
    }
  }

  /**
   * Validation de l'accès au chat
   */
  async validateChatAccess(rideId, userId) {
    try {
      const ride = await Ride.findOne({
        where: { id: rideId },
        include: [
          {
            model: User,
            as: 'customer',
            attributes: ['uid']
          },
          {
            model: Driver,
            include: [{ model: User, as: 'user', attributes: ['uid'] }]
          }
        ]
      });

      if (!ride) {
        throw new Error('Course non trouvée');
      }

      // Vérifier si l'utilisateur est le client ou le chauffeur
      const isCustomer = ride.customer_id === userId;
      const isDriver = ride.Driver && ride.Driver.user_id === userId;

      if (!isCustomer && !isDriver) {
        throw new Error('Accès non autorisé au chat de cette course');
      }

      return true;

    } catch (error) {
      console.error('Erreur validation accès chat:', error);
      return false;
    }
  }

  /**
   * Initialisation d'un chat
   */
  async initializeChat(rideId) {
    this.activeChats.set(rideId, {
      rideId,
      participants: new Map(),
      createdAt: new Date(),
      lastActivity: new Date()
    });

    console.log(`💬 Chat initialisé pour la course ${rideId}`);
  }

  /**
   * Marquer les messages comme lus
   */
  async markMessagesAsRead(messageIds, userId) {
    try {
      if (!messageIds || messageIds.length === 0) return;

      await ChatMessage.update(
        {
          is_read: true,
          read_at: new Date()
        },
        {
          where: {
            id: { [Op.in]: messageIds },
            sender_id: { [Op.ne]: userId } // Ne pas marquer ses propres messages
          }
        }
      );

    } catch (error) {
      console.error('Erreur marquage messages lus:', error);
      throw error;
    }
  }

  /**
   * Notification des participants hors ligne
   */
  async notifyOfflineParticipants(rideId, senderId, messageData) {
    try {
      const ride = await Ride.findByPk(rideId, {
        include: [
          {
            model: User,
            as: 'customer',
            attributes: ['uid']
          },
          {
            model: Driver,
            include: [{ model: User, as: 'user', attributes: ['uid'] }]
          }
        ]
      });

      if (!ride) return;

      // Identifier le destinataire
      let recipientId;
      if (senderId === ride.customer_id) {
        recipientId = ride.Driver?.user_id;
      } else {
        recipientId = ride.customer_id;
      }

      if (!recipientId) return;

      // Vérifier si le destinataire est en ligne
      const chat = this.activeChats.get(rideId);
      const isRecipientOnline = chat && chat.participants.has(recipientId);

      if (!isRecipientOnline) {
        // Envoyer une notification push
        await this.sendChatNotification(recipientId, rideId, messageData);
      }

    } catch (error) {
      console.error('Erreur notification participants offline:', error);
    }
  }

  /**
   * Envoi de notification push pour nouveau message
   */
  async sendChatNotification(recipientId, rideId, messageData) {
    try {
      const NotificationService = require('./NotificationService');
      const notificationService = new NotificationService(this.io);

      await notificationService.sendNotification(
        recipientId,
        'chat_message',
        {
          rideId,
          senderName: `${messageData.sender.firstName} ${messageData.sender.lastName}`,
          message: messageData.content,
          messageType: messageData.messageType
        }
      );

    } catch (error) {
      console.error('Erreur envoi notification chat:', error);
    }
  }

  /**
   * Gestion de la déconnexion
   */
  handleDisconnect(socket) {
    // Retirer l'utilisateur de tous les chats actifs
    for (const [rideId, chat] of this.activeChats.entries()) {
      for (const [userId, participant] of chat.participants.entries()) {
        if (participant.socketId === socket.id) {
          chat.participants.delete(userId);

          // Notifier les autres participants
          this.io.to(`ride_${rideId}`).emit('user_left_chat', {
            userId,
            timestamp: new Date().toISOString()
          });

          console.log(`👤 Utilisateur ${userId} a quitté le chat de la course ${rideId}`);
          break;
        }
      }

      // Nettoyer les chats vides
      if (chat.participants.size === 0) {
        this.activeChats.delete(rideId);
        console.log(`💬 Chat fermé pour la course ${rideId} (plus de participants)`);
      }
    }
  }

  /**
   * Envoi de message système
   */
  async sendSystemMessage(rideId, content) {
    try {
      const message = await this.createMessage({
        rideId,
        senderId: 'system',
        content,
        messageType: 'system'
      });

      const messageData = await this.enrichMessageData(message);

      // Envoyer à tous les participants
      const roomName = `ride_${rideId}`;
      this.io.to(roomName).emit('new_message', messageData);

      return messageData;

    } catch (error) {
      console.error('Erreur envoi message système:', error);
      throw error;
    }
  }

  /**
   * Récupération des statistiques de chat
   */
  async getChatStats(rideId) {
    try {
      const totalMessages = await ChatMessage.count({
        where: { ride_id: rideId }
      });

      const unreadMessages = await ChatMessage.count({
        where: { 
          ride_id: rideId,
          is_read: false
        }
      });

      const lastMessage = await ChatMessage.findOne({
        where: { ride_id: rideId },
        order: [['created_at', 'DESC']],
        include: [
          {
            model: User,
            as: 'sender',
            attributes: ['uid', 'first_name', 'last_name']
          }
        ]
      });

      return {
        totalMessages,
        unreadMessages,
        lastMessage: lastMessage ? {
          content: lastMessage.content,
          sender: lastMessage.sender.first_name,
          timestamp: lastMessage.created_at
        } : null
      };

    } catch (error) {
      console.error('Erreur statistiques chat:', error);
      return null;
    }
  }

  /**
   * Nettoyage des vieux messages
   */
  async cleanupOldMessages(retentionDays = 30) {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

      const result = await ChatMessage.destroy({
        where: {
          created_at: {
            [Op.lt]: cutoffDate
          }
        }
      });

      if (result > 0) {
        console.log(`🧹 ${result} vieux messages de chat nettoyés`);
      }

      return result;

    } catch (error) {
      console.error('Erreur nettoyage messages:', error);
      return 0;
    }
  }

  /**
   * Démarrage du nettoyage périodique
   */
  startCleanupInterval() {
    // Nettoyer tous les jours à 3h du matin
    setInterval(() => {
      this.cleanupOldMessages(30); // Garder 30 jours d'historique
    }, 24 * 60 * 60 * 1000);
  }
}

module.exports = ChatService;