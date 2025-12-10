// services/RoutingService.js
const axios = require('axios');

class RoutingServiceOld {
  constructor() {
    // Clés d'API pour les services de routing (OSRM, Google Maps, etc.)
    this.routingProvider = process.env.ROUTING_PROVIDER || 'osrm';
    this.apiKeys = {
      google: process.env.GOOGLE_MAPS_API_KEY,
      mapbox: process.env.MAPBOX_API_KEY
    };
  }

  /**
   * Calcul d'itinéraire entre deux points
   */
  async calculateRoute(start, end, options = {}) {
    try {
      switch (this.routingProvider) {
        case 'google':
          return await this.calculateRouteGoogle(start, end, options);
        case 'mapbox':
          return await this.calculateRouteMapbox(start, end, options);
        case 'osrm':
        default:
          return await this.calculateRouteOSRM(start, end, options);
      }
    } catch (error) {
      console.error('Erreur calcul itinéraire:', error);
      // Retourner un itinéraire basique en fallback
      return this.calculateBasicRoute(start, end);
    }
  }

  /**
   * Calcul d'itinéraire avec OSRM (Open Source Routing Machine)
   */
  async calculateRouteOSRM(start, end, options = {}) {
    const { lat: startLat, lng: startLng } = start;
    const { lat: endLat, lng: endLng } = end;

    const url = `http://router.project-osrm.org/route/v1/driving/${startLng},${startLat};${endLng},${endLat}?overview=full&geometries=geojson`;

    const response = await axios.get(url);
    const data = response.data;

    if (data.code !== 'Ok' || !data.routes || data.routes.length === 0) {
      throw new Error('Aucun itinéraire trouvé');
    }

    const route = data.routes[0];
    
    return {
      distance: route.distance / 1000, // Convertir en km
      duration: route.duration / 60,   // Convertir en minutes
      geometry: route.geometry,
      legs: route.legs,
      overview: route.geometry.coordinates.map(coord => ({
        lng: coord[0],
        lat: coord[1]
      }))
    };
  }

  /**
   * Calcul d'itinéraire avec Google Maps
   */
  async calculateRouteGoogle(start, end, options = {}) {
    const { lat: startLat, lng: startLng } = start;
    const { lat: endLat, lng: endLng } = end;

    const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${startLat},${startLng}&destination=${endLat},${endLng}&key=${this.apiKeys.google}`;

    const response = await axios.get(url);
    const data = response.data;

    if (data.status !== 'OK' || !data.routes || data.routes.length === 0) {
      throw new Error('Aucun itinéraire trouvé avec Google Maps');
    }

    const route = data.routes[0];
    const leg = route.legs[0];

    // Extraire le polyline
    const points = [];
    leg.steps.forEach(step => {
      points.push(...this.decodePolyline(step.polyline.points));
    });

    return {
      distance: leg.distance.value / 1000, // Convertir en km
      duration: leg.duration.value / 60,   // Convertir en minutes
      geometry: {
        type: 'LineString',
        coordinates: points
      },
      overview: points,
      summary: route.summary,
      warnings: route.warnings
    };
  }

  /**
   * Calcul d'ETA dynamique avec trafic
   */
  async calculateETAWithTraffic(start, end, departureTime = 'now') {
    try {
      if (this.routingProvider === 'google' && this.apiKeys.google) {
        return await this.calculateETAGoogle(start, end, departureTime);
      } else {
        // Fallback vers le calcul basique
        const route = await this.calculateRoute(start, end);
        return {
          etaMinutes: Math.round(route.duration),
          distanceKm: route.distance,
          withTraffic: false
        };
      }
    } catch (error) {
      console.error('Erreur calcul ETA avec trafic:', error);
      return await this.calculateBasicETA(start, end);
    }
  }

  /**
   * Calcul ETA avec Google Maps incluant le trafic
   */
  async calculateETAGoogle(start, end, departureTime = 'now') {
    const { lat: startLat, lng: startLng } = start;
    const { lat: endLat, lng: endLng } = end;

    const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${startLat},${startLng}&destination=${endLat},${endLng}&departure_time=${departureTime}&traffic_model=best_guess&key=${this.apiKeys.google}`;

    const response = await axios.get(url);
    const data = response.data;

    if (data.status !== 'OK') {
      throw new Error('Erreur calcul ETA Google Maps');
    }

    const route = data.routes[0];
    const leg = route.legs[0];

    return {
      etaMinutes: Math.round(leg.duration_in_traffic?.value / 60) || Math.round(leg.duration.value / 60),
      distanceKm: leg.distance.value / 1000,
      withTraffic: true,
      trafficInfo: {
        congestion: leg.duration_in_traffic ? 
          (leg.duration_in_traffic.value - leg.duration.value) / leg.duration.value : 0
      }
    };
  }

