// services/LocationService.js
const { Op } = require('sequelize');
const { sequelize, Driver, Ride } = require('../models');

class LocationService {
  constructor(io) {
    this.io = io;
    this.activeRideTrackings = new Map(); // rideId -> tracking data
    this.driverLocations = new Map(); // driverId -> current location
    this.setupSocketHandlers();
  }

  setupSocketHandlers() {
    this.io.on('connection', (socket) => {
      // Chauffeur envoie sa position
      socket.on('driver_location_update', async (data) => {
        try {
          const { driverId, location, rideId } = data;
          await this.handleDriverLocationUpdate(driverId, location, rideId);
        } catch (error) {
          console.error('Erreur mise à jour position chauffeur:', error);
        }
      });

      // Client écoute les mises à jour de position
      socket.on('subscribe_to_ride_location', (data) => {
        const { rideId, customerId } = data;
        this.handleCustomerSubscription(rideId, customerId, socket.id);
      });

      // Chauffeur écoute les demandes de position
      socket.on('driver_subscribe_location', (driverId) => {
        this.driverSockets.set(driverId, socket.id);
      });
    });
  }

  /**
   * Gestion de la mise à jour de position d'un chauffeur
   */
  async handleDriverLocationUpdate(driverId, location, rideId = null) {
    try {
      // Validation des données de localisation
      this.validateLocation(location);

      // Mettre à jour la position en mémoire
      this.driverLocations.set(driverId, {
        ...location,
        timestamp: new Date(),
        rideId
      });

      // Mettre à jour la position en base si le chauffeur est en course
      if (rideId) {
        await this.updateDriverLocationInDatabase(driverId, location, rideId);
        
        // Notifier les clients abonnés à cette course
        await this.notifyRideSubscribers(rideId, driverId, location);
      }

      // Mettre à jour la disponibilité du chauffeur dans le matching
      await this.updateDriverAvailability(driverId, location);

      console.log(`📍 Position mise à jour - Chauffeur: ${driverId}, Ride: ${rideId || 'Aucune'}`);

    } catch (error) {
      console.error('Erreur mise à jour position:', error);
      throw error;
    }
  }

  /**
   * Validation des données de localisation
   */
  validateLocation(location) {
    const { lat, lng/*, accuracy, heading, speed*/ } = location;

    if (!lat || !lng) {
      throw new Error('Coordonnées GPS manquantes');
    }

    if (lat < -90 || lat > 90) {
      throw new Error('Latitude invalide');
    }

    if (lng < -180 || lng > 180) {
      throw new Error('Longitude invalide');
    }

    /*if (accuracy && accuracy < 0) {
      throw new Error('Précision invalide');
    }*/

    return true;
  }

  /**
   * Mise à jour de la position en base de données
   */
  async updateDriverLocationInDatabase(driverId, location, rideId) {
    try {
      // Mettre à jour la position du chauffeur
      await Driver.update(
        {
          current_location: sequelize.fn('ST_GeomFromText', `POINT(${location.lng} ${location.lat})`),
          updated_at: new Date()
        },
        { where: { user_id: driverId } }
      );

      // Si en course, mettre à jour la position actuelle dans la ride
      const ride = await Ride.findByPk(rideId);
      if (ride && ['driver_en_route', 'in_progress'].includes(ride.status)) {
        await Ride.update(
          {
            driver_current_location: sequelize.fn('ST_GeomFromText', `POINT(${location.lng} ${location.lat})`)
          },
          { where: { id: rideId } }
        );
      }

    } catch (error) {
      console.error('Erreur mise à jour BD position:', error);
      // Ne pas bloquer le flux en cas d'erreur BD
    }
  }

