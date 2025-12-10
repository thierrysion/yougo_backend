// routes/rides.js
const express = require('express');
const router = express.Router();
const { authenticate, requireRole, requireDriver, requireAdmin, optionalAuth } = require('../middleware/auth');
const { check, validationResult } = require('express-validator');
const RideController = require('../controllers/rideController.js');

// Le contrôleur sera injecté avec le matchingService
let rideController;

// Middleware pour valider les données de course
const validateRideRequest = [
  check('pickupLocation.lat').isFloat({ min: -90, max: 90 }),
  check('pickupLocation.lng').isFloat({ min: -180, max: 180 }),
  check('destination.lat').isFloat({ min: -90, max: 90 }),
  check('destination.lng').isFloat({ min: -180, max: 180 }),
  check('rideTypeId').isUUID(),
  check('pickupAddress').notEmpty(),
  check('destinationAddress').notEmpty(),
  check('estimatedFare').isFloat({ min: 0 }),
  check('distanceKm').isFloat({ min: 0 }),
  check('estimatedDurationMinutes').isInt({ min: 1 })
];

const validateDriverResponse = [
  check('rideId').isUUID(),
  check('accepted').isBoolean()
];

// Initialisation avec le matchingService
module.exports = (matchingService) => {
  rideController = new RideController(matchingService);
  
  // POST /api/rides/request - Demander une course
  router.post('/request', [authenticate/*, validateRideRequest*/], (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }
    rideController.requestRide(req, res);
  });

  // POST /api/rides/respond - Réponse du chauffeur
  router.post('/respond', [authenticate/*, validateDriverResponse*/], (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }
    rideController.handleDriverResponse(req, res);
  });

  // GET /api/rides/:id/status - Statut de la course
  router.get('/:id/status', authenticate, rideController.getRideStatus.bind(rideController));

  // POST /api/rides/:id/cancel - Annuler une course
  router.post('/:id/cancel', authenticate, rideController.cancelRide.bind(rideController));
  
  router.post('/rides/:id/accept', [authenticate, requireDriver], (req, res) => rideController.acceptRide.bind(rideController));

  /**
   * @route POST /api/rides/:id/start
   * @description Débuter une course (arrivé au point de pickup)
   * @access Private (Driver)
   */
  router.post('/:id/start', [authenticate, requireDriver], rideController.startRide.bind(rideController));

  /**
 * @route POST /api/rides/:id/complete
 * @description Terminer une course
 * @access Private (Driver)
 */
  router.post('/:id/complete',  [authenticate, requireDriver], rideController.completeRide.bind(rideController));

  /**
 * @route POST /api/rides/:id/cancel/driver
 * @description Annuler une course (côté chauffeur)
 * @access Private (Driver)
 */
  router.post('/:id/cancel/driver', [authenticate, requireDriver], rideController.cancelRideByDriver.bind(rideController));

  return router;
};