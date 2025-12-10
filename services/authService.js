const { User, Driver } = require('../models/index.js');
const { verifyFirebaseToken, getFirebaseUser } = require('../utils/firebase.js');
const tokenService = require('./tokenService.js');

class AuthService {
  // Authentifier un utilisateur avec Firebase
  async authenticateWithFirebase(firebaseIdToken, uidSent, ipAddress = null, userAgent = null) {
    try {
      // Vérifier le token Firebase
      const firebaseResult = await verifyFirebaseToken(firebaseIdToken);
      
      if (!firebaseResult.success) {
        return {
          success: false,
          error: 'Token Firebase invalide',
          details: firebaseResult.error
        };
      }

      const { uid, phone } = firebaseResult;
	  
	  if(uidSent != uid) {
		return {
			success: false,
			error: 'UID ne correspond pas',
			details: "le token fournit n'est pas celui de l'utilisateur spécifié",
		  };  
	  }

      // Vérifier si l'utilisateur existe déjà
      let user = await User.findByPk(uid);

      if (!user) {
        // Créer un nouvel utilisateur (customer par défaut)
        user = await User.create({
          uid: uid,
          phone_number: phone,
          role: 'customer',
          status: 'active'
        });

        console.log(`👤 Nouvel utilisateur créé: ${uid}`);
      } else {
        // Mettre à jour la dernière connexion
        await user.update({ last_login_at: new Date() });
      }

      // Générer les tokens JWT
	  let payload = {
        uid: user.uid,
        role: user.role,
        phone: user.phone_number
      };
      const accessToken = tokenService.generateAccessToken(payload);

      const refreshToken = tokenService.generateRefreshToken(payload);

      // Sauvegarder le refresh token
      await tokenService.saveRefreshToken(
        user.uid, 
        refreshToken, 
        ipAddress, 
        userAgent
      );

      // Récupérer le profil complet
      const userProfile = await this.getUserProfile(user.uid);

      return {
        success: true,
        data: {
          user: userProfile,
          tokens: {
            access_token: accessToken,
            refresh_token: refreshToken,
            expires_in: 900 // 15 minutes en secondes
          }
        }
      };

    } catch (error) {
      console.error('❌ Erreur authentification Firebase:', error);
      return {
        success: false,
        error: 'Erreur lors de l\'authentification',
        details: error.message
      };
    }
  }

  // Rafraîchir les tokens
  async refreshTokens(refreshToken, ipAddress = null, userAgent = null) {
    try {
      // Vérifier le refresh token
      const tokenResult = await tokenService.verifyRefreshToken(refreshToken);
      
      if (!tokenResult.success) {
        return {
          success: false,
          error: tokenResult.error
        };
      }

      const { user } = tokenResult;

      // Révoquer l'ancien refresh token
      await tokenService.revokeRefreshToken(refreshToken);

      // Générer de nouveaux tokens
      const accessToken = tokenService.generateAccessToken({
        uid: user.uid,
        role: user.role,
        phone: user.phone_number
      });

      const newRefreshToken = tokenService.generateRefreshToken({
        uid: user.uid,
        role: user.role,
        phone: user.phone_number
      });

      // Sauvegarder le nouveau refresh token
      await tokenService.saveRefreshToken(
        user.uid, 
        newRefreshToken, 
        ipAddress, 
        userAgent
      );

      // Récupérer le profil complet
      const userProfile = await this.getUserProfile(user.uid);

      return {
        success: true,
        data: {
          user: userProfile,
          tokens: {
            access_token: accessToken,
            refresh_token: newRefreshToken,
            expires_in: 900
          }
        }
      };

    } catch (error) {
      console.error('❌ Erreur rafraîchissement tokens:', error);
      return {
        success: false,
        error: 'Erreur lors du rafraîchissement des tokens',
        details: error.message
      };
    }
  }

