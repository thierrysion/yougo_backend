// backend/routes/geocoding.js
const express = require('express');
const router = express.Router();
const {
  autocompleteProxy,
  geocodingProxy,
  createGeocodingLimiter,
  validateAutocompleteRequest,
  validateGeocodingRequest,
  optionalAuth
} = require('../middleware/geocodingProxy');

// Rate limiting différencié
const autocompleteLimiter = createGeocodingLimiter(
  60 * 1000, // 1 minute
  30, // 30 requêtes par minute
  'Trop de requêtes de recherche d\'adresse'
);

const geocodingLimiter = createGeocodingLimiter(
  60 * 1000, // 1 minute
  20, // 20 requêtes par minute
  'Trop de requêtes de géocodage'
);

// Routes avec sécurité
router.post(
  '/autocomplete',
  optionalAuth,
  autocompleteLimiter,
  validateAutocompleteRequest,
  autocompleteProxy
);

router.post(
  '/geocode',
  optionalAuth,
  geocodingLimiter,
  validateGeocodingRequest,
  geocodingProxy
);

// Endpoint de santé
router.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    service: 'Geocoding Proxy',
    version: '1.0.0'
  });
});

// Statistiques (protégé en production)
router.get('/stats', optionalAuth, (req, res) => {
  // Ici vous pourriez retourner des métriques
  res.json({
    cacheStats: {
      // Statistiques du cache
    },
    usage: {
      // Métriques d'utilisation
    }
  });
});

module.exports = router;