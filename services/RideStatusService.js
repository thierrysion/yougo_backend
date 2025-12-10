// services/RideStatusService.js
const { Ride, Driver, User, RideType } = require('../models');
const { 
  RIDE_STATUS, 
  PAYMENT_STATUS, 
  ALLOWED_TRANSITIONS, 
  STATUS_TIMESTAMPS 
} = require('../constants/rideStatus');
//const SocketService = require('./SocketService');
//const ChatService = require('./ChatService');

class RideStatusService {
  constructor(socketService, chatService) {
    this.socketService = socketService;
	  this.chatService = chatService; // Ajout du service chat
  }

  /**
   * Transition principale de statut avec validation
   */
  async transitionStatus(rideId, newStatus, transitionData = {}) {
    try {
      console.log(`🔄 Transition de statut pour la course ${rideId}: ${newStatus}`);
      
      // 1. Récupérer la course actuelle
      const ride = await Ride.findByPk(rideId, {
        include: [
          { model: User, as: 'customer', attributes: ['uid', 'first_name', 'last_name'] },
          { model: Driver, include: [{ model: User, as: 'user' }] },
          { model: RideType }
        ]
      });

      if (!ride) {
        throw new Error(`Course ${rideId} non trouvée`);
      }

      // 2. Valider la transition
      this.validateTransition(ride.status, newStatus);

      // 3. Préparer les données de mise à jour
      const updateData = await this.prepareStatusUpdate(ride, newStatus, transitionData);

      // 4. Effectuer la mise à jour en base
      await Ride.update(updateData, { where: { id: rideId } });

      // 5. Notifier les parties concernées
      await this.notifyStatusChange(ride, newStatus, transitionData);

      // 6. Logger la transition
      await this.logStatusTransition(rideId, ride.status, newStatus, transitionData);

      console.log(`✅ Transition réussie: ${ride.status} → ${newStatus} pour la course ${rideId}`);

      return {
        success: true,
        rideId,
        previousStatus: ride.status,
        newStatus,
        timestamp: new Date()
      };

    } catch (error) {
      console.error(`❌ Échec transition statut pour ${rideId}:`, error);
      throw error;
    }
  }

  /**
   * Validation des transitions autorisées
   */
  validateTransition(currentStatus, newStatus) {
    const allowedNextStatuses = ALLOWED_TRANSITIONS[currentStatus];
    
    if (!allowedNextStatuses.includes(newStatus)) {
      throw new Error(
        `Transition non autorisée: ${currentStatus} → ${newStatus}. ` +
        `Statuts autorisés: ${allowedNextStatuses.join(', ')}`
      );
    }

    console.log(`✓ Transition valide: ${currentStatus} → ${newStatus}`);
  }

  /**
   * Préparation des données de mise à jour selon le statut
   */
  async prepareStatusUpdate(ride, newStatus, transitionData) {
    const updateData = {
      status: newStatus
    };

    // Mettre à jour l'horodatage correspondant
    const timestampField = STATUS_TIMESTAMPS[newStatus];
    if (timestampField) {
      updateData[timestampField] = new Date();
    }

    // Logique spécifique à chaque statut
    switch (newStatus) {
      case RIDE_STATUS.ACCEPTED:
        // Déjà géré dans le matching service
        break;

      case RIDE_STATUS.DRIVER_EN_ROUTE:
        updateData.driver_current_location = transitionData.driverLocation;
        break;

      case RIDE_STATUS.ARRIVED:
        // Calculer le temps d'attente du chauffeur
        const waitTime = this.calculateWaitTime(ride.accepted_at, new Date());
        updateData.driver_wait_time_minutes = waitTime;
        break;

      case RIDE_STATUS.IN_PROGRESS:
        updateData.started_at = new Date();
        // Calculer le temps d'attente client
        if (ride.driver_arrived_at) {
          const customerWaitTime = this.calculateWaitTime(ride.driver_arrived_at, new Date());
          updateData.customer_wait_time_minutes = customerWaitTime;
        }
        break;

      case RIDE_STATUS.COMPLETED:
        await this.prepareRideCompletion(ride, updateData, transitionData);
        break;

      case RIDE_STATUS.CANCELLED:
        await this.prepareRideCancellation(ride, updateData, transitionData);
        break;
    }

    return updateData;
  }