  // Déconnexion
  async logout(refreshToken, userId = null) {
    try {
      // Révoquer le refresh token spécifique
      if (refreshToken) {
        await tokenService.revokeRefreshToken(refreshToken);
      }

      // Révoquer tous les tokens de l'utilisateur
      if (userId) {
        await tokenService.revokeAllUserTokens(userId);
      }

      return {
        success: true,
        message: 'Déconnexion réussie'
      };

    } catch (error) {
      console.error('❌ Erreur déconnexion:', error);
      return {
        success: false,
        error: 'Erreur lors de la déconnexion',
        details: error.message
      };
    }
  }

  // Récupérer le profil utilisateur complet
  async getUserProfile(userId) {
    try {
      const user = await User.findByPk(userId, {
        attributes: { exclude: [] },
        include: [
          {
            association: 'driver_profile',
            include: ['ride_type']
          }
        ]
      });

      if (!user) {
        return {
          success: false,
          error: 'Utilisateur non trouvé'
        };
      }

      // Formater la réponse
      const profile = {
        uid: user.uid,
        phoneNumber: user.phone_number,
        role: user.role,
        status: user.status,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        profileImage: user.profile_picture_url,
        rating: user.customer_rating,
        customerRatingCount: user.customer_rating_count,
        createdAt: user.created_at,
        lastLoginAt: user.last_login_at
      };

      // Ajouter les infos chauffeur si applicable
      if (user.driver_profile) {
        //let driverLocation = user.driver_profile.current_location;
        //console.log(user.driver_profile.current_location.coordinates);
        //
        profile.driverProfile = {
          licenseNumber: user.driver_profile.driver_license_number,
          licenseExpiryDate: user.driver_profile.license_expiry_date,
          yearsOfExperience: user.driver_profile.years_of_experience,
          driverStatus: user.driver_profile.driver_status,
          vehicleMake: user.driver_profile.vehicle_make,
          vehicleModel: user.driver_profile.vehicle_model,
          licensePlate: user.driver_profile.license_plate,
          vehicleColor: user.driver_profile.vehicle_color,
          vehicleYear: user.driver_profile.vehicle_year,
          currentLocation: user.driver_profile.current_location ? { "latitude": user.driver_profile.current_location.coordinates[1], "longitude": user.driver_profile.current_location.coordinates[0]} : null,
          currentZone: user.driver_profile.current_zone,
          isOnline: user.driver_profile.is_online,
          onlineSince: user.driver_profile.online_since,
          driverRating: user.driver_profile.driver_rating,
          driverRatingCount: user.driver_profile.driver_rating_count,
          totalCompletedRides: user.driver_profile.total_completed_rides,
          acceptanceRate: user.driver_profile.acceptance_rate,
          cancellationRate: user.driver_profile.cancellation_rate,
          rideType: user.driver_profile.ride_type,
          approvedAt: user.driver_profile.approved_at,
          isApproved: user.driver_profile.driverStatus === 'approved' ? true : false,
        };
      }

      return {
        success: true,
        data: profile
      };

    } catch (error) {
      console.error('❌ Erreur récupération profil:', error);
      return {
        success: false,
        error: 'Erreur lors de la récupération du profil',
        details: error.message
      };
    }
  }

  // Mettre à jour le profil utilisateur
  async updateUserProfile(userId, updateData) {
    try {
      const user = await User.findByPk(userId);
      
      if (!user) {
        return {
          success: false,
          error: 'Utilisateur non trouvé'
        };
      }

      // Champs autorisés pour la mise à jour
      const allowedFields = [
        'email', 
        'first_name', 
        'last_name', 
        'profile_picture_url'
      ];

      const updates = {};
      allowedFields.forEach(field => {
        if (updateData[field] !== undefined) {
          updates[field] = updateData[field];
        }
      });

      await user.update(updates);

      // Récupérer le profil mis à jour
      const updatedProfile = await this.getUserProfile(userId);

      return {
        success: true,
        data: updatedProfile.data,
        message: 'Profil mis à jour avec succès'
      };

    } catch (error) {
      console.error('❌ Erreur mise à jour profil:', error);
      return {
        success: false,
        error: 'Erreur lors de la mise à jour du profil',
        details: error.message
      };
    }
  }
}

module.exports = new AuthService();