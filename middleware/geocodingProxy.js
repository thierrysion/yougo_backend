// backend/middleware/geocodingProxy.js
const rateLimit = require('express-rate-limit');
const NodeCache = require('node-cache');
const { validationResult, body } = require('express-validator');

// Cache des résultats (10 minutes)
const geocodingCache = new NodeCache({ 
  stdTTL: 600, // 10 minutes
  checkperiod: 120,
  useClones: false
});

// Rate limiting par IP et par endpoint
const createGeocodingLimiter = (windowMs, max, message) => rateLimit({
  windowMs,
  max,
  message: { error: message },
  keyGenerator: (req) => {
    return `${req.ip}_${req.path}`;
  },
  handler: (req, res) => {
    res.status(429).json({
      error: message,
      retryAfter: Math.ceil(windowMs / 1000)
    });
  }
});

// Validation des paramètres
const validateAutocompleteRequest = [
  body('query')
    .isLength({ min: 2, max: 100 })
    .withMessage('La requête doit contenir entre 2 et 100 caractères')
    .trim()
    .escape(),
  body('sessionId')
    .optional()
    .isLength({ max: 50 })
    .withMessage('Session ID invalide')
    .trim(),
  body('userId')
    .optional()
    .isLength({ max: 50 })
    .withMessage('User ID invalide')
    .trim()
];

const validateGeocodingRequest = [
  body('address')
    .isLength({ min: 2, max: 200 })
    .withMessage('L\'adresse doit contenir entre 2 et 200 caractères')
    .trim()
    .escape(),
  body('placeId')
    .optional()
    .isLength({ max: 100 })
    .withMessage('Place ID invalide')
    .trim(),
  body('sessionId')
    .optional()
    .isLength({ max: 50 })
    .withMessage('Session ID invalide')
    .trim()
];

// Middleware d'authentification optionnelle
const optionalAuth = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    // Ici vous pouvez valider le token JWT
    req.userId = authHeader.split(' ')[1]; // Simplifié pour l'exemple
  }
  next();
};

// Proxy pour l'autocomplete
const autocompleteProxy = async (req, res) => {
  try {
    // Validation des erreurs
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        error: 'Requête invalide',
        details: errors.array() 
      });
    }

    const { query, sessionId } = req.body;
    const userId = req.userId;
    
    // Vérifier le cache d'abord
    const cacheKey = `autocomplete:${query.toLowerCase()}:${sessionId || userId || 'anonymous'}`;
    const cachedResult = geocodingCache.get(cacheKey);
    
    if (cachedResult) {
      console.log(`✅ Cache hit pour: ${query}`);
      return res.json(cachedResult);
    }

    // Timeout de sécurité
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    const response = await fetch(
      `https://maps.googleapis.com/maps/api/place/autocomplete/json?` +
      `input=${encodeURIComponent(query)}` +
      `&key=${process.env.GOOGLE_MAPS_API_KEY}` +
      `&types=geocode` +
      `&language=fr` +
      `&region=cm` +
      `&components=country:cm`,
      { 
        signal: controller.signal,
        headers: {
          'User-Agent': 'YouGo-Backend/1.0.0'
        }
      }
    );

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Google API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    // Log pour le monitoring
    console.log(`📍 Autocomplete: "${query}" → ${data.predictions?.length || 0} résultats`);

    // Mettre en cache uniquement les résultats valides
    if (data.status === 'OK' && data.predictions.length > 0) {
      // Limiter à 5 résultats pour économiser l'espace cache
      const limitedData = {
        ...data,
        predictions: data.predictions.slice(0, 5)
      };
      geocodingCache.set(cacheKey, limitedData);
    }

    res.json(data);
  } catch (error) {
    console.error('❌ Autocomplete proxy error:', error);
    
    if (error.name === 'AbortError') {
      res.status(504).json({ 
        error: 'Timeout de la requête de recherche d\'adresse',
        code: 'TIMEOUT_ERROR'
      });
    } else if (error.message.includes('Google API error')) {
      res.status(502).json({ 
        error: 'Service de géocodage temporairement indisponible',
        code: 'EXTERNAL_API_ERROR'
      });
    } else {
      res.status(500).json({ 
        error: 'Erreur interne du serveur',
        code: 'INTERNAL_SERVER_ERROR'
      });
    }
  }
};

// Proxy pour le géocodage
const geocodingProxy = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        error: 'Requête invalide',
        details: errors.array() 
      });
    }

    const { address, placeId, sessionId } = req.body;
    const userId = req.userId;

    // Vérifier le cache
    const cacheKey = `geocode:${placeId || address}:${sessionId || userId || 'anonymous'}`;
    const cachedResult = geocodingCache.get(cacheKey);
    
    if (cachedResult) {
      console.log(`✅ Cache hit pour: ${placeId || address}`);
      return res.json(cachedResult);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    let url;
    if (placeId) {
      url = `https://maps.googleapis.com/maps/api/geocode/json?` +
            `place_id=${placeId}` +
            `&key=${process.env.GOOGLE_MAPS_API_KEY}` +
            `&language=fr` +
            `&region=cm`;
    } else {
      url = `https://maps.googleapis.com/maps/api/geocode/json?` +
            `address=${encodeURIComponent(address)}` +
            `&key=${process.env.GOOGLE_MAPS_API_KEY}` +
            `&language=fr` +
            `&region=cm`;
    }

    const response = await fetch(url, { 
      signal: controller.signal,
      headers: {
        'User-Agent': 'UberVTC-Backend/1.0.0'
      }
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Google API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    console.log(`📍 Géocodage: "${address}" → ${data.results?.length || 0} résultats`);

    // Mettre en cache les résultats valides
    if (data.status === 'OK' && data.results.length > 0) {
      geocodingCache.set(cacheKey, data);
    }

    res.json(data);
  } catch (error) {
    console.error('❌ Geocoding proxy error:', error);
    
    if (error.name === 'AbortError') {
      res.status(504).json({ 
        error: 'Timeout de la requête de géocodage',
        code: 'TIMEOUT_ERROR'
      });
    } else {
      res.status(500).json({ 
        error: 'Erreur interne du serveur',
        code: 'INTERNAL_SERVER_ERROR'
      });
    }
  }
};

module.exports = {
  autocompleteProxy,
  geocodingProxy,
  createGeocodingLimiter,
  validateAutocompleteRequest,
  validateGeocodingRequest,
  optionalAuth
};