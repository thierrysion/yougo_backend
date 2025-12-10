// services/NotificationService.js
const { Notification, User, PushToken } = require('../models');
const FCM = require('fcm-node');
const Expo = require('expo-server-sdk');
const webpush = require('web-push');

class NotificationService {
  constructor(io) {
    this.io = io;
    
    // Initialisation des services de push
    this.fcm = process.env.FCM_SERVER_KEY ? new FCM(process.env.FCM_SERVER_KEY) : null;
    this.expo = new Expo.Expo();
    this.webpush = webpush;
    
    // Configuration web-push (VAPID)
    /*if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
      this.webpush.setVapidDetails(
        'mailto:notifications@yourapp.com',
        process.env.VAPID_PUBLIC_KEY,
        process.env.VAPID_PRIVATE_KEY
      );
    }*/

    this.templates = this.getNotificationTemplates();
  }

  /**
   * Templates de notifications
   */
  getNotificationTemplates() {
    return {
      ride_request: {
        title: 'Nouvelle course disponible 🚗',
        body: 'Une nouvelle course vous attend. Acceptez-la rapidement !',
        priority: 'high',
        data: { sound: 'default', badge: 1 }
      },
      ride_accepted: {
        title: 'Course acceptée ✅',
        body: 'Votre course a été acceptée par un chauffeur',
        priority: 'normal',
        data: { sound: 'default' }
      },
      ride_cancelled: {
        title: 'Course annulée ❌',
        body: 'La course a été annulée',
        priority: 'normal',
        data: { sound: 'default' }
      },
      driver_en_route: {
        title: 'Chauffeur en chemin 🚘',
        body: 'Votre chauffeur est en route vers vous',
        priority: 'normal',
        data: { sound: 'default' }
      },
      driver_arrived: {
        title: 'Chauffeur arrivé 🎯',
        body: 'Votre chauffeur vous attend',
        priority: 'high',
        data: { sound: 'default' }
      },
      ride_completed: {
        title: 'Course terminée 🏁',
        body: 'Merci d\'avoir utilisé nos services',
        priority: 'normal',
        data: { sound: 'default' }
      },
      payment_success: {
        title: 'Paiement confirmé 💳',
        body: 'Votre paiement a été traité avec succès',
        priority: 'normal',
        data: { sound: 'default' }
      },
      chat_message: {
        title: 'Nouveau message 💬',
        body: 'Vous avez reçu un nouveau message',
        priority: 'normal',
        data: { sound: 'default' }
      },
      rating_reminder: {
        title: 'Évaluez votre course ⭐',
        body: 'Comment s\'est passée votre course ?',
        priority: 'low',
        data: { sound: 'default' }
      }
    };
  }

  /**
   * Envoi d'une notification
   */
  async sendNotification(userId, type, customData = {}) {
    try {
      const template = this.templates[type];
      if (!template) {
        throw new Error(`Template de notification non trouvé: ${type}`);
      }

      // Préparer la notification
      const notificationData = {
        ...template,
        data: {
          ...template.data,
          ...customData,
          type: type,
          timestamp: new Date().toISOString()
        }
      };

      // Créer l'entrée en base
      const notification = await Notification.create({
        user_id: userId,
        title: this.interpolateText(notificationData.title, customData),
        body: this.interpolateText(notificationData.body, customData),
        type: type,
        data: notificationData.data,
        priority: notificationData.priority,
        delivery_methods: ['push', 'in_app'],
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 jours
      });

      // Envoyer via les différents canaux
      const results = await Promise.allSettled([
        this.sendPushNotification(userId, notification),
        this.sendInAppNotification(userId, notification),
        this.sendEmailNotification(userId, notification) // Optionnel
      ]);

      // Mettre à jour le statut d'envoi
      const sentSuccessfully = results.some(result => 
        result.status === 'fulfilled' && result.value
      );

      if (sentSuccessfully) {
        await Notification.update(
          { is_sent: true, sent_at: new Date() },
          { where: { id: notification.id } }
        );
      }

      console.log(`📢 Notification envoyée: ${type} à l'utilisateur ${userId}`);
      return notification;

    } catch (error) {
      console.error('Erreur envoi notification:', error);
      throw error;
    }
  }

  /**
   * Envoi de notification push
   */
  async sendPushNotification(userId, notification) {
    try {
      const tokens = await PushToken.findAll({
        where: { user_id: userId, is_active: true }
      });

      if (tokens.length === 0) {
        return false;
      }

      const promises = tokens.map(token => 
        this.sendToPushProvider(token, notification)
      );

      const results = await Promise.allSettled(promises);
      const successful = results.filter(r => r.status === 'fulfilled').length;

      console.log(`📱 Push notifications: ${successful}/${tokens.length} envoyés à ${userId}`);
      return successful > 0;

    } catch (error) {
      console.error('Erreur envoi push notification:', error);
      return false;
    }
  }

