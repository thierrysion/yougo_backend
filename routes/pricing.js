// routes/pricing.js
const express = require('express');
const router = express.Router();
const pricingController = require('../controllers/pricingController');
const { authenticate } = require('../middleware/auth');

// GET /api/pricing/calculate
router.use(authenticate);
router.post('/calculate', pricingController.calculateRidePrices);

module.exports = router;