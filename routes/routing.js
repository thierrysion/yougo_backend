// routes/routing.js
const express = require('express');
const router = express.Router();
const RoutingController = require('../controllers/routingController');
const { authenticate } = require('../middleware/auth');

// Le contrôleur sera injecté avec le matchingService
let routingController;

module.exports = (routingService) => {
  routingController = new RoutingController(routingService);

  // Tous les endpoints nécessitent une authentification
  router.use(authenticate);

  // Obtenir un itinéraire
  router.post('/route', routingController.getRoute.bind(routingController));

  // Obtenir un itinéraire avec points intermédiaires
  router.post('/route-with-waypoints', routingController.getRouteWithWaypoints.bind(routingController));

  // Calculer l'ETA
  router.post('/eta', routingController.getETA.bind(routingController));

  // Vérifier la santé du service
  router.get('/health', routingController.healthCheck.bind(routingController));

  return router;
}