  /**
   * Calcul d'itinéraire basique (fallback)
   */
  calculateBasicRoute(start, end) {
    const distance = this.calculateHaversineDistance(start, end);
    const duration = Math.round((distance / 30) * 60); // 30km/h moyenne

    return {
      distance: Math.round(distance * 100) / 100,
      duration: Math.max(1, duration),
      geometry: {
        type: 'LineString',
        coordinates: [
          [start.lng, start.lat],
          [end.lng, end.lat]
        ]
      },
      overview: [
        { lng: start.lng, lat: start.lat },
        { lng: end.lng, lat: end.lat }
      ],
      isFallback: true
    };
  }

  /**
   * Calcul ETA basique (fallback)
   */
  calculateBasicETA(start, end) {
    const distance = this.calculateHaversineDistance(start, end);
    const etaMinutes = Math.round((distance / 30) * 60); // 30km/h moyenne

    return {
      etaMinutes: Math.max(1, etaMinutes),
      distanceKm: Math.round(distance * 100) / 100,
      withTraffic: false,
      isFallback: true
    };
  }

  /**
   * Décodage du polyline Google Maps
   */
  decodePolyline(encoded) {
    const points = [];
    let index = 0, len = encoded.length;
    let lat = 0, lng = 0;

    while (index < len) {
      let b, shift = 0, result = 0;
      do {
        b = encoded.charCodeAt(index++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      const dlat = ((result & 1) ? ~(result >> 1) : (result >> 1));
      lat += dlat;

      shift = 0;
      result = 0;
      do {
        b = encoded.charCodeAt(index++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      const dlng = ((result & 1) ? ~(result >> 1) : (result >> 1));
      lng += dlng;

      points.push([lng * 1e-5, lat * 1e-5]);
    }

    return points;
  }

  /**
   * Calcul de distance Haversine
   */
  calculateHaversineDistance(point1, point2) {
    const R = 6371; // Rayon de la Terre en km
    const dLat = (point2.lat - point1.lat) * Math.PI / 180;
    const dLon = (point2.lng - point1.lng) * Math.PI / 180;
    const a = 
      Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(point1.lat * Math.PI / 180) * Math.cos(point2.lat * Math.PI / 180) * 
      Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  }

  /**
   * Optimisation d'itinéraire pour multiple points
   */
  async optimizeRoute(points, options = {}) {
    // Implémentation pour l'optimisation de tournée
    // (Pour les chauffeurs avec plusieurs courses)
    try {
      if (points.length <= 2) {
        return await this.calculateRoute(points[0], points[1], options);
      }

      // Utiliser un service d'optimization de tournée
      return await this.calculateOptimizedRoute(points, options);
    } catch (error) {
      console.error('Erreur optimisation itinéraire:', error);
      // Retourner un itinéraire simple en fallback
      return this.calculateSimpleMultiPointRoute(points);
    }
  }

  /**
   * Calcul d'itinéraire optimisé pour multiple points
   */
  async calculateOptimizedRoute(points, options) {
    // Implémentation basique - dans la réalité, utiliser un service comme GraphHopper
    // ou l'API Google Maps Directions avec waypoint optimization
    
    const routes = [];
    for (let i = 0; i < points.length - 1; i++) {
      const route = await this.calculateRoute(points[i], points[i + 1], options);
      routes.push(route);
    }

    return {
      totalDistance: routes.reduce((sum, route) => sum + route.distance, 0),
      totalDuration: routes.reduce((sum, route) => sum + route.duration, 0),
      routes: routes,
      waypoints: points,
      isOptimized: false // Indiquer que c'est une optimisation basique
    };
  }

  calculateSimpleMultiPointRoute(points) {
    let totalDistance = 0;
    let totalDuration = 0;
    const segments = [];

    for (let i = 0; i < points.length - 1; i++) {
      const distance = this.calculateHaversineDistance(points[i], points[i + 1]);
      const duration = Math.round((distance / 30) * 60); // 30km/h moyenne
      
      totalDistance += distance;
      totalDuration += duration;
      
      segments.push({
        from: points[i],
        to: points[i + 1],
        distance: Math.round(distance * 100) / 100,
        duration: Math.max(1, duration)
      });
    }

    return {
      totalDistance: Math.round(totalDistance * 100) / 100,
      totalDuration: Math.max(1, totalDuration),
      segments: segments,
      isFallback: true,
      isOptimized: false
    };
  }
}

module.exports = RoutingServiceOld;