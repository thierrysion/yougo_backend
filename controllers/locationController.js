// controllers/locationController.js
const LocationService = require('../services/LocationService');
const RoutingService = require('../services/RoutingService');

class LocationController {
  constructor(locationService, routingService) {
    this.locationService = locationService;
    this.routingService = routingService;
  }

  /**
   * Mise à jour de la position du chauffeur
   */
  async updateDriverLocation(req, res) {
    try {
      const { location, rideId } = req.body;
      const driverId = req.user.uid;

      // Validation que le chauffeur a le droit de mettre à jour cette position
      if (rideId) {
        await this.validateDriverRideAccess(driverId, rideId);
      }

      await this.locationService.handleDriverLocationUpdate(driverId, location, rideId);

      res.json({
        success: true,
        message: 'Position mise à jour avec succès',
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('Erreur mise à jour position:', error);
      res.status(400).json({
        success: false,
        error: error.message
      });
    }
  }

  /**
   * Calcul d'itinéraire
   */
  async calculateRoute(req, res) {
    try {
      const { start, end, options = {} } = req.body;

      if (!start || !end) {
        return res.status(400).json({
          success: false,
          error: 'Points de départ et d\'arrivée requis'
        });
      }

      const route = await this.routingService.calculateRoute(start, end, options);

      res.json({
        success: true,
        route,
        calculatedAt: new Date().toISOString()
      });

    } catch (error) {
      console.error('Erreur calcul itinéraire:', error);
      res.status(500).json({
        success: false,
        error: 'Erreur lors du calcul de l\'itinéraire'
      });
    }
  }

  /**
   * Calcul d'ETA
   */
  async calculateETA(req, res) {
    try {
      const { start, end, departureTime } = req.body;

      if (!start || !end) {
        return res.status(400).json({
          success: false,
          error: 'Points de départ et d\'arrivée requis'
        });
      }

      const eta = await this.routingService.calculateETAWithTraffic(start, end, departureTime);

      res.json({
        success: true,
        eta,
        calculatedAt: new Date().toISOString()
      });

    } catch (error) {
      console.error('Erreur calcul ETA:', error);
      res.status(500).json({
        success: false,
        error: 'Erreur lors du calcul de l\'ETA'
      });
    }
  }

  /**
   * Récupération de la position actuelle d'un chauffeur
   */
  async getDriverLocation(req, res) {
    try {
      const { driverId } = req.params;
      const { rideId } = req.query;

      // Validation des droits d'accès
      if (rideId) {
        await this.validateRideAccess(req.user.uid, rideId);
      }

      const location = this.locationService.getDriverCurrentLocation(driverId);

      if (!location) {
        return res.status(404).json({
          success: false,
          error: 'Position du chauffeur non disponible'
        });
      }

      res.json({
        success: true,
        location,
        cached: true
      });

    } catch (error) {
      console.error('Erreur récupération position:', error);
      res.status(400).json({
        success: false,
        error: error.message
      });
    }
  }

  /**
   * Validation des droits d'accès chauffeur-course
   */
  async validateDriverRideAccess(driverId, rideId) {
    const { Ride } = require('../models');
    const ride = await Ride.findOne({
      where: {
        id: rideId,
        driver_id: driverId,
        status: ['accepted', 'driver_en_route', 'in_progress']
      }
    });

    if (!ride) {
      throw new Error('Chauffeur non autorisé pour cette course');
    }

    return true;
  }

  /**
   * Validation des droits d'accès à une course
   */
  async validateRideAccess(userId, rideId) {
    const { Ride } = require('../models');
    const ride = await Ride.findOne({
      where: {
        id: rideId,
        [Op.or]: [
          { customer_id: userId },
          { driver_id: userId }
        ]
      }
    });

    if (!ride) {
      throw new Error('Accès non autorisé à cette course');
    }

    return true;
  }

  /**
   * Endpoint de debug - positions des chauffeurs actifs
   */
  async getActiveDriverLocations(req, res) {
    try {
      // Vérifier les droits admin
      if (req.user.role !== 'admin') {
        return res.status(403).json({
          success: false,
          error: 'Accès réservé aux administrateurs'
        });
      }

      const locations = this.locationService.getAllActiveDriverLocations();

      res.json({
        success: true,
        locations,
        total: Object.keys(locations).length,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('Erreur récupération positions actives:', error);
      res.status(500).json({
        success: false,
        error: 'Erreur interne du serveur'
      });
    }
  }
}

module.exports = LocationController;