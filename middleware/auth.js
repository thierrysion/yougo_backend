const tokenService = require('../services/tokenService.js');
const { User } = require('../models/index.js');

// Middleware pour vérifier l'authentification
const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    //console.log("middleware authenticate pour s'assurer qu'un utilisateur est connecté");
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: 'Token d\'accès manquant',
        code: 'MISSING_TOKEN'
      });
    }

    const accessToken = authHeader.split(' ')[1];

    // Vérifier le token
    const tokenResult = tokenService.verifyAccessToken(accessToken);
    
    if (!tokenResult.success) {
      return res.status(401).json({
        success: false,
        error: 'Token d\'accès invalide',
        code: 'INVALID_TOKEN',
        details: tokenResult.error
      });
    }

    const { decoded } = tokenResult;

    // Récupérer l'utilisateur
    //console.log("l'uid de l'utilisateur est: " + decoded.uid);
    const user = await User.findByPk(decoded.uid);
    
    if (!user) {
      //console.log("on n'a pas retrouvé cet utilisateur en BD");
      return res.status(401).json({
        success: false,
        error: 'Utilisateur non trouvé',
        code: 'USER_NOT_FOUND'
      });
    }

    if (user.status !== 'active') {
      //console.log("le compte utilisateur n'est pas activé");
      return res.status(403).json({
        success: false,
        error: 'Compte suspendu ou inactif',
        code: 'ACCOUNT_SUSPENDED'
      });
    }
    //console.log("l'utilisateur connecté est ajouté à la requête : " + user.uid);
    // Ajouter l'utilisateur à la requête
    req.user = user;
    next();

  } catch (error) {
    console.error('❌ Erreur middleware authentification:', error);
    return res.status(500).json({
      success: false,
      error: 'Erreur d\'authentification',
      code: 'AUTH_ERROR'
    });
  }
};

// Middleware pour vérifier le rôle
const requireRole = (roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Authentification requise',
        code: 'AUTH_REQUIRED'
      });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        error: 'Accès non autorisé',
        code: 'ACCESS_DENIED',
        required: roles,
        current: req.user.role
      });
    }

    next();
  };
};

// Middleware pour les chauffeurs seulement
const requireDriver = requireRole(['driver', 'admin']);

// Middleware pour les administrateurs seulement
const requireAdmin = requireRole(['admin']);

// Middleware optionnel (pour les routes publiques avec info utilisateur si disponible)
const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const accessToken = authHeader.split(' ')[1];
      const tokenResult = tokenService.verifyAccessToken(accessToken);
      
      if (tokenResult.success) {
        const user = await User.findByPk(tokenResult.decoded.uid);
        if (user && user.status === 'active') {
          req.user = user;
        }
      }
    }

    next();
  } catch (error) {
    // En cas d'erreur, continuer sans utilisateur
    next();
  }
};

module.exports = { authenticate, requireRole, requireDriver, requireAdmin, optionalAuth };