// controllers/rideStatusController.js
const RideStatusService = require('../services/RideStatusService');

class RideStatusController {
  constructor(rideStatusService) {
    this.rideStatusService = rideStatusService;
  }

  async updateRideStatus(req, res) {
    try {
      const { rideId } = req.params;
      const { status, ...transitionData } = req.body;
      const userId = req.user.uid;

      // Vérifier les permissions
      await this.validateUserPermission(rideId, userId, status);

      const result = await this.rideStatusService.transitionStatus(
        rideId, 
        status, 
        transitionData
      );

      res.json({
        success: true,
        ...result
      });

    } catch (error) {
      console.error('Erreur mise à jour statut course:', error);
      res.status(400).json({
        success: false,
        error: error.message
      });
    }
  }

  async driverEnRoute(req, res) {
    try {
      const { rideId } = req.params;
      const { driverLocation } = req.body;
      const driverId = req.user.uid;

      await this.validateDriverPermission(rideId, driverId);

      const result = await this.rideStatusService.driverEnRoute(rideId, driverLocation);

      res.json(result);

    } catch (error) {
      res.status(400).json({
        success: false,
        error: error.message
      });
    }
  }

  async driverArrived(req, res) {
    try {
      const { rideId } = req.params;
      const driverId = req.user.uid;

      await this.validateDriverPermission(rideId, driverId);

      const result = await this.rideStatusService.driverArrived(rideId);

      res.json(result);

    } catch (error) {
      res.status(400).json({
        success: false,
        error: error.message
      });
    }
  }

  async startRide(req, res) {
    try {
      const { rideId } = req.params;
      const driverId = req.user.uid;

      await this.validateDriverPermission(rideId, driverId);

      const result = await this.rideStatusService.startRide(rideId);

      res.json(result);

    } catch (error) {
      res.status(400).json({
        success: false,
        error: error.message
      });
    }
  }

  async completeRide(req, res) {
    try {
      const { rideId } = req.params;
      const completionData = req.body;
      const driverId = req.user.uid;

      await this.validateDriverPermission(rideId, driverId);

      const result = await this.rideStatusService.completeRide(rideId, completionData);

      res.json(result);

    } catch (error) {
      res.status(400).json({
        success: false,
        error: error.message
      });
    }
  }

  async getRideTimeline(req, res) {
    try {
      const { rideId } = req.params;
      const userId = req.user.uid;

      await this.validateUserAccess(rideId, userId);

      const timeline = await this.rideStatusService.getRideTimeline(rideId);

      res.json({
        success: true,
        timeline
      });

    } catch (error) {
      res.status(400).json({
        success: false,
        error: error.message
      });
    }
  }

  // Méthodes de validation des permissions
  async validateUserPermission(rideId, userId, status) {
    const { Ride } = require('../models');
    const ride = await Ride.findByPk(rideId);
    
    if (!ride) {
      throw new Error('Course non trouvée');
    }

    // Admin peut tout faire
    // if (req.user.role === 'admin') return true;

    const isCustomer = ride.customer_id === userId;
    const isDriver = ride.driver_id === userId;

    if (!isCustomer && !isDriver) {
      throw new Error('Accès non autorisé à cette course');
    }

    // Validation des actions autorisées selon le rôle
    if (status === 'cancelled' && isCustomer && ride.status !== 'requested' && ride.status !== 'matching') {
      throw new Error('Vous ne pouvez pas annuler cette course');
    }

    return true;
  }

  async validateDriverPermission(rideId, driverId) {
    const { Ride } = require('../models');
    const ride = await Ride.findByPk(rideId);
    
    if (!ride) {
      throw new Error('Course non trouvée');
    }

    if (ride.driver_id !== driverId) {
      throw new Error('Vous n\'êtes pas le chauffeur assigné à cette course');
    }

    return true;
  }

  async validateUserAccess(rideId, userId) {
    const { Ride } = require('../models');
    const ride = await Ride.findByPk(rideId);
    
    if (!ride) {
      throw new Error('Course non trouvée');
    }

    if (ride.customer_id !== userId && ride.driver_id !== userId) {
      throw new Error('Accès non autorisé à cette course');
    }

    return true;
  }
}

module.exports = RideStatusController;