  /**
   * Préparation de la completion d'une course
   */
  async prepareRideCompletion(ride, updateData, transitionData) {
    const {
      finalDistance,
      finalDuration,
      finalFare,
      routePolyline,
      customerRating,
      driverRating
    } = transitionData;

    // Calcul du prix final si non fourni
    updateData.final_fare = finalFare || await this.calculateFinalFare(ride);
    updateData.completed_at = new Date();
    updateData.final_distance_km = finalDistance || ride.distance_km;
    updateData.final_duration_minutes = finalDuration || await this.calculateActualDuration(ride);
    
    if (routePolyline) {
      updateData.actual_route = routePolyline;
    }

    // Statut de paiement
    updateData.payment_status = PAYMENT_STATUS.PENDING;

    // Calcul du temps total de course
    const totalRideTime = this.calculateWaitTime(ride.requested_at, new Date());
    updateData.total_ride_time_minutes = totalRideTime;

    console.log(`💰 Course ${ride.id} complétée - Prix final: ${updateData.final_fare}`);
  }

  /**
   * Préparation de l'annulation d'une course
   */
  async prepareRideCancellation(ride, updateData, transitionData) {
    const { cancelledBy, cancellationReason, cancellationFee } = transitionData;

    updateData.cancelled_by = cancelledBy || 'system';
    updateData.cancellation_reason = cancellationReason || 'Raison non spécifiée';
    updateData.cancelled_at = new Date();

    // Appliquer des frais d'annulation si nécessaire
    if (cancellationFee && cancellationFee > 0) {
      updateData.cancellation_fee = cancellationFee;
      updateData.final_fare = cancellationFee;
      updateData.payment_status = PAYMENT_STATUS.PENDING;
    }

    // Mettre à jour les statistiques d'annulation du chauffeur si applicable
    if (cancelledBy === 'driver' && ride.driver_id) {
      await this.updateDriverCancellationStats(ride.driver_id);
    }

    console.log(`🗑️ Course ${ride.id} annulée par ${cancelledBy}: ${cancellationReason}`);
  }

  /**
   * Notification des changements de statut
   */
  async notifyStatusChange(ride, newStatus, transitionData) {
    const notificationPayload = {
      rideId: ride.id,
      status: newStatus,
      timestamp: new Date().toISOString(),
      ...transitionData
    };

    try {
      // Notifier le client
      this.socketService.notifyCustomer(ride.customer_id, 'ride_status_update', notificationPayload);

      // Notifier le chauffeur si assigné
      if (ride.driver_id) {
        this.socketService.notifyDriver(ride.driver_id, 'ride_status_update', notificationPayload);
      }

      // Notifications spécifiques selon le statut
      switch (newStatus) {
        case RIDE_STATUS.DRIVER_EN_ROUTE:
          await this.notifyDriverEnRoute(ride, transitionData);
          break;

        case RIDE_STATUS.ARRIVED:
          await this.notifyDriverArrived(ride);
          break;

        case RIDE_STATUS.IN_PROGRESS:
          await this.notifyRideStarted(ride);
          break;

        case RIDE_STATUS.COMPLETED:
          await this.notifyRideCompleted(ride, transitionData);
          break;

        case RIDE_STATUS.CANCELLED:
          await this.notifyRideCancelled(ride, transitionData);
          break;
      }
	  
	  // Messages système dans le chat selon le statut
	  await this.sendSystemChatMessages(ride, newStatus, transitionData);

    } catch (error) {
      console.error('Erreur lors des notifications:', error);
      // Ne pas bloquer la transition en cas d'erreur de notification
    }
  }

  /**
   * Méthodes spécifiques pour chaque transition importante
   */

  async driverEnRoute(rideId, driverLocation) {
    return await this.transitionStatus(rideId, RIDE_STATUS.DRIVER_EN_ROUTE, {
      driverLocation,
      driverCurrentLocation: driverLocation
    });
  }

  async driverArrived(rideId) {
    return await this.transitionStatus(rideId, RIDE_STATUS.ARRIVED, {
      message: 'Votre chauffeur est arrivé au point de prise en charge'
    });
  }

  async startRide(rideId) {
    return await this.transitionStatus(rideId, RIDE_STATUS.IN_PROGRESS, {
      message: 'La course a débuté'
    });
  }

  async completeRide(rideId, completionData = {}) {
    return await this.transitionStatus(rideId, RIDE_STATUS.COMPLETED, completionData);
  }

  async cancelRide(rideId, cancellationData = {}) {
    return await this.transitionStatus(rideId, RIDE_STATUS.CANCELLED, cancellationData);
  }

  /**
   * Notifications spécifiques
   */

