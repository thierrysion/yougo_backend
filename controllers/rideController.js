// controllers/rideController.js
const { Ride, RideType } = require('../models');
//const { v4: uuidv4 } = async () => { await import('uuid') };
const { randomUUID } = require('crypto');
const { sequelize } = require('../models');
const { socketService } = require('../server');

class RideController {
  constructor(matchingService) {
    this.matchingService = matchingService;
  }

  async requestRide(req, res) {
    try {
      const {
        pickupLocation,
        destination,
        rideTypeId,
        pickupAddress,
        destinationAddress,
        estimatedFare,
        distanceKm,
        estimatedDurationMinutes,
		baseFare,
		appliedRulesCount,
		fareBreakdown,
        constraints = {}
      } = req.body;

      const customerId = req.user.uid;

      // Validation des données requises
      if (!pickupLocation || !destination || !rideTypeId) {
        return res.status(400).json({
          success: false,
          error: "Données manquantes: pickupLocation, destination et rideTypeId sont requis"
        });
      }

      console.log(`🚖 Nouvelle demande de course de ${customerId} vers ${destinationAddress}`);

      // 1. Créer la course en base avec statut 'matching'
      const rideId = randomUUID(); //uuidv4();
      const ride = await Ride.create({
        id: rideId,
        customer_id: customerId,
        ride_type_id: rideTypeId,
        pickup_location: sequelize.fn('ST_GeomFromText', 
          `POINT(${pickupLocation.longitude} ${pickupLocation.latitude})`),
        pickup_address: pickupAddress,
        destination_location: sequelize.fn('ST_GeomFromText',
          `POINT(${destination.longitude} ${destination.latitude})`),
        destination_address: destinationAddress,
        estimated_fare: estimatedFare,
        distance_km: distanceKm,
        estimated_duration_minutes: estimatedDurationMinutes,
        status: 'requested', //'matching',
        payment_status: 'pending',
		    payment_method: 'cash',
        requested_at: new Date(),
		    base_fare: baseFare,
		    applied_rules_count: appliedRulesCount,
		    fare_breakdown: fareBreakdown
      });

      // 2. Préparer la requête de matching
      const rideRequest = {
        rideId,
        customerId,
        pickupLocation,
        destination,
        rideTypeId,
        estimatedFare,
        customerRating: req.user.customer_rating || 5.0,
        constraints: {
          maxWaitTime: constraints.maxWaitTime || 300, // 5 minutes par défaut
          searchRadius: constraints.searchRadius || 5, // 5km par défaut
          requireHighRating: constraints.requireHighRating || false
        },
        'distance': distanceKm,
        'duration': estimatedDurationMinutes,
        'status': ride.status,
        'requestedAt': ride.requested_at,
        // si jamais on veut ajouter d'autres propriétés
      };

      // 3. Lancer le matching séquentiel
      const matchingResult = await this.matchingService.initiateSequentialMatching(rideRequest);

      if (!matchingResult.success) {
        // Mettre à jour le statut de la course en échec
        await Ride.update(
          { status: 'cancelled', cancelled_at: new Date(), cancelled_by: 'system' },
          { where: { id: rideId } }
        );

        return res.status(200).json({
          success: false,
		  //ride: ride,
          error: matchingResult.error
        });
      }

      // 4. Retourner la réponse
      res.json({
        success: true,
        rideId,
		    //ride: ride,
        ride: {
          id: ride.id,
          customerId: ride.customer_id,
          driverId: ride.driver_id,
          rideTypeId: ride.ride_type_id,
          pickupLocation: { 'latitude' : pickupLocation.latitude, 'longitude' : pickupLocation.longitude },
          destinationLocation: { 'latitude' : destination.latitude, 'longitude' : destination.longitude },
          fare: estimatedFare,
          distance: distanceKm,
          duration: estimatedDurationMinutes,
          status: 'requested', //'matching',
          requestedAt: ride.requested_at,
          base_fare: baseFare,
          applied_rules_count: appliedRulesCount,
          fareBreakdown: fareBreakdown
        },
        status: 'matching_started',
        message: 'Recherche de chauffeur en cours',
        timing: {
          driverResponseTime: 20, // secondes
          maxWaitTime: Math.min(constraints.maxWaitTime || 300, 120), // Max 2 minutes remettre 120 au lieu de 300
          estimatedWaitTime: matchingResult.estimatedWaitTime
        },
        matching: {
          totalDriversAvailable: matchingResult.totalDriversAvailable,
          searchRadius: matchingResult.searchRadius,
          queuePosition: matchingResult.queuePosition
        }
      });

    } catch (error) {
      console.error('Erreur demande de course:', error);
      res.status(500).json({
        success: false,
        error: "Erreur interne du serveur"
      });
    }
  }

