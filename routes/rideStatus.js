// routes/rideStatus.js
const express = require('express');
const router = express.Router();
const { authenticate, requireRole, requireDriver, requireAdmin, optionalAuth } = require('../middleware/auth');
const { check } = require('express-validator');
const RideStatusController = require('../controllers/rideStatusController.js');

let rideStatusController;

module.exports = (rideStatusService) => {
  rideStatusController = new RideStatusController(rideStatusService);

  // POST /api/rides/:id/status - Mettre à jour le statut
  router.post('/:id/status', [
    authenticate,
    check('status').isIn(Object.values(require('../constants/rideStatus').RIDE_STATUS))
  ], rideStatusController.updateRideStatus.bind(rideStatusController));

  // POST /api/rides/:id/driver-en-route - Chauffeur en chemin
  router.post('/:id/driver-en-route', [
    authenticate,
    check('driverLocation.lat').isFloat(),
    check('driverLocation.lng').isFloat()
  ], rideStatusController.driverEnRoute.bind(rideStatusController));

  // POST /api/rides/:id/driver-arrived - Chauffeur arrivé
  router.post('/:id/driver-arrived', authenticate, rideStatusController.driverArrived.bind(rideStatusController));

  // POST /api/rides/:id/start - Démarrer la course
  router.post('/:id/start', authenticate, rideStatusController.startRide.bind(rideStatusController));

  // POST /api/rides/:id/complete - Terminer la course
  router.post('/:id/complete', authenticate, rideStatusController.completeRide.bind(rideStatusController));

  // GET /api/rides/:id/timeline - Historique des statuts
  router.get('/:id/timeline', authenticate, rideStatusController.getRideTimeline.bind(rideStatusController));

  return router;
};