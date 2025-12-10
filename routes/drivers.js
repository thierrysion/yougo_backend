// routes/driver.js
const express = require('express');
const router = express.Router();
const { authenticate, requireRole, requireDriver, requireAdmin, optionalAuth } = require('../middleware/auth');
const DriverController = require('../controllers/driverController.js');


module.exports = (socketService) => {
  const driverController = new DriverController(socketService);
  
  router.post('/status', [authenticate, requireDriver], (req, res) => driverController.updateDriverStatus(req, res));

  /**
   * @route GET /api/driver/rides/active
   * @description Récupérer les courses actives du chauffeur
   * @access Private (Driver)
   */
  router.get('/rides/active', [authenticate, requireDriver], driverController.getDriverActiveRides.bind(driverController));
  
  return router;
};