  async handleDriverResponse(req, res) {
    try {
      const { rideId, accepted } = req.body;
      const driverId = req.user.uid;

      if (typeof accepted !== 'boolean') {
        return res.status(400).json({
          success: false,
          error: "Le champ 'accepted' est requis et doit être un booléen"
        });
      }

      console.log(`📩 Réponse du chauffeur ${driverId} pour la course ${rideId}: ${accepted ? 'acceptée' : 'refusée'}`);

      let result;
      if (accepted) {
        result = await this.matchingService.handleDriverAcceptance(driverId, rideId);
      } else {
        await this.matchingService.handleDriverRejection(driverId, rideId);
        result = { success: true, message: "Course refusée" };
      }

      res.json(result);

    } catch (error) {
      console.error('Erreur traitement réponse chauffeur:', error);
      res.status(500).json({
        success: false,
        error: "Erreur interne du serveur"
      });
    }
  }

  async getRideStatus(req, res) {
    try {
      const { rideId } = req.params;
      const userId = req.user.uid;

      const ride = await Ride.findOne({
        where: { id: rideId },
        include: [
          {
            model: RideType,
            as: ride_type,
            attributes: ['name', 'description', 'icon_url']
          }
        ]
      });

      if (!ride) {
        return res.status(404).json({
          success: false,
          error: "Course non trouvée"
        });
      }

      // Vérifier que l'utilisateur a accès à cette course
      if (ride.customer_id !== userId && ride.driver_id !== userId && req.user.role !== 'admin') {
        return res.status(403).json({
          success: false,
          error: "Accès non autorisé à cette course"
        });
      }

      const matchingStatus = this.matchingService.getMatchingStatus(rideId);

      res.json({
        success: true,
        ride: {
          id: ride.id,
          status: ride.status,
          pickupAddress: ride.pickup_address,
          destinationAddress: ride.destination_address,
          estimatedFare: ride.estimated_fare,
          finalFare: ride.final_fare,
          requestedAt: ride.requested_at,
          acceptedAt: ride.accepted_at,
          startedAt: ride.started_at,
          completedAt: ride.completed_at,
          rideType: ride.RideType
        },
        matching: matchingStatus
      });

    } catch (error) {
      console.error('Erreur récupération statut course:', error);
      res.status(500).json({
        success: false,
        error: "Erreur interne du serveur"
      });
    }
  }

  async cancelRide(req, res) {
    try {
      const rideId = req.params.id;
      const userId = req.user.uid;
      const { reason, cancelledBy } = req.body;

      const ride = await Ride.findOne({ where: { id: rideId } });

      if (!ride) {
        return res.status(404).json({
          success: false,
          error: "Course non trouvée"
        });
      }

      // Vérifier les permissions
      if (((cancelledBy == 'customer' && ride.customer_id !== userId) || (cancelledBy == 'driver' && ride.driver_id !== userId)) && req.user.role !== 'admin') {
        console.log("echec annulation de la course permissions non accordées initiateur: " + cancelledBy + " id envoyé: " + ride.driver_id);
        return res.status(403).json({
          success: false,
          error: "Seul le client et le chauffeur de la course peuvent annuler cette course"
        });
        // Je me pose la question un chauffeur devrait-il être en mesure de le faire ? normalement non mais cas de force majeure accident ou panne
      }

      if(ride.status == 'cancelled') {
        res.json({
          success: true,
          message: "Course déjà annulée"
        });
      }
      // Vérifier que la course peut être annulée
      if (!['requested', 'matching', 'accepted'].includes(ride.status)) {
        return res.status(400).json({
          success: false,
          error: "Cette course ne peut pas être annulée"
        });
      }

      // Annuler la course
      await Ride.update(
        {
          status: 'cancelled',
          cancelled_at: new Date(),
          cancelled_by: 'customer',
          cancellation_reason: reason
        },
        { where: { id: rideId } }
      );

      // Nettoyer le matching en cours
      this.matchingService.clearAllTimeoutsForRide(rideId);
      this.matchingService.rideStates.delete(rideId);

      console.log(`🗑️ Course ${rideId} annulée`);

      res.json({
        success: true,
        message: "Course annulée avec succès"
      });

    } catch (error) {
      console.error('Erreur annulation course:', error);
      res.status(500).json({
        success: false,
        error: "Erreur interne du serveur"
      });
    }
  }