  /**
   * Envoi au fournisseur push selon la plateforme
   */
  async sendToPushProvider(pushToken, notification) {
    const { token, platform } = pushToken;

    try {
      switch (platform) {
        case 'ios':
          return await this.sendToAPNS(token, notification);
        case 'android':
          return await this.sendToFCM(token, notification);
        case 'web':
          return await this.sendToWebPush(token, notification);
        default:
          console.warn(`Plateforme non supportée: ${platform}`);
          return false;
      }
    } catch (error) {
      console.error(`Erreur envoi ${platform} push:`, error);
      
      // Désactiver le token en cas d'erreur permanente
      if (this.isPermanentError(error)) {
        await PushToken.update(
          { is_active: false, last_error: error.message },
          { where: { id: pushToken.id } }
        );
      }
      
      return false;
    }
  }

  /**
   * Envoi via FCM (Android)
   */
  async sendToFCM(token, notification) {
    if (!this.fcm) {
      console.warn('FCM non configuré');
      return false;
    }

    const message = {
      to: token,
      notification: {
        title: notification.title,
        body: notification.body,
        sound: 'default',
        badge: notification.data.badge || 1
      },
      data: notification.data,
      priority: notification.priority === 'high' ? 'high' : 'normal'
    };

    return new Promise((resolve, reject) => {
      this.fcm.send(message, (err, response) => {
        if (err) {
          reject(err);
        } else {
          console.log(`✅ FCM notification sent: ${response}`);
          resolve(true);
        }
      });
    });
  }

  /**
   * Envoi via APNS (iOS)
   */
  async sendToAPNS(token, notification) {
    // Pour Expo (React Native)
    if (Expo.isExpoPushToken(token)) {
      const messages = [{
        to: token,
        sound: 'default',
        title: notification.title,
        body: notification.body,
        data: notification.data,
        badge: notification.data.badge || 1
      }];

      const chunks = this.expo.chunkPushNotifications(messages);
      
      for (const chunk of chunks) {
        try {
          const receipts = await this.expo.sendPushNotificationsAsync(chunk);
          console.log(`✅ Expo notifications sent:`, receipts);
        } catch (error) {
          console.error('Erreur envoi Expo:', error);
          throw error;
        }
      }
      
      return true;
    }

    // Implémentation native APNS irait ici
    console.warn('APNS natif non implémenté');
    return false;
  }

  /**
   * Envoi via Web Push
   */
  async sendToWebPush(token, notification) {
    try {
      const subscription = JSON.parse(token);
      
      const payload = JSON.stringify({
        title: notification.title,
        body: notification.body,
        icon: '/icon-192x192.png',
        badge: '/badge-72x72.png',
        data: notification.data,
        actions: [
          {
            action: 'view',
            title: 'Voir'
          }
        ]
      });

      await this.webpush.sendNotification(subscription, payload);
      console.log(`✅ Web push notification sent`);
      return true;

    } catch (error) {
      console.error('Erreur envoi web push:', error);
      
      // Si l'abonnement n'est plus valide
      if (error.statusCode === 410) {
        await PushToken.update(
          { is_active: false },
          { where: { token: token } }
        );
      }
      
      throw error;
    }
  }

  /**
   * Notification in-app via Socket.IO
   */
  async sendInAppNotification(userId, notification) {
    try {
      // Émettre via Socket.IO
      this.io.to(`user_${userId}`).emit('notification', {
        id: notification.id,
        title: notification.title,
        body: notification.body,
        type: notification.type,
        data: notification.data,
        created_at: notification.created_at,
        is_read: notification.is_read
      });

      console.log(`💬 Notification in-app envoyée à ${userId}`);
      return true;

    } catch (error) {
      console.error('Erreur notification in-app:', error);
      return false;
    }
  }

  /**
   * Notification email (optionnelle)
   */
  async sendEmailNotification(userId, notification) {
    // Implémentation basique - à intégrer avec un service d'email
    console.log(`📧 Email notification would be sent to ${userId}`);
    return true;
  }

  /**
   * Marquer une notification comme lue
   */
  async markAsRead(notificationId, userId) {
    try {
      const notification = await Notification.findOne({
        where: { id: notificationId, user_id: userId }
      });

      if (!notification) {
        throw new Error('Notification non trouvée');
      }

      await Notification.update(
        {
          is_read: true,
          read_at: new Date()
        },
        { where: { id: notificationId } }
      );

      // Notifier le frontend de la mise à jour
      this.io.to(`user_${userId}`).emit('notification_read', {
        notificationId,
        read_at: new Date().toISOString()
      });

      return true;

    } catch (error) {
      console.error('Erreur marquage notification lue:', error);
      throw error;
    }
  }

  /**
   * Marquer toutes les notifications comme lues
   */
  async markAllAsRead(userId) {
    try {
      await Notification.update(
        {
          is_read: true,
          read_at: new Date()
        },
        {
          where: {
            user_id: userId,
            is_read: false
          }
        }
      );

      this.io.to(`user_${userId}`).emit('all_notifications_read');

      return true;

    } catch (error) {
      console.error('Erreur marquage toutes notifications lues:', error);
      throw error;
    }
  }

