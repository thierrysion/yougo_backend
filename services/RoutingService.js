// services/RoutingService.js
const axios = require('axios');
const polyline = require('@mapbox/polyline');
const { sequelize, Route } = require('../models/Route');

class RoutingService {
  constructor() {
    this.providers = {
      osrm: this.getRouteFromOSRM.bind(this),
      google: this.getRouteFromGoogle.bind(this),
      mapbox: this.getRouteFromMapbox.bind(this),
    };
  }

  /**
   * Obtenir un itinéraire entre deux points
   */
  async getRoute(start, end, options = {}) {
    const {
      mode = 'driving',
      provider = 'osrm',
      waypoints = [],
      alternatives = false,
      avoid = [],
    } = options;

    try {
      // Vérifier d'abord en cache
      const cachedRoute = await this.getCachedRoute(start, end, mode, provider);
      if (cachedRoute) {
        return cachedRoute;
      }

      // Obtenir l'itinéraire du provider
      const route = await this.providers[provider](start, end, {
        mode,
        waypoints,
        alternatives,
        avoid,
      });

      // Mettre en cache
      await this.cacheRoute(route);

      return route;
    } catch (error) {
      console.error('RoutingService.getRoute error:', error);
      
      // Fallback vers un autre provider
      if (provider !== 'osrm') {
        return await this.getRoute(start, end, { ...options, provider: 'osrm' });
      }
      
      throw new Error(`Erreur lors du calcul de l'itinéraire: ${error.message}`);
    }
  }

  /**
   * Service OSRM (Open Source Routing Machine)
   */
  async getRouteFromOSRM(start, end, options = {}) {
    const { mode = 'driving', waypoints = [] } = options;
    
    // Construire les coordonnées pour OSRM
    const coordinates = [
      [start.longitude, start.latitude],
      ...waypoints.map(wp => [wp.longitude, wp.latitude]),
      [end.longitude, end.latitude],
    ];

    const coordinatesString = coordinates.map(coord => coord.join(',')).join(';');

    const url = `http://router.project-osrm.org/route/v1/${mode}/${coordinatesString}`;
    
    const params = {
      overview: 'full',
      geometries: 'polyline',
      steps: true,
      annotations: true,
      alternatives: options.alternatives || false,
    };

    const response = await axios.get(url, { params, timeout: 10000 });

    if (response.data.code !== 'Ok') {
      throw new Error(`OSRM error: ${response.data.code}`);
    }

    const routeData = response.data.routes[0];
    
    // Décoder la polyline pour obtenir les points
    const decodedPolyline = polyline.decode(routeData.geometry);
    const polylinePoints = decodedPolyline.map(([lat, lng]) => ({
      latitude: lat,
      longitude: lng,
    }));

    // Calculer les bounds
    const bounds = this.calculateBounds(polylinePoints);

    return {
      polyline: polylinePoints,
      distance: routeData.distance, // en mètres
      duration: routeData.duration, // en secondes
      polylinePoints: routeData.geometry, // Polyline encodée
      bounds,
      legs: routeData.legs?.map(leg => ({
        distance: leg.distance,
        duration: leg.duration,
        steps: leg.steps?.map(step => ({
          distance: step.distance,
          duration: step.duration,
          instruction: step.maneuver?.instruction,
          name: step.name,
          mode: step.mode,
          polyline: polyline.decode(step.geometry).map(([lat, lng]) => ({
            latitude: lat,
            longitude: lng,
          })),
        })),
      })),
      provider: 'osrm',
      mode,
      metadata: {
        weight: routeData.weight,
        weight_name: routeData.weight_name,
      },
    };
  }