  async acceptRide(req, res) {
    try {
      const rideId = req.params.id;
      const driverId = req.user.uid;

      // Vérifier que l'utilisateur est un driver
      /*const user = await User.findByPk(driverId);
      if (!user || user.role !== 'driver') {
      return res.status(403).json({
        success: false,
        error: 'Accès réservé aux chauffeurs'
      });
      }*/

      // Vérifier que le driver existe et est approuvé
      const driver = await Driver.findOne({ 
        where: { 
          userId: driverId,
        //isApproved: true
        //driverStatus: 'approved' 
      } 
      });

      if (!driver) {
      return res.status(403).json({
        success: false,
        error: 'Chauffeur non approuvé ou non trouvé'
      });
      }

      // Récupérer la course
      const ride = await Ride.findByPk(rideId, {
      include: [
        { model: User, as: 'customer' },
        { model: RideType }
      ]
      });

      if (!ride) {
      return res.status(404).json({
        success: false,
        error: 'Course non trouvée'
      });
      }

      // Vérifier que la course est en statut 'requested'
      if (ride.status !== 'requested') {
      return res.status(400).json({
        success: false,
        error: 'Cette course n\'est plus disponible'
      });
      }

      // Vérifier que le driver est en ligne
      if (!driver.isOnline) {
      return res.status(400).json({
        success: false,
        error: 'Vous devez être en ligne pour accepter une course'
      });
      }

      // Mettre à jour la course
      await ride.update({
      driverId: driverId,
      status: 'accepted',
      acceptedAt: new Date()
      });

      // Charger les données mises à jour
      await ride.reload({
      include: [
        { model: User, as: 'customer' },
        { model: User, as: 'driver', include: ['driverProfile'] },
        { model: RideType }
      ]
      });

      // Émettre les événements Socket.IO
      const io = req.app.get('io');
      
      // Notifier le client que sa course a été acceptée
      this.socketService
      io.to(`ride_${rideId}`).emit('ride_status_update', {
      ride: ride.toJSON(),
      message: 'Chauffeur en route'
      });

      // Notifier le driver qu'il a bien accepté la course
      io.to(`driver_${driverId}`).emit('ride_accepted', {
      ride: ride.toJSON(),
      message: 'Course acceptée avec succès'
      });

      // Notifier les autres drivers que la course n'est plus disponible
      io.emit('ride_no_longer_available', { rideId });

      res.json({
      success: true,
      message: 'Course acceptée avec succès',
      ride: ride.toJSON()
      });

    } catch (error) {
      console.error('Erreur acceptation course:', error);
      res.status(500).json({
      success: false,
      error: 'Erreur lors de l\'acceptation de la course'
      });
    }
  }

  async startRide(req, res) {
    try {
      const rideId = req.params.id;
      const driverId = req.user.uid;

      // Récupérer la course
      const ride = await Ride.findByPk(rideId, {
        include: [
          { model: User, as: 'customer' },
          { model: RideType }
        ]
      });

      if (!ride) {
        return res.status(404).json({
          success: false,
          error: 'Course non trouvée'
        });
      }

      // Vérifier que le driver est bien assigné à cette course
      if (ride.driverId !== driverId) {
        return res.status(403).json({
          success: false,
          error: 'Non autorisé à démarrer cette course'
        });
      }

      // Vérifier que la course est en statut 'accepted'
      if (ride.status !== 'accepted') {
        return res.status(400).json({
          success: false,
          error: 'Course non acceptée'
        });
      }

      // Mettre à jour la course
      await ride.update({
        status: 'in_progress',
        startedAt: new Date()
      });

      await ride.reload({
        include: [
          { model: User, as: 'customer' },
          { model: User, as: 'driver', include: ['driverProfile'] },
          { model: RideType }
        ]
      });

      // Émettre les événements Socket.IO
      //const io = req.app.get('io');
      
      // Notifier le client que la course a débuté
      socketService.emitSignal('ride_started', { rideId: rideId, status:'in_progress', ride:ride.toJSON() });

      /*io.to(`ride_${rideId}`).emit('ride_status_update', {
        ride: ride.toJSON(),
        message: 'Course démarrée'
      });*/

      // Notifier le driver
      //socketService.notifyRideStarted(driverId, ride.toJSON());

      /*io.to(`driver_${driverId}`).emit('ride_started', {
        ride: ride.toJSON(),
        message: 'Course démarrée avec succès'
      });*/

      res.json({
        success: true,
        message: 'Course démarrée avec succès',
        ride: ride.toJSON()
      });

    } catch (error) {
      console.error('Erreur démarrage course:', error);
      res.status(500).json({
        success: false,
        error: 'Erreur lors du démarrage de la course'
      });
    }
  }

