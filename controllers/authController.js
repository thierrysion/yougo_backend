const authService = require('../services/authService.js');

class AuthController {
  // Connexion avec Firebase
  async login(req, res) {
    try {
      const { firebase_id_token, uid } = req.body;
      
      if (!firebase_id_token || !uid) {
        return res.status(400).json({
          success: false,
          error: 'Token Firebase et UID requis',
          code: 'FIREBASE_TOKEN_AND_UID_REQUIRED'
        });
      }

      const ipAddress = req.ip || req.connection.remoteAddress;
      const userAgent = req.get('User-Agent');

      const result = await authService.authenticateWithFirebase(
        firebase_id_token,
		uid,
        ipAddress,
        userAgent
      );

      if (!result.success) {
		console.error('❌ Echec tentative de connexion:', result.error, result.details);
        return res.status(401).json({
          success: false,
          error: result.error,
          code: 'AUTH_FAILED',
          details: result.details
        });
      }

      res.json({
        success: true,
        message: 'Connexion réussie',
        data: result.data
      });

    } catch (error) {
      console.error('❌ Erreur contrôleur login:', error);
      res.status(500).json({
        success: false,
        error: 'Erreur lors de la connexion',
        code: 'LOGIN_ERROR'
      });
    }
  }

  // Rafraîchir les tokens
  async refresh(req, res) {
    try {
      const { refresh_token } = req.body;
      
      if (!refresh_token) {
        return res.status(400).json({
          success: false,
          error: 'Refresh token requis',
          code: 'REFRESH_TOKEN_REQUIRED'
        });
      }

      const ipAddress = req.ip || req.connection.remoteAddress;
      const userAgent = req.get('User-Agent');

      const result = await authService.refreshTokens(
        refresh_token,
        ipAddress,
        userAgent
      );

      if (!result.success) {
        return res.status(401).json({
          success: false,
          error: result.error,
          code: 'REFRESH_FAILED'
        });
      }

      res.json({
        success: true,
        message: 'Tokens rafraîchis avec succès',
        data: result.data
      });

    } catch (error) {
      console.error('❌ Erreur contrôleur refresh:', error);
      res.status(500).json({
        success: false,
        error: 'Erreur lors du rafraîchissement des tokens',
        code: 'REFRESH_ERROR'
      });
    }
  }

  // Déconnexion
  async logout(req, res) {
    try {
      const { refresh_token } = req.body;
      const userId = req.user?.uid;

      const result = await authService.logout(refresh_token, userId);

      if (!result.success) {
        return res.status(400).json({
          success: false,
          error: result.error,
          code: 'LOGOUT_FAILED',
          details: result.details
        });
      }

      res.json({
        success: true,
        message: result.message
      });

    } catch (error) {
      console.error('❌ Erreur contrôleur logout:', error);
      res.status(500).json({
        success: false,
        error: 'Erreur lors de la déconnexion',
        code: 'LOGOUT_ERROR'
      });
    }
  }

  // Récupérer le profil utilisateur
  async getProfile(req, res) {
    try {
      const result = await authService.getUserProfile(req.user.uid);

      if (!result.success) {
        return res.status(404).json({
          success: false,
          error: result.error,
          code: 'PROFILE_NOT_FOUND'
        });
      }

      res.json({
        success: true,
        data: result.data
      });

    } catch (error) {
      console.error('❌ Erreur contrôleur getProfile:', error);
      res.status(500).json({
        success: false,
        error: 'Erreur lors de la récupération du profil',
        code: 'PROFILE_ERROR'
      });
    }
  }

  // Mettre à jour le profil utilisateur
  async updateProfile(req, res) {
    try {
      const result = await authService.updateUserProfile(req.user.uid, req.body);

      if (!result.success) {
        return res.status(400).json({
          success: false,
          error: result.error,
          code: 'UPDATE_PROFILE_FAILED',
          details: result.details
        });
      }

      res.json({
        success: true,
        message: result.message,
        data: result.data
      });

    } catch (error) {
      console.error('❌ Erreur contrôleur updateProfile:', error);
      res.status(500).json({
        success: false,
        error: 'Erreur lors de la mise à jour du profil',
        code: 'UPDATE_PROFILE_ERROR'
      });
    }
  }

  // Vérifier l'authentification (pour les tests)
  async verify(req, res) {
    try {
      res.json({
        success: true,
        message: 'Token valide',
        data: {
          user: {
            uid: req.user.uid,
            role: req.user.role,
            phone: req.user.phone_number
          }
        }
      });
    } catch (error) {
      console.error('❌ Erreur contrôleur verify:', error);
      res.status(500).json({
        success: false,
        error: 'Erreur de vérification',
        code: 'VERIFY_ERROR'
      });
    }
  }
}

module.exports =  new AuthController();