// constants/rideStatus.js
const RIDE_STATUS = {
  REQUESTED: 'requested',           // Course créée
  MATCHING: 'matching',             // Recherche chauffeur
  ACCEPTED: 'accepted',             // Chauffeur assigné
  DRIVER_EN_ROUTE: 'driver_en_route', // Chauffeur en chemin pickup
  ARRIVED: 'arrived',               // Chauffeur arrivé pickup
  IN_PROGRESS: 'in_progress',       // Course en cours
  COMPLETED: 'completed',           // Course terminée
  CANCELLED: 'cancelled'            // Course annulée
};

const PAYMENT_STATUS = {
  PENDING: 'pending',
  PAID: 'paid',
  FAILED: 'failed',
  REFUNDED: 'refunded'
};

// Transitions autorisées
const ALLOWED_TRANSITIONS = {
  [RIDE_STATUS.REQUESTED]: [RIDE_STATUS.MATCHING, RIDE_STATUS.CANCELLED],
  [RIDE_STATUS.MATCHING]: [RIDE_STATUS.ACCEPTED, RIDE_STATUS.CANCELLED],
  [RIDE_STATUS.ACCEPTED]: [RIDE_STATUS.DRIVER_EN_ROUTE, RIDE_STATUS.CANCELLED],
  [RIDE_STATUS.DRIVER_EN_ROUTE]: [RIDE_STATUS.ARRIVED, RIDE_STATUS.CANCELLED],
  [RIDE_STATUS.ARRIVED]: [RIDE_STATUS.IN_PROGRESS, RIDE_STATUS.CANCELLED],
  [RIDE_STATUS.IN_PROGRESS]: [RIDE_STATUS.COMPLETED, RIDE_STATUS.CANCELLED],
  [RIDE_STATUS.COMPLETED]: [], // Statut final
  [RIDE_STATUS.CANCELLED]: []  // Statut final
};

// Horodatages associés aux statuts
const STATUS_TIMESTAMPS = {
  [RIDE_STATUS.REQUESTED]: 'requested_at',
  [RIDE_STATUS.ACCEPTED]: 'accepted_at',
  [RIDE_STATUS.DRIVER_EN_ROUTE]: 'driver_en_route_at',
  [RIDE_STATUS.ARRIVED]: 'driver_arrived_at',
  [RIDE_STATUS.IN_PROGRESS]: 'started_at',
  [RIDE_STATUS.COMPLETED]: 'completed_at',
  [RIDE_STATUS.CANCELLED]: 'cancelled_at'
};

module.exports = {
  RIDE_STATUS,
  PAYMENT_STATUS,
  ALLOWED_TRANSITIONS,
  STATUS_TIMESTAMPS
};