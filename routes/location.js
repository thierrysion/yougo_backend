// routes/location.js
const express = require('express');
const router = express.Router();
const { authenticate, requireRole, requireDriver, requireAdmin, optionalAuth } = require('../middleware/auth');
const { check } = require('express-validator');
const LocationController = require('../controllers/locationController.js');

let locationController;

module.exports = (locationService, routingService) => {
  locationController = new LocationController(locationService, routingService);

  // POST /api/location/driver - Mise à jour position chauffeur
  router.post('/driver', [
    authenticate,
    check('location.lat').isFloat({ min: -90, max: 90 }),
    check('location.lng').isFloat({ min: -180, max: 180 })
  ], locationController.updateDriverLocation.bind(locationController));

  // POST /api/location/route - Calcul d'itinéraire
  router.post('/route', [
    check('start.lat').isFloat({ min: -90, max: 90 }),
    check('start.lng').isFloat({ min: -180, max: 180 }),
    check('end.lat').isFloat({ min: -90, max: 90 }),
    check('end.lng').isFloat({ min: -180, max: 180 })
  ], locationController.calculateRoute.bind(locationController));

  // POST /api/location/eta - Calcul ETA
  router.post('/eta', [
    check('start.lat').isFloat({ min: -90, max: 90 }),
    check('start.lng').isFloat({ min: -180, max: 180 }),
    check('end.lat').isFloat({ min: -90, max: 90 }),
    check('end.lng').isFloat({ min: -180, max: 180 })
  ], locationController.calculateETA.bind(locationController));

  // GET /api/location/driver/:driverId - Position d'un chauffeur
  router.get('/driver/:driverId', authenticate, locationController.getDriverLocation.bind(locationController));

  // GET /api/location/active-drivers - Debug: positions actives
  router.get('/active-drivers', authenticate, locationController.getActiveDriverLocations.bind(locationController));

  return router;
};