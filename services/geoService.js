
// Types fondamentaux
interface Location {
  latitude: number;
  longitude: number;
}

interface Address {
  formatted: string;
  street?: string;
  city: string;
  postalCode?: string;
  country: string;
}

interface ETAOptions {
  trafficEnabled?: boolean;
  departureTime?: Date;
  travelMode?: 'driving' | 'walking' | 'bicycling';
}

interface BoundingBox {
  northEast: Location;
  southWest: Location;
}

// Modèle pour les zones opérationnelles
interface OperatingZone {
  id: string;
  name: string;
  city: string;
  polygon: Location[]; // Polygone fermé
  isActive: boolean;
  baseFareMultiplier: number;
  createdAt: Date;
  updatedAt: Date;
}

// Cache des calculs
interface DistanceCache {
  origin: Location;
  destination: Location;
  distance: number;
  duration: number;
  calculatedAt: Date;
}

interface IGeoService {
  // Calculs de base
  calculateDistance(origin: Location, destination: Location): Promise<number>;
  calculateETA(origin: Location, destination: Location, options?: ETAOptions): Promise<number>;
  
  // Géocoding
  geocodeAddress(address: string): Promise<Location>;
  reverseGeocode(location: Location): Promise<Address>;
  
  // Zones et couverture
  isInOperatingZone(location: Location): Promise<boolean>;
  getZoneFromLocation(location: Location): Promise<string>;
  isLocationInPolygon(location: Location, polygon: Location[]): boolean;
  
  // Utilitaires
  calculateBoundingBox(center: Location, radiusKm: number): BoundingBox;
  findNearestPointOnRoute(point: Location, route: Location[]): Location;
}


class GeoService implements IGeoService {
	private mapProvider: IMapProvider; // Google Maps, MapBox, etc.
	private cache: ICacheService; // Redis pour le cache
	private database: IRepository;
	  
	constructor(config: GeoServiceConfig) {
		this.mapProvider = config.mapProvider;
		this.cache = config.cache;
		this.database = config.database;
		
		// Configuration des tolerances
		this.distanceTolerance = config.distanceTolerance || 0.01; // 10m
		this.cacheTTL = config.cacheTTL || 3600; // 1 heure
	}
  
	async calculateDistance(origin: Location, destination: Location): Promise<number> {
		const cacheKey = `distance:${this.locationToKey(origin)}:${this.locationToKey(destination)}`;
	  
		// Vérifier le cache
		const cached = await this.cache.get(cacheKey);
		if (cached) return parseFloat(cached);
	  
		// Calcul Haversine pour distance à vol d'oiseau
		const R = 6371; // Rayon de la Terre en km
		const dLat = this.deg2rad(destination.latitude - origin.latitude);
		const dLon = this.deg2rad(destination.longitude - origin.longitude);
	  
		const a = 
			Math.sin(dLat/2) * Math.sin(dLat/2) +
			Math.cos(this.deg2rad(origin.latitude)) * 
			Math.cos(this.deg2rad(destination.latitude)) * 
			Math.sin(dLon/2) * Math.sin(dLon/2);
	  
		const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
		const distance = R * c;
	  
		// Mettre en cache
		await this.cache.set(cacheKey, distance.toString(), this.cacheTTL);
	  
		return distance;
	}

	private deg2rad(deg: number): number {
	  return deg * (Math.PI/180);
	}

	private locationToKey(location: Location): string {
	  return `${location.latitude.toFixed(6)},${location.longitude.toFixed(6)}`;
	}
	
	async calculateETA(origin: Location, destination: Location, options: ETAOptions = {}): Promise<number> {
	    const {
			trafficEnabled = true,
			departureTime = new Date(),
			travelMode = 'driving'
		} = options;
  
		const cacheKey = `eta:${this.locationToKey(origin)}:${this.locationToKey(destination)}:${travelMode}:${departureTime.getTime()}`;
  
		// Cache pour ETA
		const cached = await this.cache.get(cacheKey);
		if (cached) return parseInt(cached);
  
		let duration: number;
  
		if (trafficEnabled && this.mapProvider) {
			// Utiliser le fournisseur de carte pour ETA précis avec trafic
			const routeInfo = await this.mapProvider.getRoute(origin, destination, {
			  departureTime,
			  travelMode
			});
			duration = routeInfo.duration; // en secondes
		} else {
			// Estimation basique: 2 minutes par km en ville
			const distance = await this.calculateDistance(origin, destination);
			const averageSpeed = 30; // km/h en ville
			duration = (distance / averageSpeed) * 3600; // secondes
			
			// Ajustement pour trafic aux heures de pointe
			if (this.isPeakHour(departureTime)) {
			  duration *= 1.5; // +50% pendant les heures de pointe
			}
		}
  
		const durationMinutes = Math.ceil(duration / 60);
  
		await this.cache.set(cacheKey, durationMinutes.toString(), this.cacheTTL / 6); // 10 min cache pour ETA
  
		return durationMinutes;
	}

	private isPeakHour(time: Date): boolean {
		const hour = time.getHours();
		// Heures de pointe: 7h-10h et 16h-19h en semaine
		const isWeekday = time.getDay() >= 1 && time.getDay() <= 5;
		return isWeekday && ((hour >= 7 && hour <= 10) || (hour >= 16 && hour <= 19));
	}
	