  async completeRide(req, res) {
    try {
      const rideId = req.params.id;
      const driverId = req.user.uid;

      // Récupérer la course
      const ride = await Ride.findByPk(rideId, {
        include: [
          { model: User, as: 'customer' },
          { model: RideType }
        ]
      });

      if (!ride) {
        return res.status(404).json({
          success: false,
          error: 'Course non trouvée'
        });
      }

      // Vérifier les autorisations
      if (ride.driverId !== driverId) {
        return res.status(403).json({
          success: false,
          error: 'Non autorisé à terminer cette course'
        });
      }

      // Vérifier que la course est en cours
      if (ride.status !== 'in_progress') {
        return res.status(400).json({
          success: false,
          error: 'Course non en cours'
        });
      }

      // Mettre à jour la course
      await ride.update({
        status: 'completed',
        completedAt: new Date()
      });

      await ride.reload({
        include: [
          { model: User, as: 'customer' },
          { model: User, as: 'driver', include: ['driverProfile'] },
          { model: RideType }
        ]
      });

      // Émettre les événements Socket.IO
      //const io = req.app.get('io');
      
      // Notifier le client que la course est terminée
      //socketService.notifyRideStatusUpdatetoClient(rideId, ride.toJSON());
      socketService.emitSignal('ride_completed', { rideId: rideId, driverId: driverId, ride:ride.toJSON(), finalFare: ride.finalFare, distance: ride.distance });

      /*io.to(`ride_${rideId}`).emit('ride_status_update', {
        ride: ride.toJSON(),
        message: 'Course terminée'
      });

      // Notifier le driver
      io.to(`driver_${driverId}`).emit('ride_completed', {
        ride: ride.toJSON(),
        message: 'Course terminée avec succès'
      });*/

      // Déclencher le processus de paiement
      // (À implémenter dans le service de paiement)

      res.json({
        success: true,
        message: 'Course terminée avec succès',
        ride: ride.toJSON()
      });

    } catch (error) {
      console.error('Erreur fin de course:', error);
      res.status(500).json({
        success: false,
        error: 'Erreur lors de la finalisation de la course'
      });
    }
  }

  async cancelRideByDriver(req, res) {
    try {
      const rideId = req.params.id;
      const driverId = req.user.uid;
      const { reason } = req.body;

      // Récupérer la course
      const ride = await Ride.findByPk(rideId);

      if (!ride) {
        return res.status(404).json({
          success: false,
          error: 'Course non trouvée'
        });
      }

      // Vérifier les autorisations
      if (ride.driverId !== driverId) {
        return res.status(403).json({
          success: false,
          error: 'Non autorisé à annuler cette course'
        });
      }

      // Vérifier que la course peut être annulée
      const cancellableStatuses = ['requested', 'accepted', 'in_progress'];
      if (!cancellableStatuses.includes(ride.status)) {
        return res.status(400).json({
          success: false,
          error: 'Cette course ne peut pas être annulée'
        });
      }

      // Mettre à jour la course
      await ride.update({
        status: 'cancelled',
        cancelledAt: new Date(),
        cancellationReason: reason || 'Annulé par le chauffeur',
        cancelledBy: 'driver'
      });

      // Émettre les événements Socket.IO
      //const io = req.app.get('io');
      
      // Notifier le client
      socketService.emitSignal('ride_cancelled_by_driver', { rideId: rideId, driverId: driverId, ride: ride, reason: reason || 'Annulé par le chauffeur' });
      /*io.to(`ride_${rideId}`).emit('ride_cancelled', {
        rideId,
        reason: reason || 'Annulé par le chauffeur',
        cancelledBy: 'driver'
      });

      // Notifier le driver
      io.to(`driver_${driverId}`).emit('ride_cancellation_confirmed', {
        rideId,
        message: 'Course annulée avec succès'
      });*/

      res.json({
        success: true,
        message: 'Course annulée avec succès'
      });

    } catch (error) {
      console.error('Erreur annulation course:', error);
      res.status(500).json({
        success: false,
        error: 'Erreur lors de l\'annulation de la course'
      });
    }
  }

}

module.exports = RideController;