  /**
   * Récupération des notifications d'un utilisateur
   */
  async getUserNotifications(userId, options = {}) {
    try {
      const { limit = 20, offset = 0, unreadOnly = false } = options;

      const where = { user_id: userId };
      if (unreadOnly) {
        where.is_read = false;
      }

      const notifications = await Notification.findAll({
        where,
        order: [['created_at', 'DESC']],
        limit,
        offset,
        attributes: [
          'id', 'title', 'body', 'type', 'data', 
          'is_read', 'created_at', 'read_at'
        ]
      });

      const total = await Notification.count({ where });
      const unreadCount = await Notification.count({
        where: { ...where, is_read: false }
      });

      return {
        notifications,
        pagination: {
          total,
          unreadCount,
          hasMore: total > offset + limit
        }
      };

    } catch (error) {
      console.error('Erreur récupération notifications:', error);
      throw error;
    }
  }

  /**
   * Suppression d'une notification
   */
  async deleteNotification(notificationId, userId) {
    try {
      const result = await Notification.destroy({
        where: { id: notificationId, user_id: userId }
      });

      if (result === 0) {
        throw new Error('Notification non trouvée');
      }

      return true;

    } catch (error) {
      console.error('Erreur suppression notification:', error);
      throw error;
    }
  }

  /**
   * Interpolation de texte avec les données
   */
  interpolateText(text, data) {
    return text.replace(/\{(\w+)\}/g, (match, key) => {
      return data[key] !== undefined ? data[key] : match;
    });
  }

  /**
   * Détection d'erreurs permanentes
   */
  isPermanentError(error) {
    const permanentErrors = [
      'NotRegistered',
      'InvalidRegistration',
      'MismatchSenderId',
      'DeviceMessageRateExceeded'
    ];

    return permanentErrors.some(permanentError => 
      error.message?.includes(permanentError) || 
      error.toString().includes(permanentError)
    );
  }

  /**
   * Notifications pour les événements de course
   */
  async notifyRideEvent(rideId, eventType, additionalData = {}) {
    try {
      const ride = await this.getRideDetails(rideId);
      if (!ride) return;

      const notifications = [];

      switch (eventType) {
        case 'ride_requested':
          // Notifier les chauffeurs disponibles
          const drivers = await this.findAvailableDrivers(ride);
          for (const driver of drivers) {
            const notification = await this.sendNotification(
              driver.user_id,
              'ride_request',
              {
                rideId,
                pickupAddress: ride.pickup_address,
                estimatedFare: ride.estimated_fare,
                distance: ride.distance_km,
                ...additionalData
              }
            );
            notifications.push(notification);
          }
          break;

        case 'ride_accepted':
          // Notifier le client
          const customerNotification = await this.sendNotification(
            ride.customer_id,
            'ride_accepted',
            {
              rideId,
              driverName: additionalData.driverName,
              eta: additionalData.eta,
              vehicle: additionalData.vehicle
            }
          );
          notifications.push(customerNotification);
          break;

        case 'driver_en_route':
          await this.sendNotification(
            ride.customer_id,
            'driver_en_route',
            {
              rideId,
              eta: additionalData.eta,
              driverName: additionalData.driverName
            }
          );
          break;

        case 'driver_arrived':
          await this.sendNotification(
            ride.customer_id,
            'driver_arrived',
            { rideId }
          );
          break;

        case 'ride_completed':
          await this.sendNotification(
            ride.customer_id,
            'ride_completed',
            {
              rideId,
              finalFare: additionalData.finalFare
            }
          );
          
          // Rappel d'évaluation après 5 minutes
          setTimeout(async () => {
            await this.sendNotification(
              ride.customer_id,
              'rating_reminder',
              { rideId }
            );
          }, 5 * 60 * 1000);
          break;

        case 'ride_cancelled':
          if (additionalData.cancelledBy === 'driver') {
            await this.sendNotification(
              ride.customer_id,
              'ride_cancelled',
              {
                rideId,
                reason: additionalData.reason
              }
            );
          } else if (additionalData.cancelledBy === 'customer') {
            await this.sendNotification(
              ride.driver_id,
              'ride_cancelled',
              {
                rideId,
                reason: additionalData.reason
              }
            );
          }
          break;
      }

      return notifications;

    } catch (error) {
      console.error('Erreur notification événement course:', error);
    }
  }

  /**
   * Récupération des détails d'une course
   */
  async getRideDetails(rideId) {
    const { Ride, User, Driver } = require('../models');
    
    return await Ride.findByPk(rideId, {
      include: [
        { model: User, as: 'customer', attributes: ['uid', 'first_name'] },
        { 
          model: Driver, 
          include: [{ model: User, as: 'user', attributes: ['uid', 'first_name'] }]
        }
      ]
    });
  }

  /**
   * Recherche des chauffeurs disponibles
   */
  async findAvailableDrivers(ride) {
    const { Driver } = require('../models');
    
    return await Driver.findAll({
      where: {
        is_online: true,
        driver_status: 'approved',
        ride_type_id: ride.ride_type_id
      },
      include: [{ model: User, as: 'user', attributes: ['uid'] }],
      limit: 10 // Notifier seulement les 10 premiers
    });
  }
}

module.exports = NotificationService;