  /**
   * Service Google Directions API
   */
  async getRouteFromGoogle(start, end, options = {}) {
    const { mode = 'driving', waypoints = [], avoid = [] } = options;
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;

    if (!apiKey) {
      throw new Error('Google Maps API key not configured');
    }

    const url = 'https://maps.googleapis.com/maps/api/directions/json';
    
    const params = {
      origin: `${start.latitude},${start.longitude}`,
      destination: `${end.latitude},${end.longitude}`,
      mode: mode === 'cycling' ? 'bicycling' : mode,
      key: apiKey,
      alternatives: options.alternatives || false,
    };

    // Ajouter les waypoints si présents
    if (waypoints.length > 0) {
      params.waypoints = waypoints.map(wp => 
        `${wp.latitude},${wp.longitude}`
      ).join('|');
    }

    // Éviter certains types de routes
    if (avoid.length > 0) {
      params.avoid = avoid.join('|');
    }

    const response = await axios.get(url, { params, timeout: 10000 });

    if (response.data.status !== 'OK') {
      throw new Error(`Google Directions error: ${response.data.status}`);
    }

    const routeData = response.data.routes[0];
    const leg = routeData.legs[0];
    
    // Décoder la polyline
    const decodedPolyline = polyline.decode(routeData.overview_polyline.points);
    const polylinePoints = decodedPolyline.map(([lat, lng]) => ({
      latitude: lat,
      longitude: lng,
    }));

    const bounds = this.calculateBounds(polylinePoints);

    return {
      polyline: polylinePoints,
      distance: leg.distance.value, // en mètres
      duration: leg.duration.value, // en secondes
      polylinePoints: routeData.overview_polyline.points,
      bounds,
      legs: routeData.legs.map(leg => ({
        distance: leg.distance.value,
        duration: leg.duration.value,
        start: {
          latitude: leg.start_location.lat,
          longitude: leg.start_location.lng,
        },
        end: {
          latitude: leg.end_location.lat,
          longitude: leg.end_location.lng,
        },
        steps: leg.steps.map(step => ({
          distance: step.distance.value,
          duration: step.duration.value,
          instruction: step.html_instructions,
          polyline: polyline.decode(step.polyline.points).map(([lat, lng]) => ({
            latitude: lat,
            longitude: lng,
          })),
        })),
      })),
      provider: 'google',
      mode,
      metadata: {
        summary: routeData.summary,
        warnings: routeData.warnings,
        copyrights: routeData.copyrights,
      },
    };
  }

  /**
   * Service Mapbox Directions API
   */
  async getRouteFromMapbox(start, end, options = {}) {
    const { mode = 'driving', waypoints = [] } = options;
    const accessToken = process.env.MAPBOX_ACCESS_TOKEN;

    if (!accessToken) {
      throw new Error('Mapbox access token not configured');
    }

    // Construire les coordonnées pour Mapbox
    const coordinates = [
      [start.longitude, start.latitude],
      ...waypoints.map(wp => [wp.longitude, wp.latitude]),
      [end.longitude, end.latitude],
    ];

    const coordinatesString = coordinates.map(coord => coord.join(',')).join(';');

    const url = `https://api.mapbox.com/directions/v5/mapbox/${mode}/${coordinatesString}`;
    
    const params = {
      access_token: accessToken,
      geometries: 'polyline',
      steps: true,
      overview: 'full',
      alternatives: options.alternatives || false,
    };

    const response = await axios.get(url, { params, timeout: 10000 });

    if (response.data.code !== 'Ok') {
      throw new Error(`Mapbox error: ${response.data.code}`);
    }

    const routeData = response.data.routes[0];
    
    const decodedPolyline = polyline.decode(routeData.geometry);
    const polylinePoints = decodedPolyline.map(([lat, lng]) => ({
      latitude: lat,
      longitude: lng,
    }));

    const bounds = this.calculateBounds(polylinePoints);

    return {
      polyline: polylinePoints,
      distance: routeData.distance, // en mètres
      duration: routeData.duration, // en secondes
      polylinePoints: routeData.geometry,
      bounds,
      legs: routeData.legs.map(leg => ({
        distance: leg.distance,
        duration: leg.duration,
        steps: leg.steps.map(step => ({
          distance: step.distance,
          duration: step.duration,
          instruction: step.maneuver?.instruction,
          name: step.name,
          mode: step.mode,
          polyline: polyline.decode(step.geometry).map(([lat, lng]) => ({
            latitude: lat,
            longitude: lng,
          })),
        })),
      })),
      provider: 'mapbox',
      mode,
      metadata: {
        weight: routeData.weight,
        weight_name: routeData.weight_name,
      },
    };
  }