  /**
   * Notification des abonnés à une course
   */
  async notifyRideSubscribers(rideId, driverId, location) {
    const rideTracking = this.activeRideTrackings.get(rideId);
    if (!rideTracking) return;

    const { customerSocketId, lastNotification } = rideTracking;

    // Éviter les notifications trop fréquentes (max 1 par seconde)
    const now = new Date();
    if (lastNotification && (now - lastNotification) < 1000) {
      return;
    }

    // Calculer l'ETA mise à jour
    const etaUpdate = await this.calculateETAUpdate(rideId, location);

    // Préparer les données de notification
    const locationUpdate = {
      rideId,
      driverId,
      location: {
        lat: location.lat,
        lng: location.lng,
        accuracy: location.accuracy,
        heading: location.heading,
        speed: location.speed,
        timestamp: now.toISOString()
      },
      eta: etaUpdate,
      distanceToDestination: await this.calculateDistanceToDestination(rideId, location)
    };

    // Envoyer la mise à jour au client
    if (customerSocketId && this.io.sockets.sockets.get(customerSocketId)) {
      this.io.to(customerSocketId).emit('driver_location_update', locationUpdate);
    }

    // Mettre à jour le dernier horodatage de notification
    this.activeRideTrackings.set(rideId, {
      ...rideTracking,
      lastNotification: now,
      lastLocation: location
    });

    console.log(`📡 Notification position - Ride: ${rideId}, ETA: ${etaUpdate.etaMinutes}min`);
  }

  /**
   * Calcul de l'ETA mise à jour
   */
  async calculateETAUpdate(rideId, currentLocation) {
    try {
      const ride = await Ride.findByPk(rideId);
      if (!ride) return { etaMinutes: null, distanceKm: null };

      let targetLocation;
      let currentDistance;

      // Déterminer la destination cible selon le statut
      if (ride.status === 'driver_en_route') {
        // En chemin vers le pickup
        targetLocation = ride.pickup_location;
        currentDistance = this.calculateDistance(
          currentLocation.lat, currentLocation.lng,
          targetLocation.coordinates[1], targetLocation.coordinates[0]
        );
      } else if (ride.status === 'in_progress') {
        // En cours vers la destination
        targetLocation = ride.destination_location;
        currentDistance = this.calculateDistance(
          currentLocation.lat, currentLocation.lng,
          targetLocation.coordinates[1], targetLocation.coordinates[0]
        );
      } else {
        return { etaMinutes: null, distanceKm: null };
      }

      // Calcul ETA basé sur distance et vitesse moyenne
      const averageSpeedKmh = 30; // 30km/h en ville
      const etaMinutes = Math.max(1, Math.round((currentDistance / averageSpeedKmh) * 60));

      return {
        etaMinutes,
        distanceKm: Math.round(currentDistance * 100) / 100,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      console.error('Erreur calcul ETA:', error);
      return { etaMinutes: null, distanceKm: null };
    }
  }

  /**
   * Calcul de la distance jusqu'à la destination
   */
  async calculateDistanceToDestination(rideId, currentLocation) {
    try {
      const ride = await Ride.findByPk(rideId);
      if (!ride) return null;

      const destination = ride.destination_location;
      const distance = this.calculateDistance(
        currentLocation.lat, currentLocation.lng,
        destination.coordinates[1], destination.coordinates[0]
      );

      return Math.round(distance * 100) / 100;
    } catch (error) {
      console.error('Erreur calcul distance destination:', error);
      return null;
    }
  }

  /**
   * Gestion de l'abonnement d'un client au suivi
   */
  handleCustomerSubscription(rideId, customerId, socketId) {
    // Vérifier que le client a le droit de suivre cette course
    this.validateCustomerAccess(rideId, customerId).then(hasAccess => {
      if (hasAccess) {
        this.activeRideTrackings.set(rideId, {
          customerId,
          customerSocketId: socketId,
          rideId,
          subscribedAt: new Date(),
          lastLocation: null,
          lastNotification: null
        });

        console.log(`👤 Client ${customerId} abonné au suivi de la course ${rideId}`);

        // Envoyer la position actuelle immédiatement
        this.sendInitialLocation(rideId, socketId);
      }
    }).catch(error => {
      console.error('Erreur abonnement suivi:', error);
    });
  }

  /**
   * Validation des droits d'accès au suivi
   */
  async validateCustomerAccess(rideId, customerId) {
    const ride = await Ride.findOne({
      where: { 
        id: rideId,
        customer_id: customerId 
      },
      attributes: ['id', 'status']
    });

    if (!ride) {
      throw new Error('Accès non autorisé au suivi de cette course');
    }

    // Autoriser le suivi seulement à partir de l'acceptation du chauffeur
    const allowedStatuses = ['accepted', 'driver_en_route', 'arrived', 'in_progress'];
    if (!allowedStatuses.includes(ride.status)) {
      throw new Error('Suivi non disponible pour le statut actuel de la course');
    }

    return true;
  }

  /**
   * Envoi de la position initiale au client
   */
  async sendInitialLocation(rideId, socketId) {
    try {
      const ride = await Ride.findByPk(rideId, {
        include: [{
          model: Driver,
          attributes: ['user_id', 'current_location']
        }]
      });

      if (!ride || !ride.Driver || !ride.Driver.current_location) {
        return;
      }

      const driverLocation = {
        lat: ride.Driver.current_location.coordinates[1],
        lng: ride.Driver.current_location.coordinates[0]
      };

      const etaUpdate = await this.calculateETAUpdate(rideId, driverLocation);

      const initialLocation = {
        rideId,
        driverId: ride.Driver.user_id,
        location: {
          ...driverLocation,
          timestamp: new Date().toISOString()
        },
        eta: etaUpdate,
        distanceToDestination: await this.calculateDistanceToDestination(rideId, driverLocation)
      };

      this.io.to(socketId).emit('driver_location_initial', initialLocation);

    } catch (error) {
      console.error('Erreur envoi position initiale:', error);
    }
  }

  /**
   * Mise à jour de la disponibilité du chauffeur
   */
  async updateDriverAvailability(driverId, location) {
    try {
      // Déterminer la zone actuelle du chauffeur
      const zone = await this.determineDriverZone(location);
      
      // Mettre à jour la zone en base
      await Driver.update(
        {
          current_zone: zone,
          current_location: sequelize.fn('ST_GeomFromText', `POINT(${location.lng} ${location.lat})`),
          updated_at: new Date()
        },
        { where: { user_id: driverId } }
      );

    } catch (error) {
      console.error('Erreur mise à jour disponibilité:', error);
    }
  }

  /**
   * Détermination de la zone du chauffeur
   */
  async determineDriverZone(location) {
    // Implémentation simplifiée - dans la réalité, utiliser un service de géocodage inverse
    // ou une base de données de polygones de zones
    
    // Pour l'instant, retourner une zone basique basée sur les coordonnées
    const lat = location.lat;
    const lng = location.lng;
    
    // Exemple de découpage en zones
    if (lat > 4.05 && lat < 4.07 && lng > 9.76 && lng < 9.78) {
      return 'centre_ville';
    } else if (lat > 4.03 && lat < 4.05 && lng > 9.75 && lng < 9.77) {
      return 'quartier_affaires';
    } else {
      return 'banlieue';
    }
  }

  /**
   * Formule de calcul de distance (Haversine)
   */
  calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Rayon de la Terre en km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
      Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
      Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  }

