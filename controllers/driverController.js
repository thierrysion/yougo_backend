// controllers/driverController.js
const { randomUUID } = require('crypto');
const { Op } = require('sequelize');
const { Driver, User, Ride, RideType, sequelize } = require('../models');

class DriverController {
  constructor(socketService) {
    this.socketService = socketService;
  }
	
  async updateDriverStatus(req, res) {
	try {
		const { isOnline, location } = req.body;
		const driverId = req.user.uid;

		// Vérifier que l'utilisateur est bien un driver // Nous l'avons fait en utilisant le middleware requireDriver pour cette route
		/*const user = await User.findByPk(driverId);
		if (!user || user.role !== 'driver') {
		  return res.status(403).json({
			success: false,
			error: 'Accès réservé aux chauffeurs'
		  });
		}*/

		// Mettre à jour le statut du driver
		const driver = await Driver.findOne({ where: { user_id: driverId } });
		
		if (!driver) {
		  return res.status(404).json({
			success: false,
			error: 'Profil driver non trouvé'
		  });
		}

		const updateData = {
		  is_online: isOnline,
		  online_since: isOnline ? new Date() : null
		};

		// Si une location est fournie, la mettre à jour
		if (location && location.lat && location.lng) {
		  updateData.current_location = sequelize.fn('ST_GeomFromText', `POINT(${location.lng} ${location.lat})`), /*{
			type: 'Point',
			coordinates: [location.lng, location.lat]
		  };*/
		  updateData.last_location_update = new Date();
		}

		await driver.update(updateData);

		res.json({
		  success: true,
		  message: `Statut mis à jour: ${isOnline ? 'En ligne' : 'Hors ligne'}`,
		  driver: {
			id: driverId,
			isOnline,
			location: location,
			onlineSince: updateData.onlineSince
		  }
		});

	  } catch (error) {
		console.error('Erreur mise à jour statut driver:', error);
		res.status(500).json({
		  success: false,
		  error: 'Erreur lors de la mise à jour du statut'
		});
	  }
  }

  async getDriverActiveRides(req, res) {
    try {
      const driverId = req.user.uid;

      // Vérifier que l'utilisateur est un driver
      /*const user = await User.findByPk(driverId);
      if (!user || user.role !== 'driver') {
        return res.status(403).json({
          success: false,
          error: 'Accès réservé aux chauffeurs'
        });
      }*/

      // Récupérer les courses actives
      const activeRides = await Ride.findAll({
        where: {
          driver_id: driverId,
          status: {
            [Op.in]: ['accepted', 'in_progress'] // Courses acceptées ou en cours
          }
        },
        include: [
          { 
            model: User, 
            as: 'customer',
            attributes: ['uid', 'first_name', 'last_name', 'phone_number', 'profile_picture_url']
          },
          { 
            model: RideType,
			as: 'ride_type',
            attributes: ['id', 'name'/*, 'description', 'icon'*/]
          }
        ],
        order: [['createdAt', 'DESC']]
      });

      res.json({
        success: true,
        rides: activeRides.map(ride => ride.toJSON())
      });

    } catch (error) {
      console.error('Erreur récupération courses actives:', error);
      res.status(500).json({
        success: false,
        error: 'Erreur lors de la récupération des courses',
        code: 'INTERNAL_SERVER_ERROR',
        details: error.message
      });
    }
  }
  
}

module.exports = DriverController;