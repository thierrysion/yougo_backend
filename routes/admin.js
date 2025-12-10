// routes/admin.js
const express = require('express');
const router = express.Router();
const { authenticate, requireRole, requireDriver, requireAdmin, optionalAuth } = require('../middleware/auth');
const AdminController = require('../controllers/adminController.js');

let adminController;

module.exports = (adminService) => {
  adminController = new AdminController(adminService);

  // Middleware d'admin sur toutes les routes
  router.use([authenticate, requireAdmin]);
  router.use(adminController.checkAdminAccess.bind(adminController));

  // Dashboard et statistiques
  router.get('/dashboard/stats', adminController.getDashboardStats.bind(adminController));
  router.get('/analytics/rides', adminController.getRideAnalytics.bind(adminController));
  router.get('/analytics/financial', adminController.getFinancialAnalytics.bind(adminController));
  router.get('/analytics/users', adminController.getUserAnalytics.bind(adminController));
  router.get('/analytics/drivers', adminController.getDriverAnalytics.bind(adminController));
  router.get('/realtime', adminController.getRealtimeData.bind(adminController));
  router.get('/system/health', adminController.getSystemHealth.bind(adminController));

  // Gestion des données
  router.get('/users', adminController.getUsers.bind(adminController));
  router.get('/drivers', adminController.getDrivers.bind(adminController));
  router.get('/rides', adminController.getRides.bind(adminController));

  // Export de données
  router.get('/export', adminController.exportData.bind(adminController));

  return router;
};