  async notifyDriverEnRoute(ride, transitionData) {
    const eta = await this.calculateETA(ride.pickup_location, transitionData.driverLocation);
    
    this.socketService.notifyCustomer(ride.customer_id, 'driver_en_route', {
      rideId: ride.id,
      driver: {
        id: ride.driver_id,
        name: ride.Driver?.user?.first_name,
        vehicle: ride.Driver ? {
          make: ride.Driver.vehicle_make,
          model: ride.Driver.vehicle_model,
          color: ride.Driver.vehicle_color,
          licensePlate: ride.Driver.license_plate
        } : null
      },
      eta: eta.minutes,
      distance: eta.distance,
      driverLocation: transitionData.driverLocation
    });
  }

  async notifyDriverArrived(ride) {
    this.socketService.notifyCustomer(ride.customer_id, 'driver_arrived', {
      rideId: ride.id,
      message: 'Votre chauffeur est arrivé',
      timestamp: new Date().toISOString()
    });
  }

  async notifyRideStarted(ride) {
    this.socketService.notifyCustomer(ride.customer_id, 'ride_started', {
      rideId: ride.id,
      message: 'La course a débuté',
      startedAt: new Date().toISOString()
    });

    this.socketService.notifyDriver(ride.driver_id, 'ride_started', {
      rideId: ride.id,
      message: 'Course démarrée',
      startedAt: new Date().toISOString()
    });
  }

  async notifyRideCompleted(ride, completionData) {
    this.socketService.notifyCustomer(ride.customer_id, 'ride_completed', {
      rideId: ride.id,
      finalFare: completionData.finalFare,
      distance: completionData.finalDistance,
      duration: completionData.finalDuration,
      message: 'Course terminée - Merci d\'avoir choisi notre service'
    });

    this.socketService.notifyDriver(ride.driver_id, 'ride_completed', {
      rideId: ride.id,
      finalFare: completionData.finalFare,
      earnings: this.calculateDriverEarnings(completionData.finalFare),
      message: 'Course terminée avec succès'
    });

    // Demander l'évaluation
    setTimeout(() => {
      this.requestRating(ride.id, ride.customer_id, ride.driver_id);
    }, 5000);
  }

  async notifyRideCancelled(ride, cancellationData) {
    const notification = {
      rideId: ride.id,
      reason: cancellationData.cancellationReason,
      cancelledBy: cancellationData.cancelledBy,
      timestamp: new Date().toISOString()
    };

    if (cancellationData.cancelledBy === 'customer') {
      this.socketService.notifyDriver(ride.driver_id, 'ride_cancelled_by_customer', notification);
    } else if (cancellationData.cancelledBy === 'driver') {
      this.socketService.notifyCustomer(ride.customer_id, 'ride_cancelled_by_driver', notification);
    } else {
      this.socketService.notifyCustomer(ride.customer_id, 'ride_cancelled', notification);
      if (ride.driver_id) {
        this.socketService.notifyDriver(ride.driver_id, 'ride_cancelled', notification);
      }
    }
  }

  /**
   * Utilitaires
   */

  calculateWaitTime(startTime, endTime) {
    if (!startTime) return 0;
    const diffMs = new Date(endTime) - new Date(startTime);
    return Math.round(diffMs / (1000 * 60)); // Retourne en minutes
  }

  async calculateFinalFare(ride) {
    // Utiliser le PricingService pour recalculer basé sur la distance/temps réels
    // Pour l'instant, retourner le prix estimé
    return ride.estimated_fare;
  }

  async calculateActualDuration(ride) {
    if (ride.started_at && ride.completed_at) {
      return this.calculateWaitTime(ride.started_at, ride.completed_at);
    }
    return ride.estimated_duration_minutes;
  }

  async calculateETA(pickupLocation, driverLocation) {
    // Implémentation simplifiée - dans la réalité, utiliser un service de routing
    // Calcul approximatif basé sur la distance
    const distance = this.calculateDistance(
      driverLocation.lat, driverLocation.lng,
      pickupLocation.coordinates[1], pickupLocation.coordinates[0]
    );
    
    const minutes = Math.max(2, Math.round(distance * 3)); // ~3 min/km
    return { minutes, distance: Math.round(distance * 100) / 100 };
  }

  calculateDistance(lat1, lon1, lat2, lon2) {
    // Formule de Haversine simplifiée
    const R = 6371; // Rayon de la Terre en km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
      Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
      Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  }

  calculateDriverEarnings(finalFare) {
    // Logique de commission (ex: 80% pour le chauffeur)
    const commissionRate = 0.8;
    return Math.round(finalFare * commissionRate);
  }

