// controllers/routingController.js

class RoutingController {
  constructor(routingService) {
    this.routingService = routingService;
  }
  /**
   * Obtenir un itinéraire entre deux points
   */
  async getRoute(req, res) {
    try {
      const { start, end, mode = 'driving', provider = 'osrm' } = req.body;

      // Validation des paramètres
      if (!start || !end) {
        return res.status(400).json({
          success: false,
          error: 'Les points de départ et d\'arrivée sont requis',
        });
      }

      if (!start.latitude || !start.longitude || !end.latitude || !end.longitude) {
        return res.status(400).json({
          success: false,
          error: 'Les coordonnées de départ et d\'arrivée sont invalides',
        });
      }

      const route = await this.routingService.getRoute(start, end, { mode, provider });

      res.json({
        success: true,
        data: {
          route,
        },
      });
    } catch (error) {
      console.error('routingController.getRoute error:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }

  /**
   * Obtenir un itinéraire avec points intermédiaires
   */
  async getRouteWithWaypoints(req, res) {
    try {
      const { start, end, waypoints = [], mode = 'driving', provider = 'osrm' } = req.body;

      if (!start || !end) {
        return res.status(400).json({
          success: false,
          error: 'Les points de départ et d\'arrivée sont requis',
        });
      }

      const route = await this.outingService.getRouteWithWaypoints(
        start, 
        end, 
        waypoints, 
        { mode, provider }
      );

      res.json({
        success: true,
        data: {
          route,
        },
      });
    } catch (error) {
      console.error('RoutingController.getRouteWithWaypoints error:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }

  /**
   * Calculer l'ETA entre deux points
   */
  async getETA(req, res) {
    try {
      const { start, end, mode = 'driving', provider = 'osrm' } = req.body;

      if (!start || !end) {
        return res.status(400).json({
          success: false,
          error: 'Les points de départ et d\'arrivée sont requis',
        });
      }

      const eta = await this.outingService.calculateETA(start, end, { mode, provider });

      res.json({
        success: true,
        data: eta,
      });
    } catch (error) {
      console.error('RoutingController.getETA error:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }

  /**
   * Vérifier la santé du service
   */
  async healthCheck(req, res) {
    try {
      const health = await this.routingService.healthCheck();
      
      res.json({
        success: true,
        data: {
          service: 'routing',
          status: 'operational',
          providers: health,
          timestamp: new Date().toISOString(),
        },
      });
    } catch (error) {
      console.error('RoutingController.healthCheck error:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }
}

module.exports = RoutingController;