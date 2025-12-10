// controllers/pricingController.js
const PricingService = require('../services/PricingService');

class PricingController {
  constructor() {
    this.pricingService = new PricingService();
	this.calculateRidePrices = this.calculateRidePrices.bind(this);
  }

  async calculateRidePrices(req, res) {
    try {
      const pricingContext = {
        // Données géographiques
        pickupLocation: req.body.pickupLocation,
        destinationLocation: req.body.destinationLocation,
        ///pickupZone: req.body.pickupZone,
        ///destinationZone: req.body.destinationZone,
        
        // Données métriques
        distanceKm: parseFloat(req.body.distanceKm),
        durationMinutes: parseInt(req.body.durationMinutes),
        
        // Contexte temporel
        timestamp: req.body.timestamp || new Date(),
        
        // Contexte dynamique
        ///demandMultiplier: parseFloat(req.body.demandMultiplier) || 1.0,
        ///weatherCondition: req.body.weatherCondition || 'normal'
      };

      const rideOptions = await this.pricingService.calculateAllRideTypes(pricingContext);
      
      res.json({
        success: true,
        data: rideOptions,
        metadata: {
          count: rideOptions.length,
          currency: 'XAF',
          calculatedAt: new Date().toISOString()
        }
      });
      
    } catch (error) {
      console.error('Pricing calculation error:', error);
      res.status(400).json({
        success: false,
        error: error.message
      });
    }
  }
}

module.exports = new PricingController();