  async updateDriverCancellationStats(driverId) {
    try {
      const driver = await Driver.findByPk(driverId);
      if (driver) {
        const totalRides = driver.total_completed_rides + driver.cancellation_rate * 100; // Approximation
        const newCancellationRate = ((driver.cancellation_rate * totalRides) + 1) / (totalRides + 1);
        
        await Driver.update(
          { cancellation_rate: newCancellationRate },
          { where: { user_id: driverId } }
        );
      }
    } catch (error) {
      console.error('Erreur mise à jour stats annulation chauffeur:', error);
    }
  }

  async requestRating(rideId, customerId, driverId) {
    // Demander l'évaluation au client et au chauffeur
    this.socketService.notifyCustomer(customerId, 'rate_ride', {
      rideId,
      message: 'Comment s\'est passée votre course ?'
    });

    this.socketService.notifyDriver(driverId, 'rate_customer', {
      rideId,
      message: 'Évaluez votre passager'
    });
  }

  async logStatusTransition(rideId, fromStatus, toStatus, data) {
    // Logger la transition pour audit
    console.log(`📝 Audit transition: ${rideId} | ${fromStatus} → ${toStatus}`, {
      timestamp: new Date().toISOString(),
      data: JSON.stringify(data)
    });

    // Dans une implémentation réelle, sauvegarder en base
    // await RideAuditLog.create({ ... });
  }

  /**
   * Méthodes de requête
   */

  async getRideStatus(rideId) {
    const ride = await Ride.findByPk(rideId, {
      attributes: ['id', 'status', 'payment_status', 'estimated_fare', 'final_fare']
    });
    return ride ? ride.status : null;
  }

  async getRideTimeline(rideId) {
    const ride = await Ride.findByPk(rideId, {
      attributes: [
        'requested_at', 'accepted_at', 'driver_en_route_at', 
        'driver_arrived_at', 'started_at', 'completed_at', 'cancelled_at'
      ]
    });

    if (!ride) return null;

    const timeline = [];
    for (const [status, timestampField] of Object.entries(STATUS_TIMESTAMPS)) {
      if (ride[timestampField]) {
        timeline.push({
          status,
          timestamp: ride[timestampField],
          description: this.getStatusDescription(status)
        });
      }
    }

    return timeline.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  }

  getStatusDescription(status) {
    const descriptions = {
      [RIDE_STATUS.REQUESTED]: 'Course demandée',
      [RIDE_STATUS.MATCHING]: 'Recherche de chauffeur',
      [RIDE_STATUS.ACCEPTED]: 'Chauffeur assigné',
      [RIDE_STATUS.DRIVER_EN_ROUTE]: 'Chauffeur en chemin',
      [RIDE_STATUS.ARRIVED]: 'Chauffeur arrivé',
      [RIDE_STATUS.IN_PROGRESS]: 'Course en cours',
      [RIDE_STATUS.COMPLETED]: 'Course terminée',
      [RIDE_STATUS.CANCELLED]: 'Course annulée'
    };
    return descriptions[status] || status;
  }
  
  /**
   * Envoi de messages système dans le chat
   */
  async sendSystemChatMessages(ride, newStatus, transitionData) {
    try {
      let systemMessage = '';

      switch (newStatus) {
        case RIDE_STATUS.ACCEPTED:
          systemMessage = `✅ Course acceptée par ${ride.Driver?.user?.first_name}`;
          break;

        case RIDE_STATUS.DRIVER_EN_ROUTE:
          systemMessage = `🚗 Votre chauffeur est en route. ETA: ${transitionData.eta?.minutes} minutes`;
          break;

        case RIDE_STATUS.ARRIVED:
          systemMessage = `🎯 Votre chauffeur est arrivé au point de prise en charge`;
          break;

        case RIDE_STATUS.IN_PROGRESS:
          systemMessage = `🚦 Course démarrée. Bon voyage !`;
          break;

        case RIDE_STATUS.COMPLETED:
          systemMessage = `🏁 Course terminée. Merci d'avoir choisi nos services !`;
          break;

        case RIDE_STATUS.CANCELLED:
          const cancelledBy = transitionData.cancelledBy === 'customer' ? 'le client' : 'le chauffeur';
          systemMessage = `❌ Course annulée par ${cancelledBy}`;
          if (transitionData.cancellationReason) {
            systemMessage += `: ${transitionData.cancellationReason}`;
          }
          break;
      }

      if (systemMessage) {
        await this.chatService.sendSystemMessage(ride.id, systemMessage);
      }

    } catch (error) {
      console.error('Erreur envoi message système chat:', error);
    }
  }

}

module.exports = RideStatusService;