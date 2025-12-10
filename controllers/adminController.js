// controllers/adminController.js
const { User, Ride, Driver, Payment } = require('../models');

class AdminController {
  constructor(adminService) {
    this.adminService = adminService;
  }

  /**
   * Middleware de vérification des droits admin
   */
  async checkAdminAccess(req, res, next) {
    try {
      if (req.user.role !== 'admin') {
        return res.status(403).json({
          success: false,
          error: 'Accès réservé aux administrateurs'
        });
      }
      next();
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Erreur de vérification des droits'
      });
    }
  }

  /**
   * Statistiques générales du dashboard
   */
  async getDashboardStats(req, res) {
    try {
      const { range = '7d' } = req.query;

      const stats = await this.adminService.getPlatformStats(range);

      res.json({
        success: true,
        data: stats,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('Erreur statistiques dashboard:', error);
      res.status(500).json({
        success: false,
        error: 'Erreur lors de la récupération des statistiques'
      });
    }
  }

  /**
   * Statistiques détaillées des courses
   */
  async getRideAnalytics(req, res) {
    try {
      const { range = '7d' } = req.query;

      const analytics = await this.adminService.getRideStats(range);

      res.json({
        success: true,
        data: analytics,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('Erreur analytics courses:', error);
      res.status(500).json({
        success: false,
        error: 'Erreur lors de la récupération des analytics'
      });
    }
  }

  /**
   * Statistiques financières
   */
  async getFinancialAnalytics(req, res) {
    try {
      const { range = '30d' } = req.query;

      const analytics = await this.adminService.getFinancialStats(range);

      res.json({
        success: true,
        data: analytics,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('Erreur analytics financiers:', error);
      res.status(500).json({
        success: false,
        error: 'Erreur lors de la récupération des données financières'
      });
    }
  }

  /**
   * Statistiques utilisateurs
   */
  async getUserAnalytics(req, res) {
    try {
      const { range = '30d' } = req.query;

      const analytics = await this.adminService.getUserStats(range);

      res.json({
        success: true,
        data: analytics,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('Erreur analytics utilisateurs:', error);
      res.status(500).json({
        success: false,
        error: 'Erreur lors de la récupération des données utilisateurs'
      });
    }
  }

  /**
   * Statistiques chauffeurs
   */
  async getDriverAnalytics(req, res) {
    try {
      const { range = '30d' } = req.query;

      const analytics = await this.adminService.getDriverStats(range);

      res.json({
        success: true,
        data: analytics,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('Erreur analytics chauffeurs:', error);
      res.status(500).json({
        success: false,
        error: 'Erreur lors de la récupération des données chauffeurs'
      });
    }
  }

  /**
   * Données en temps réel
   */
  async getRealtimeData(req, res) {
    try {
      const data = await this.adminService.getRealtimeData();

      res.json({
        success: true,
        data,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('Erreur données temps réel:', error);
      res.status(500).json({
        success: false,
        error: 'Erreur lors de la récupération des données temps réel'
      });
    }
  }

  /**
   * Santé du système
   */
  async getSystemHealth(req, res) {
    try {
      const health = await this.adminService.getSystemHealth();

      res.json({
        success: true,
        data: health,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('Erreur santé système:', error);
      res.status(500).json({
        success: false,
        error: 'Erreur lors de la vérification de la santé du système'
      });
    }
  }

  /**
   * Liste des utilisateurs avec pagination et filtres
   */
  async getUsers(req, res) {
    try {
      const { 
        page = 1, 
        limit = 20, 
        search = '',
        status = '',
        role = '',
        sortBy = 'created_at',
        sortOrder = 'DESC'
      } = req.query;

      const offset = (parseInt(page) - 1) * parseInt(limit);

      const where = {};
      if (search) {
        where[Op.or] = [
          { first_name: { [Op.iLike]: `%${search}%` } },
          { last_name: { [Op.iLike]: `%${search}%` } },
          { email: { [Op.iLike]: `%${search}%` } },
          { phone_number: { [Op.iLike]: `%${search}%` } }
        ];
      }

      if (status) {
        where.status = status;
      }

      if (role) {
        where.role = role;
      }

      const { count, rows: users } = await User.findAndCountAll({
        where,
        attributes: [
          'uid', 'first_name', 'last_name', 'email', 'phone_number', 
          'role', 'status', 'customer_rating', 'created_at', 'last_login_at'
        ],
        order: [[sortBy, sortOrder]],
        limit: parseInt(limit),
        offset: offset
      });

      res.json({
        success: true,
        data: {
          users,
          pagination: {
            total: count,
            page: parseInt(page),
            limit: parseInt(limit),
            pages: Math.ceil(count / parseInt(limit))
          }
        }
      });

    } catch (error) {
      console.error('Erreur liste utilisateurs:', error);
      res.status(500).json({
        success: false,
        error: 'Erreur lors de la récupération des utilisateurs'
      });
    }
  }

  /**
   * Liste des chauffeurs avec pagination et filtres
   */
  async getDrivers(req, res) {
    try {
      const { 
        page = 1, 
        limit = 20, 
        search = '',
        status = '',
        driver_status = '',
        sortBy = 'created_at',
        sortOrder = 'DESC'
      } = req.query;

      const offset = (parseInt(page) - 1) * parseInt(limit);

      const userWhere = {};
      const driverWhere = {};

      if (search) {
        userWhere[Op.or] = [
          { first_name: { [Op.iLike]: `%${search}%` } },
          { last_name: { [Op.iLike]: `%${search}%` } },
          { email: { [Op.iLike]: `%${search}%` } },
          { phone_number: { [Op.iLike]: `%${search}%` } }
        ];
      }

      if (status) {
        userWhere.status = status;
      }

      if (driver_status) {
        driverWhere.driver_status = driver_status;
      }

      const { count, rows: drivers } = await Driver.findAndCountAll({
        where: driverWhere,
        include: [{
          model: User,
          as: 'user',
          where: userWhere,
          attributes: [
            'uid', 'first_name', 'last_name', 'email', 'phone_number', 
            'status', 'created_at'
          ]
        }],
        order: [[sortBy, sortOrder]],
        limit: parseInt(limit),
        offset: offset
      });

      res.json({
        success: true,
        data: {
          drivers: drivers.map(driver => ({
            ...driver.toJSON(),
            user: driver.user
          })),
          pagination: {
            total: count,
            page: parseInt(page),
            limit: parseInt(limit),
            pages: Math.ceil(count / parseInt(limit))
          }
        }
      });

    } catch (error) {
      console.error('Erreur liste chauffeurs:', error);
      res.status(500).json({
        success: false,
        error: 'Erreur lors de la récupération des chauffeurs'
      });
    }
  }

  /**
   * Liste des courses avec pagination et filtres
   */
  async getRides(req, res) {
    try {
      const { 
        page = 1, 
        limit = 20, 
        search = '',
        status = '',
        payment_status = '',
        date_from = '',
        date_to = '',
        sortBy = 'created_at',
        sortOrder = 'DESC'
      } = req.query;

      const offset = (parseInt(page) - 1) * parseInt(limit);

      const where = {};

      if (status) {
        where.status = status;
      }

      if (payment_status) {
        where.payment_status = payment_status;
      }

      if (date_from || date_to) {
        where.created_at = {};
        if (date_from) where.created_at[Op.gte] = new Date(date_from);
        if (date_to) where.created_at[Op.lte] = new Date(date_to);
      }

      const { count, rows: rides } = await Ride.findAndCountAll({
        where,
        include: [
          {
            model: User,
            as: 'customer',
            attributes: ['uid', 'first_name', 'last_name', 'phone_number']
          },
          {
            model: Driver,
            include: [{
              model: User,
              as: 'user',
              attributes: ['uid', 'first_name', 'last_name']
            }],
            required: false
          },
          {
            model: Payment,
            as: 'payments',
            required: false
          }
        ],
        order: [[sortBy, sortOrder]],
        limit: parseInt(limit),
        offset: offset
      });

      res.json({
        success: true,
        data: {
          rides,
          pagination: {
            total: count,
            page: parseInt(page),
            limit: parseInt(limit),
            pages: Math.ceil(count / parseInt(limit))
          }
        }
      });

    } catch (error) {
      console.error('Erreur liste courses:', error);
      res.status(500).json({
        success: false,
        error: 'Erreur lors de la récupération des courses'
      });
    }
  }

  /**
   * Export des données
   */
  async exportData(req, res) {
    try {
      const { type, format = 'json', range = '30d' } = req.query;

      if (!['rides', 'users', 'drivers', 'payments'].includes(type)) {
        return res.status(400).json({
          success: false,
          error: 'Type d\'export non supporté'
        });
      }

      let data;
      const { startDate, endDate } = this.adminService.getDateRange(range);

      switch (type) {
        case 'rides':
          data = await Ride.findAll({
            where: { created_at: { [Op.between]: [startDate, endDate] } },
            include: [
              { model: User, as: 'customer' },
              { 
                model: Driver, 
                include: [{ model: User, as: 'user' }]
              }
            ]
          });
          break;

        case 'users':
          data = await User.findAll({
            where: { created_at: { [Op.between]: [startDate, endDate] } }
          });
          break;

        case 'drivers':
          data = await Driver.findAll({
            where: { created_at: { [Op.between]: [startDate, endDate] } },
            include: [{ model: User, as: 'user' }]
          });
          break;

        case 'payments':
          data = await Payment.findAll({
            where: { created_at: { [Op.between]: [startDate, endDate] } },
            include: [
              { model: User, as: 'user' },
              { model: Ride, as: 'ride' }
            ]
          });
          break;
      }

      if (format === 'csv') {
        // Implémentation simplifiée de conversion CSV
        const csv = this.convertToCSV(data);
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=${type}_${range}.csv`);
        return res.send(csv);
      }

      res.json({
        success: true,
        data,
        export_info: {
          type,
          format,
          range,
          record_count: data.length,
          exported_at: new Date().toISOString()
        }
      });

    } catch (error) {
      console.error('Erreur export données:', error);
      res.status(500).json({
        success: false,
        error: 'Erreur lors de l\'export des données'
      });
    }
  }

  /**
   * Conversion des données en CSV
   */
  convertToCSV(data) {
    if (!data || data.length === 0) return '';

    const headers = Object.keys(data[0].toJSON ? data[0].toJSON() : data[0]);
    const csvRows = [headers.join(',')];

    data.forEach(item => {
      const values = headers.map(header => {
        const value = item[header];
        return typeof value === 'string' && value.includes(',') 
          ? `"${value}"` 
          : value;
      });
      csvRows.push(values.join(','));
    });

    return csvRows.join('\n');
  }
}

module.exports = AdminController;