	async geocodeAddress(address: string): Promise<Location> {
		const cacheKey = `geocode:${Buffer.from(address).toString('base64')}`;
  
		const cached = await this.cache.get(cacheKey);
		if (cached) {
			return JSON.parse(cached);
		}
  
		let location: Location;
  
		try {
			// Essayer le fournisseur principal
			location = await this.mapProvider.geocode(address);
		} catch (error) {
			// Fallback: base de données de géocoding locale
			location = await this.database.geocoding.findByAddress(address);
    
			if (!location) {
			  throw new Error(`Adresse non trouvée: ${address}`);
			}
		}
  
		await this.cache.set(cacheKey, JSON.stringify(location), this.cacheTTL * 24); // 24h pour géocoding
  
		return location;
	}

	async reverseGeocode(location: Location): Promise<Address> {
		const cacheKey = `reverse_geocode:${this.locationToKey(location)}`;
	  
		const cached = await this.cache.get(cacheKey);
		if (cached) {
			return JSON.parse(cached);
		}
	  
		let address: Address;
	  
		try {
			address = await this.mapProvider.reverseGeocode(location);
		} catch (error) {
			// Format d'adresse basique comme fallback
			address = {
			  formatted: `Position (${location.latitude.toFixed(4)}, ${location.longitude.toFixed(4)})`,
			  city: 'Inconnu',
			  country: 'Inconnu'
			};
		}
	  
		await this.cache.set(cacheKey, JSON.stringify(address), this.cacheTTL * 24);
	  
		return address;
	}
	
	async isInOperatingZone(location: Location): Promise<boolean> {
		const zones = await this.database.operatingZones.findActive();
		  
		for (const zone of zones) {
			if (this.isLocationInPolygon(location, zone.polygon)) {
			  return true;
			}
		}
		  
		return false;
	}

	async getZoneFromLocation(location: Location): Promise<string> {
		const zones = await this.database.operatingZones.findActive();
	  
		for (const zone of zones) {
			if (this.isLocationInPolygon(location, zone.polygon)) {
				return zone.name;
			}
		}
	  
		throw new Error('Location outside operating zones');
	}

	// Algorithme Ray Casting pour vérifier si un point est dans un polygone
	isLocationInPolygon(point: Location, polygon: Location[]): boolean {
		let inside = false;
		const x = point.longitude;
		const y = point.latitude;
	  
		for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
			const xi = polygon[i].longitude;
			const yi = polygon[i].latitude;
			const xj = polygon[j].longitude;
			const yj = polygon[j].latitude;
			
			const intersect = ((yi > y) !== (yj > y)) &&
			  (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
			
			if (intersect) inside = !inside;
		}
	  
		return inside;
	}
	
	// Calcul d'une bounding box autour d'un point
	calculateBoundingBox(center: Location, radiusKm: number): BoundingBox {
		const earthRadius = 6371; // km
		const latDelta = (radiusKm / earthRadius) * (180 / Math.PI);
		const lonDelta = (radiusKm / earthRadius) * (180 / Math.PI) / Math.cos(center.latitude * Math.PI / 180);
		  
		return {
			northEast: {
				latitude: center.latitude + latDelta,
				longitude: center.longitude + lonDelta
			},
			southWest: {
				latitude: center.latitude - latDelta,
				longitude: center.longitude - lonDelta
			}
		};
	}

	// Trouver le point le plus proche sur une route
	findNearestPointOnRoute(point: Location, route: Location[]): Location {
		let minDistance = Infinity;
		let nearestPoint = route[0];
	  
		for (let i = 0; i < route.length - 1; i++) {
			const segmentStart = route[i];
			const segmentEnd = route[i + 1];
			
			const pointOnSegment = this.pointOnSegment(point, segmentStart, segmentEnd);
			const distance = this.calculateDistance(point, pointOnSegment);
			
			if (distance < minDistance) {
				minDistance = distance;
				nearestPoint = pointOnSegment;
			}
		}
	  
		return nearestPoint;
	}

	private pointOnSegment(point: Location, segmentStart: Location, segmentEnd: Location): Location {
		// Implémentation de la projection d'un point sur un segment
		const A = point.longitude - segmentStart.longitude;
		const B = point.latitude - segmentStart.latitude;
		const C = segmentEnd.longitude - segmentStart.longitude;
		const D = segmentEnd.latitude - segmentStart.latitude;
		  
		const dot = A * C + B * D;
		const lenSq = C * C + D * D;
		let param = -1;
		  
		if (lenSq !== 0) {
			param = dot / lenSq;
		}
		  
		let xx, yy;
		  
		if (param < 0) {
			xx = segmentStart.longitude;
			yy = segmentStart.latitude;
		} else if (param > 1) {
			xx = segmentEnd.longitude;
			yy = segmentEnd.latitude;
		} else {
			xx = segmentStart.longitude + param * C;
			yy = segmentStart.latitude + param * D;
		}
		  
		return { latitude: yy, longitude: xx };
	}
	
}