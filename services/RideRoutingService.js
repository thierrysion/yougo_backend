// services/RideRoutingService.js
const RoutingService = require('./RoutingService');
const { Ride, Driver } = require('../models');

class RideRoutingService {
  /**
   * Calculer l'itinéraire pour une course
   */
  async calculateRideRoute(rideId) {
    try {
      const ride = await Ride.findByPk(rideId, {
        include: [
          {
            model: Driver,
            as: 'driver',
            required: false,
          },
        ],
      });

      if (!ride) {
        throw new Error('Course non trouvée');
      }

      // Calculer l'itinéraire principal
      const mainRoute = await RoutingService.getRoute(
        ride.pickupLocation,
        ride.destinationLocation,
        { mode: 'driving' }
      );

      let driverToPickupRoute = null;
      
      // Si un chauffeur est assigné, calculer l'itinéraire du chauffeur vers le pickup
      if (ride.driverId && ride.driver?.currentLocation) {
        driverToPickupRoute = await RoutingService.getRoute(
          ride.driver.currentLocation,
          ride.pickupLocation,
          { mode: 'driving' }
        );
      }

      return {
        mainRoute,
        driverToPickupRoute,
        rideId: ride.id,
        calculatedAt: new Date(),
      };
    } catch (error) {
      console.error('RideRoutingService.calculateRideRoute error:', error);
      throw new Error(`Erreur lors du calcul de l'itinéraire de course: ${error.message}`);
    }
  }

  /**
   * Mettre à jour l'ETA en temps réel
   */
  async updateRealTimeETA(rideId, driverLocation) {
    try {
      const ride = await Ride.findByPk(rideId);
      
      if (!ride) {
        throw new Error('Course non trouvée');
      }

      let eta;
      let distance;

      // Selon le statut de la course, calculer l'ETA approprié
      switch (ride.status) {
        case 'accepted':
        case 'driver_en_route':
          // ETA du chauffeur vers le pickup
          const toPickup = await RoutingService.calculateETA(
            driverLocation,
            ride.pickupLocation
          );
          eta = toPickup.eta;
          distance = toPickup.distance;
          break;

        case 'in_progress':
          // ETA du chauffeur vers la destination
          const toDestination = await RoutingService.calculateETA(
            driverLocation,
            ride.destinationLocation
          );
          eta = toDestination.eta;
          distance = toDestination.distance;
          break;

        default:
          eta = null;
          distance = null;
      }

      return {
        rideId,
        eta, // en secondes
        distance, // en mètres
        driverLocation,
        calculatedAt: new Date(),
      };
    } catch (error) {
      console.error('RideRoutingService.updateRealTimeETA error:', error);
      throw new Error(`Erreur lors de la mise à jour de l'ETA: ${error.message}`);
    }
  }
}

module.exports = new RideRoutingService();