  /**
   * Récupération de la position actuelle d'un chauffeur
   */
  getDriverCurrentLocation(driverId) {
    return this.driverLocations.get(driverId);
  }

  /**
   * Récupération de toutes les positions des chauffeurs actifs
   */
  getAllActiveDriverLocations() {
    const locations = {};
    for (const [driverId, location] of this.driverLocations.entries()) {
      locations[driverId] = location;
    }
    return locations;
  }

  /**
   * Nettoyage des suivis inactifs
   */
  cleanupInactiveTrackings() {
    const now = new Date();
    let cleanedCount = 0;

    for (const [rideId, tracking] of this.activeRideTrackings.entries()) {
      // Supprimer les suivis inactifs depuis plus de 2 heures
      if (now - tracking.subscribedAt > 2 * 60 * 60 * 1000) {
        this.activeRideTrackings.delete(rideId);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      console.log(`🧹 Nettoyage: ${cleanedCount} suivis inactifs supprimés`);
    }
  }

  /**
   * Démarrage du nettoyage périodique
   */
  startCleanupInterval() {
    // Nettoyer toutes les heures
    setInterval(() => {
      this.cleanupInactiveTrackings();
    }, 60 * 60 * 1000);
  }

  /**
   * Arrêt du suivi d'une course
   */
  stopRideTracking(rideId) {
    const existed = this.activeRideTrackings.has(rideId);
    this.activeRideTrackings.delete(rideId);
    
    if (existed) {
      console.log(`🛑 Suivi arrêté pour la course ${rideId}`);
    }
    
    return existed;
  }
}

module.exports = LocationService;