  /**
   * Calculer les bounds (limites) d'un ensemble de points
   */
  calculateBounds(points) {
    if (!points || points.length === 0) {
      return null;
    }

    let minLat = 90;
    let maxLat = -90;
    let minLng = 180;
    let maxLng = -180;

    points.forEach(point => {
      minLat = Math.min(minLat, point.latitude);
      maxLat = Math.max(maxLat, point.latitude);
      minLng = Math.min(minLng, point.longitude);
      maxLng = Math.max(maxLng, point.longitude);
    });

    return {
      northeast: {
        latitude: maxLat,
        longitude: maxLng,
      },
      southwest: {
        latitude: minLat,
        longitude: minLng,
      },
    };
  }

  /**
   * Obtenir un itinéraire depuis le cache
   */
  async getCachedRoute(start, end, mode, provider) {
    try {
      // Rechercher un itinéraire similaire dans les dernières 24h
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      
      const cachedRoute = await Route.findOne({
        where: {
          startLatitude: start.latitude,
          startLongitude: start.longitude,
          endLatitude: end.latitude,
          endLongitude: end.longitude,
          mode,
          provider,
          updatedAt: {
            [Op.gte]: twentyFourHoursAgo,
          },
        },
      });

      return cachedRoute ? cachedRoute.toJSON() : null;
    } catch (error) {
      console.error('Error getting cached route:', error);
      return null;
    }
  }

  /**
   * Mettre en cache un itinéraire
   */
  async cacheRoute(routeData) {
    try {
      await Route.upsert({
        startLatitude: routeData.polyline[0].latitude,
        startLongitude: routeData.polyline[0].longitude,
        endLatitude: routeData.polyline[routeData.polyline.length - 1].latitude,
        endLongitude: routeData.polyline[routeData.polyline.length - 1].longitude,
        distance: routeData.distance,
        duration: routeData.duration,
        polyline: routeData.polylinePoints,
        bounds: routeData.bounds,
        mode: routeData.mode,
        provider: routeData.provider,
        metadata: routeData.metadata,
      });
    } catch (error) {
      console.error('Error caching route:', error);
      // Ne pas throw pour ne pas interrompre le flux principal
    }
  }

  /**
   * Calculer l'ETA entre deux points
   */
  async calculateETA(start, end, options = {}) {
    try {
      const route = await this.getRoute(start, end, options);
      return {
        eta: route.duration, // en secondes
        distance: route.distance, // en mètres
        mode: route.mode,
        provider: route.provider,
      };
    } catch (error) {
      console.error('RoutingService.calculateETA error:', error);
      throw new Error(`Erreur lors du calcul de l'ETA: ${error.message}`);
    }
  }

  /**
   * Obtenir un itinéraire avec points intermédiaires
   */
  async getRouteWithWaypoints(start, end, waypoints, options = {}) {
    return await this.getRoute(start, end, {
      ...options,
      waypoints,
    });
  }

  /**
   * Vérifier la santé des providers
   */
  async healthCheck() {
    const health = {};
    const testStart = { latitude: 48.8566, longitude: 2.3522 }; // Paris
    const testEnd = { latitude: 48.8606, longitude: 2.3376 }; // Louvre

    for (const [providerName, providerFn] of Object.entries(this.providers)) {
      try {
        await providerFn(testStart, testEnd, { mode: 'driving' });
        health[providerName] = 'healthy';
      } catch (error) {
        health[providerName] = `unhealthy: ${error.message}`;
      }
    }

    return health;
  }
}

module.exports = RoutingService;