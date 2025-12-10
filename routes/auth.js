const express = require('express');
const authController = require('../controllers/authController.js');
const { authenticate, optionalAuth } = require('../middleware/auth.js');

const router = express.Router();

// Routes publiques
router.post('/login', authController.login);
router.post('/refresh', authController.refresh);
router.post('/logout', authenticate, authController.logout);

// Routes protégées
router.get('/profile', authenticate, authController.getProfile);
router.put('/profile', authenticate, authController.updateProfile);
router.get('/verify', authenticate, authController.verify);

// Route optionnelle (pour tests)
router.get('/public-profile', optionalAuth, (req, res) => {
  if (req.user) {
    res.json({
      success: true,
      data: {
        uid: req.user.uid,
        role: req.user.role,
        phone: req.user.phone_number
      }
    });
  } else {
    res.json({
      success: true,
      data: null,
      message: 'Aucun utilisateur authentifié'
    });
  }
});

module.exports = router;