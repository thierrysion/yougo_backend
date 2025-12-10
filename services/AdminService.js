// services/AdminService.js
const { 
  Ride, User, Driver, Payment, ChatMessage, Notification,
  Sequelize, 
  Op 
} = require('../models');

class AdminService {
  constructor() {
    this.sequelize = Sequelize;
  }

  /**
   * Statistiques générales de la plateforme
   */
  async getPlatformStats(dateRange = '7d') {
    try {
      const { startDate, endDate } = this.getDateRange(dateRange);
      
      const [
        totalUsers,
        totalDrivers,
        totalRides,
        totalRevenue,
        activeUsers,
        activeDrivers,
        pendingRides,
        completedRidesToday
      ] = await Promise.all([
        // Utilisateurs totaux
        User.count(),
        
        // Chauffeurs totaux
        Driver.count(),
        
        // Courses totales
        Ride.count(),
        
        // Revenus totaux
        Payment.sum('amount', {
          where: { 
            payment_status: 'completed',
            created_at: { [Op.between]: [startDate, endDate] }
          }
        }),
        
        // Utilisateurs actifs (ayant fait au moins une course dans la période)
        User.count({
          distinct: true,
          include: [{
            model: Ride,
            as: 'customerRides',
            where: { 
              created_at: { [Op.between]: [startDate, endDate] }
            },
            required: true
          }]
        }),
        
        // Chauffeurs actifs (en ligne ou ayant fait une course récemment)
        Driver.count({
          where: {
            [Op.or]: [
              { is_online: true },
              { updated_at: { [Op.gte]: new Date(Date.now() - 24 * 60 * 60 * 1000) } }
            ]
          }
        }),
        
        // Courses en attente
        Ride.count({
          where: { 
            status: ['requested', 'matching', 'accepted'],
            created_at: { [Op.between]: [startDate, endDate] }
          }
        }),
        
        // Courses terminées aujourd'hui
        Ride.count({
          where: { 
            status: 'completed',
            created_at: { 
              [Op.between]: [
                new Date(new Date().setHours(0, 0, 0, 0)),
                new Date(new Date().setHours(23, 59, 59, 999))
              ]
            }
          }
        })
      ]);

      return {
        users: {
          total: totalUsers,
          active: activeUsers,
          growth: await this.calculateGrowthRate(User, dateRange)
        },
        drivers: {
          total: totalDrivers,
          active: activeDrivers,
          online: await Driver.count({ where: { is_online: true } }),
          growth: await this.calculateGrowthRate(Driver, dateRange)
        },
        rides: {
          total: totalRides,
          pending: pendingRides,
          completed_today: completedRidesToday,
          growth: await this.calculateGrowthRate(Ride, dateRange)
        },
        revenue: {
          total: totalRevenue || 0,
          today: await this.getTodayRevenue(),
          growth: await this.calculateRevenueGrowth(dateRange)
        },
        period: {
          start: startDate,
          end: endDate,
          range: dateRange
        }
      };

    } catch (error) {
      console.error('Erreur statistiques plateforme:', error);
      throw error;
    }
  }

  /**
   * Statistiques détaillées des courses
   */
  async getRideStats(dateRange = '7d') {
    try {
      const { startDate, endDate } = this.getDateRange(dateRange);

      const [
        totalRides,
        completedRides,
        cancelledRides,
        averageRating,
        averageDuration,
        averageDistance,
        revenueByStatus,
        ridesByHour
      ] = await Promise.all([
        Ride.count({
          where: { created_at: { [Op.between]: [startDate, endDate] } }
        }),
        
        Ride.count({
          where: { 
            status: 'completed',
            created_at: { [Op.between]: [startDate, endDate] }
          }
        }),
        
        Ride.count({
          where: { 
            status: 'cancelled',
            created_at: { [Op.between]: [startDate, endDate] }
          }
        }),
        
        Ride.findOne({
          attributes: [
            [this.sequelize.fn('AVG', this.sequelize.col('customer_rating')), 'avg_rating']
          ],
          where: { 
            status: 'completed',
            created_at: { [Op.between]: [startDate, endDate] }
          }
        }),
        
        Ride.findOne({
          attributes: [
            [this.sequelize.fn('AVG', this.sequelize.col('final_duration_minutes')), 'avg_duration']
          ],
          where: { 
            status: 'completed',
            created_at: { [Op.between]: [startDate, endDate] }
          }
        }),
        
        Ride.findOne({
          attributes: [
            [this.sequelize.fn('AVG', this.sequelize.col('final_distance_km')), 'avg_distance']
          ],
          where: { 
            status: 'completed',
            created_at: { [Op.between]: [startDate, endDate] }
          }
        }),
        
        this.getRevenueByStatus(dateRange),
        
        this.getRidesByHour(dateRange)
      ]);

      const completionRate = totalRides > 0 ? (completedRides / totalRides) * 100 : 0;
      const cancellationRate = totalRides > 0 ? (cancelledRides / totalRides) * 100 : 0;

      return {
        summary: {
          total: totalRides,
          completed: completedRides,
          cancelled: cancelledRides,
          completion_rate: Math.round(completionRate * 100) / 100,
          cancellation_rate: Math.round(cancellationRate * 100) / 100
        },
        averages: {
          rating: parseFloat(averageRating?.get('avg_rating') || 0).toFixed(1),
          duration: Math.round(averageDuration?.get('avg_duration') || 0),
          distance: parseFloat(averageDistance?.get('avg_distance') || 0).toFixed(2)
        },
        revenue: revenueByStatus,
        hourly_distribution: ridesByHour,
        timeline: await this.getRidesTimeline(dateRange)
      };

    } catch (error) {
      console.error('Erreur statistiques courses:', error);
      throw error;
    }
  }

  /**
   * Statistiques financières
   */
  async getFinancialStats(dateRange = '30d') {
    try {
      const { startDate, endDate } = this.getDateRange(dateRange);

      const [
        totalRevenue,
        totalCommission,
        successfulPayments,
        failedPayments,
        refundedAmount,
        revenueByMethod,
        dailyRevenue
      ] = await Promise.all([
        // Revenu total
        Payment.sum('amount', {
          where: { 
            payment_status: 'completed',
            created_at: { [Op.between]: [startDate, endDate] }
          }
        }),
        
        // Commission totale (20% du revenu)
        Payment.sum('amount', {
          where: { 
            payment_status: 'completed',
            created_at: { [Op.between]: [startDate, endDate] }
          }
        }).then(amount => (amount || 0) * 0.2),
        
        // Paiements réussis
        Payment.count({
          where: { 
            payment_status: 'completed',
            created_at: { [Op.between]: [startDate, endDate] }
          }
        }),
        
        // Paiements échoués
        Payment.count({
          where: { 
            payment_status: 'failed',
            created_at: { [Op.between]: [startDate, endDate] }
          }
        }),
        
        // Montant remboursé
        Payment.sum('refunded_amount', {
          where: { 
            payment_status: ['refunded', 'partially_refunded'],
            created_at: { [Op.between]: [startDate, endDate] }
          }
        }),
        
        // Revenu par méthode de paiement
        this.getRevenueByPaymentMethod(dateRange),
        
        // Revenu quotidien
        this.getDailyRevenue(dateRange)
      ]);

      const successRate = (successfulPayments + failedPayments) > 0 
        ? (successfulPayments / (successfulPayments + failedPayments)) * 100 
        : 0;

      return {
        overview: {
          total_revenue: totalRevenue || 0,
          total_commission: totalCommission || 0,
          net_revenue: (totalRevenue || 0) - (totalCommission || 0),
          successful_payments: successfulPayments,
          failed_payments: failedPayments,
          success_rate: Math.round(successRate * 100) / 100,
          refunded_amount: refundedAmount || 0
        },
        by_payment_method: revenueByMethod,
        daily_revenue: dailyRevenue,
        top_rides: await this.getTopRidesByRevenue(dateRange, 10)
      };

    } catch (error) {
      console.error('Erreur statistiques financières:', error);
      throw error;
    }
  }

  /**
   * Statistiques des utilisateurs
   */
  async getUserStats(dateRange = '30d') {
    try {
      const { startDate, endDate } = this.getDateRange(dateRange);

      const [
        totalUsers,
        newUsers,
        activeUsers,
        usersWithRides,
        averageRating,
        topUsers
      ] = await Promise.all([
        User.count(),
        
        User.count({
          where: { created_at: { [Op.between]: [startDate, endDate] } }
        }),
        
        User.count({
          include: [{
            model: Ride,
            as: 'customerRides',
            where: { 
              created_at: { [Op.between]: [startDate, endDate] }
            },
            required: true
          }]
        }),
        
        User.count({
          include: [{
            model: Ride,
            as: 'customerRides',
            required: true
          }]
        }),
        
        User.findOne({
          attributes: [
            [this.sequelize.fn('AVG', this.sequelize.col('customer_rating')), 'avg_rating']
          ],
          where: { 
            customer_rating: { [Op.gt]: 0 }
          }
        }),
        
        this.getTopUsers(dateRange, 10)
      ]);

      const activationRate = totalUsers > 0 ? (usersWithRides / totalUsers) * 100 : 0;

      return {
        summary: {
          total: totalUsers,
          new: newUsers,
          active: activeUsers,
          activated: usersWithRides,
          activation_rate: Math.round(activationRate * 100) / 100,
          average_rating: parseFloat(averageRating?.get('avg_rating') || 0).toFixed(1)
        },
        growth: await this.getUserGrowthTimeline(dateRange),
        top_users: topUsers,
        segmentation: await this.getUserSegmentation()
      };

    } catch (error) {
      console.error('Erreur statistiques utilisateurs:', error);
      throw error;
    }
  }

  /**
   * Statistiques des chauffeurs
   */
  async getDriverStats(dateRange = '30d') {
    try {
      const { startDate, endDate } = this.getDateRange(dateRange);

      const [
        totalDrivers,
        newDrivers,
        activeDrivers,
        approvedDrivers,
        pendingDrivers,
        averageRating,
        topDrivers
      ] = await Promise.all([
        Driver.count(),
        
        Driver.count({
          where: { created_at: { [Op.between]: [startDate, endDate] } }
        }),
        
        Driver.count({
          where: {
            [Op.or]: [
              { is_online: true },
              { updated_at: { [Op.gte]: new Date(Date.now() - 24 * 60 * 60 * 1000) } }
            ]
          }
        }),
        
        Driver.count({
          where: { driver_status: 'approved' }
        }),
        
        Driver.count({
          where: { driver_status: 'pending' }
        }),
        
        Driver.findOne({
          attributes: [
            [this.sequelize.fn('AVG', this.sequelize.col('driver_rating')), 'avg_rating']
          ],
          where: { 
            driver_rating: { [Op.gt]: 0 }
          }
        }),
        
        this.getTopDrivers(dateRange, 10)
      ]);

      const approvalRate = totalDrivers > 0 ? (approvedDrivers / totalDrivers) * 100 : 0;

      return {
        summary: {
          total: totalDrivers,
          new: newDrivers,
          active: activeDrivers,
          approved: approvedDrivers,
          pending: pendingDrivers,
          approval_rate: Math.round(approvalRate * 100) / 100,
          average_rating: parseFloat(averageRating?.get('avg_rating') || 0).toFixed(1)
        },
        by_status: await this.getDriversByStatus(),
        top_drivers: topDrivers,
        performance: await this.getDriverPerformanceMetrics(dateRange)
      };

    } catch (error) {
      console.error('Erreur statistiques chauffeurs:', error);
      throw error;
    }
  }

  /**
   * Récupération des données en temps réel
   */
  async getRealtimeData() {
    try {
      const [
        activeRides,
        onlineDrivers,
        recentRides,
        systemHealth
      ] = await Promise.all([
        // Courses actives
        Ride.findAll({
          where: { 
            status: ['requested', 'matching', 'accepted', 'driver_en_route', 'in_progress'] 
          },
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
            }
          ],
          order: [['created_at', 'DESC']],
          limit: 20
        }),
        
        // Chauffeurs en ligne
        Driver.findAll({
          where: { is_online: true },
          include: [{
            model: User,
            as: 'user',
            attributes: ['uid', 'first_name', 'last_name', 'phone_number']
          }],
          order: [['updated_at', 'DESC']],
          limit: 20
        }),
        
        // Courses récentes
        Ride.findAll({
          where: { 
            status: 'completed',
            created_at: { 
              [Op.gte]: new Date(Date.now() - 2 * 60 * 60 * 1000) // 2 dernières heures
            }
          },
          include: [
            {
              model: User,
              as: 'customer',
              attributes: ['uid', 'first_name', 'last_name']
            },
            {
              model: Driver,
              include: [{
                model: User,
                as: 'user',
                attributes: ['uid', 'first_name', 'last_name']
              }]
            }
          ],
          order: [['completed_at', 'DESC']],
          limit: 10
        }),
        
        // Santé du système
        this.getSystemHealth()
      ]);

      return {
        active_rides: activeRides.map(ride => ({
          id: ride.id,
          status: ride.status,
          customer: ride.customer ? {
            name: `${ride.customer.first_name} ${ride.customer.last_name}`,
            phone: ride.customer.phone_number
          } : null,
          driver: ride.Driver ? {
            name: `${ride.Driver.user.first_name} ${ride.Driver.user.last_name}`
          } : null,
          pickup_address: ride.pickup_address,
          requested_at: ride.requested_at
        })),
        online_drivers: onlineDrivers.map(driver => ({
          id: driver.user_id,
          name: `${driver.user.first_name} ${driver.user.last_name}`,
          phone: driver.user.phone_number,
          vehicle: `${driver.vehicle_make} ${driver.vehicle_model}`,
          last_activity: driver.updated_at
        })),
        recent_rides: recentRides.map(ride => ({
          id: ride.id,
          customer: `${ride.customer.first_name} ${ride.customer.last_name}`,
          driver: `${ride.Driver.user.first_name} ${ride.Driver.user.last_name}`,
          fare: ride.final_fare || ride.estimated_fare,
          completed_at: ride.completed_at
        })),
        system_health: systemHealth
      };

    } catch (error) {
      console.error('Erreur données temps réel:', error);
      throw error;
    }
  }

  /**
   * Santé du système
   */
  async getSystemHealth() {
    try {
      const [
        databaseStatus,
        redisStatus,
        apiResponseTime,
        errorRate,
        activeConnections
      ] = await Promise.allSettled([
        this.checkDatabaseConnection(),
        this.checkRedisConnection(),
        this.measureApiResponseTime(),
        this.calculateErrorRate(),
        this.getActiveConnections()
      ]);

      return {
        database: databaseStatus.status === 'fulfilled' ? 'healthy' : 'unhealthy',
        redis: redisStatus.status === 'fulfilled' ? 'healthy' : 'unhealthy',
        api_response_time: apiResponseTime.status === 'fulfilled' ? apiResponseTime.value : null,
        error_rate: errorRate.status === 'fulfilled' ? errorRate.value : null,
        active_connections: activeConnections.status === 'fulfilled' ? activeConnections.value : null,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      console.error('Erreur santé système:', error);
      return {
        database: 'unknown',
        redis: 'unknown',
        api_response_time: null,
        error_rate: null,
        active_connections: null,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Méthodes d'assistance
   */

  getDateRange(range) {
    const now = new Date();
    let startDate;

    switch (range) {
      case '1d':
        startDate = new Date(now.setDate(now.getDate() - 1));
        break;
      case '7d':
        startDate = new Date(now.setDate(now.getDate() - 7));
        break;
      case '30d':
        startDate = new Date(now.setDate(now.getDate() - 30));
        break;
      case '90d':
        startDate = new Date(now.setDate(now.getDate() - 90));
        break;
      default:
        startDate = new Date(now.setDate(now.getDate() - 7));
    }

    return {
      startDate,
      endDate: new Date()
    };
  }

  async calculateGrowthRate(model, dateRange) {
    const { startDate, endDate } = this.getDateRange(dateRange);
    const previousRange = this.getPreviousRange(dateRange);

    const [currentCount, previousCount] = await Promise.all([
      model.count({
        where: { created_at: { [Op.between]: [startDate, endDate] } }
      }),
      model.count({
        where: { created_at: { [Op.between]: [previousRange.startDate, previousRange.endDate] } }
      })
    ]);

    if (previousCount === 0) return currentCount > 0 ? 100 : 0;
    
    return ((currentCount - previousCount) / previousCount) * 100;
  }

  getPreviousRange(dateRange) {
    const { startDate, endDate } = this.getDateRange(dateRange);
    const duration = endDate - startDate;
    
    return {
      startDate: new Date(startDate - duration),
      endDate: new Date(endDate - duration)
    };
  }

  async getTodayRevenue() {
    const todayStart = new Date(new Date().setHours(0, 0, 0, 0));
    const todayEnd = new Date(new Date().setHours(23, 59, 59, 999));

    const revenue = await Payment.sum('amount', {
      where: { 
        payment_status: 'completed',
        created_at: { [Op.between]: [todayStart, todayEnd] }
      }
    });

    return revenue || 0;
  }

  async calculateRevenueGrowth(dateRange) {
    const { startDate, endDate } = this.getDateRange(dateRange);
    const previousRange = this.getPreviousRange(dateRange);

    const [currentRevenue, previousRevenue] = await Promise.all([
      Payment.sum('amount', {
        where: { 
          payment_status: 'completed',
          created_at: { [Op.between]: [startDate, endDate] }
        }
      }),
      Payment.sum('amount', {
        where: { 
          payment_status: 'completed',
          created_at: { [Op.between]: [previousRange.startDate, previousRange.endDate] }
        }
      })
    ]);

    if (!previousRevenue) return currentRevenue > 0 ? 100 : 0;
    
    return ((currentRevenue - previousRevenue) / previousRevenue) * 100;
  }

  async getRevenueByStatus(dateRange) {
    const { startDate, endDate } = this.getDateRange(dateRange);

    const results = await Payment.findAll({
      attributes: [
        'payment_status',
        [this.sequelize.fn('SUM', this.sequelize.col('amount')), 'total_amount'],
        [this.sequelize.fn('COUNT', this.sequelize.col('id')), 'count']
      ],
      where: { 
        created_at: { [Op.between]: [startDate, endDate] }
      },
      group: ['payment_status']
    });

    return results.reduce((acc, item) => {
      acc[item.payment_status] = {
        amount: parseFloat(item.get('total_amount') || 0),
        count: parseInt(item.get('count') || 0)
      };
      return acc;
    }, {});
  }

  async getRidesByHour(dateRange) {
    const { startDate, endDate } = this.getDateRange(dateRange);

    const results = await Ride.findAll({
      attributes: [
        [this.sequelize.fn('HOUR', this.sequelize.col('created_at')), 'hour'],
        [this.sequelize.fn('COUNT', this.sequelize.col('id')), 'count']
      ],
      where: { 
        created_at: { [Op.between]: [startDate, endDate] }
      },
      group: ['hour'],
      order: ['hour']
    });

    // Créer un tableau pour toutes les heures (0-23)
    const hourlyData = Array.from({ length: 24 }, (_, hour) => ({
      hour,
      count: 0
    }));

    results.forEach(item => {
      const hour = item.get('hour');
      const count = parseInt(item.get('count') || 0);
      hourlyData[hour].count = count;
    });

    return hourlyData;
  }

  async getRidesTimeline(dateRange) {
    const { startDate, endDate } = this.getDateRange(dateRange);
    const duration = endDate - startDate;
    const days = Math.ceil(duration / (1000 * 60 * 60 * 24));

    const results = await Ride.findAll({
      attributes: [
        [this.sequelize.fn('DATE', this.sequelize.col('created_at')), 'date'],
        [this.sequelize.fn('COUNT', this.sequelize.col('id')), 'count']
      ],
      where: { 
        created_at: { [Op.between]: [startDate, endDate] }
      },
      group: ['date'],
      order: ['date']
    });

    // Créer un tableau pour tous les jours de la période
    const timeline = [];
    for (let i = 0; i < days; i++) {
      const date = new Date(startDate);
      date.setDate(date.getDate() + i);
      const dateString = date.toISOString().split('T')[0];

      const dayData = results.find(item => item.get('date').toISOString().split('T')[0] === dateString);
      timeline.push({
        date: dateString,
        count: dayData ? parseInt(dayData.get('count')) : 0
      });
    }

    return timeline;
  }

  async getRevenueByPaymentMethod(dateRange) {
    const { startDate, endDate } = this.getDateRange(dateRange);

    const results = await Payment.findAll({
      attributes: [
        'payment_method',
        [this.sequelize.fn('SUM', this.sequelize.col('amount')), 'total_amount'],
        [this.sequelize.fn('COUNT', this.sequelize.col('id')), 'count']
      ],
      where: { 
        payment_status: 'completed',
        created_at: { [Op.between]: [startDate, endDate] }
      },
      group: ['payment_method']
    });

    return results.reduce((acc, item) => {
      acc[item.payment_method] = {
        amount: parseFloat(item.get('total_amount') || 0),
        count: parseInt(item.get('count') || 0)
      };
      return acc;
    }, {});
  }

  async getDailyRevenue(dateRange) {
    const { startDate, endDate } = this.getDateRange(dateRange);
    const duration = endDate - startDate;
    const days = Math.ceil(duration / (1000 * 60 * 60 * 24));

    const results = await Payment.findAll({
      attributes: [
        [this.sequelize.fn('DATE', this.sequelize.col('created_at')), 'date'],
        [this.sequelize.fn('SUM', this.sequelize.col('amount')), 'total_amount']
      ],
      where: { 
        payment_status: 'completed',
        created_at: { [Op.between]: [startDate, endDate] }
      },
      group: ['date'],
      order: ['date']
    });

    const dailyRevenue = [];
    for (let i = 0; i < days; i++) {
      const date = new Date(startDate);
      date.setDate(date.getDate() + i);
      const dateString = date.toISOString().split('T')[0];

      const dayData = results.find(item => item.get('date').toISOString().split('T')[0] === dateString);
      dailyRevenue.push({
        date: dateString,
        revenue: dayData ? parseFloat(dayData.get('total_amount')) : 0
      });
    }

    return dailyRevenue;
  }

  async getTopRidesByRevenue(dateRange, limit = 10) {
    const { startDate, endDate } = this.getDateRange(dateRange);

    const rides = await Ride.findAll({
      include: [
        {
          model: User,
          as: 'customer',
          attributes: ['uid', 'first_name', 'last_name']
        },
        {
          model: Payment,
          as: 'payments',
          where: { 
            payment_status: 'completed',
            created_at: { [Op.between]: [startDate, endDate] }
          },
          required: true
        }
      ],
      order: [[{ model: Payment, as: 'payments' }, 'amount', 'DESC']],
      limit
    });

    return rides.map(ride => ({
      id: ride.id,
      customer: `${ride.customer.first_name} ${ride.customer.last_name}`,
      pickup: ride.pickup_address,
      destination: ride.destination_address,
      fare: ride.final_fare || ride.estimated_fare,
      completed_at: ride.completed_at
    }));
  }

  async getTopUsers(dateRange, limit = 10) {
    const { startDate, endDate } = this.getDateRange(dateRange);

    const users = await User.findAll({
      attributes: [
        'uid', 'first_name', 'last_name', 'email', 'phone_number', 'customer_rating',
        [this.sequelize.fn('COUNT', this.sequelize.col('customerRides.id')), 'ride_count'],
        [this.sequelize.fn('SUM', this.sequelize.col('customerRides.final_fare')), 'total_spent']
      ],
      include: [{
        model: Ride,
        as: 'customerRides',
        attributes: [],
        where: { 
          status: 'completed',
          created_at: { [Op.between]: [startDate, endDate] }
        },
        required: false
      }],
      group: ['User.uid'],
      order: [[this.sequelize.literal('total_spent'), 'DESC']],
      limit,
      subQuery: false
    });

    return users.map(user => ({
      id: user.uid,
      name: `${user.first_name} ${user.last_name}`,
      email: user.email,
      phone: user.phone_number,
      rating: user.customer_rating,
      ride_count: parseInt(user.get('ride_count') || 0),
      total_spent: parseFloat(user.get('total_spent') || 0)
    }));
  }

  async getUserGrowthTimeline(dateRange) {
    const { startDate, endDate } = this.getDateRange(dateRange);
    const duration = endDate - startDate;
    const days = Math.ceil(duration / (1000 * 60 * 60 * 24));

    const results = await User.findAll({
      attributes: [
        [this.sequelize.fn('DATE', this.sequelize.col('created_at')), 'date'],
        [this.sequelize.fn('COUNT', this.sequelize.col('uid')), 'count']
      ],
      where: { 
        created_at: { [Op.between]: [startDate, endDate] }
      },
      group: ['date'],
      order: ['date']
    });

    const growth = [];
    let cumulative = 0;

    for (let i = 0; i < days; i++) {
      const date = new Date(startDate);
      date.setDate(date.getDate() + i);
      const dateString = date.toISOString().split('T')[0];

      const dayData = results.find(item => item.get('date').toISOString().split('T')[0] === dateString);
      const dayCount = dayData ? parseInt(dayData.get('count')) : 0;
      cumulative += dayCount;

      growth.push({
        date: dateString,
        new_users: dayCount,
        total_users: cumulative
      });
    }

    return growth;
  }

  async getUserSegmentation() {
    const segments = await User.findAll({
      attributes: [
        [this.sequelize.fn('COUNT', this.sequelize.col('uid')), 'count'],
        [this.sequelize.literal(`
          CASE 
            WHEN customer_rating >= 4.5 THEN 'excellent'
            WHEN customer_rating >= 4.0 THEN 'good'
            WHEN customer_rating >= 3.0 THEN 'average'
            ELSE 'poor'
          END
        `), 'segment']
      ],
      group: ['segment'],
      having: { segment: { [Op.ne]: null } }
    });

    return segments.reduce((acc, segment) => {
      acc[segment.get('segment')] = parseInt(segment.get('count') || 0);
      return acc;
    }, {});
  }

  async getTopDrivers(dateRange, limit = 10) {
    const { startDate, endDate } = this.getDateRange(dateRange);

    const drivers = await Driver.findAll({
      attributes: [
        'user_id', 'driver_rating', 'total_completed_rides', 'acceptance_rate',
        [this.sequelize.fn('SUM', this.sequelize.col('rides.final_fare')), 'total_earnings']
      ],
      include: [
        {
          model: User,
          as: 'user',
          attributes: ['first_name', 'last_name', 'phone_number']
        },
        {
          model: Ride,
          as: 'driverRides',
          attributes: [],
          where: { 
            status: 'completed',
            completed_at: { [Op.between]: [startDate, endDate] }
          },
          required: false
        }
      ],
      group: ['Driver.user_id', 'user.uid'],
      order: [[this.sequelize.literal('total_earnings'), 'DESC']],
      limit,
      subQuery: false
    });

    return drivers.map(driver => ({
      id: driver.user_id,
      name: `${driver.user.first_name} ${driver.user.last_name}`,
      phone: driver.user.phone_number,
      rating: driver.driver_rating,
      completed_rides: driver.total_completed_rides,
      acceptance_rate: driver.acceptance_rate,
      total_earnings: parseFloat(driver.get('total_earnings') || 0)
    }));
  }

  async getDriversByStatus() {
    const results = await Driver.findAll({
      attributes: [
        'driver_status',
        [this.sequelize.fn('COUNT', this.sequelize.col('user_id')), 'count']
      ],
      group: ['driver_status']
    });

    return results.reduce((acc, item) => {
      acc[item.driver_status] = parseInt(item.get('count') || 0);
      return acc;
    }, {});
  }

  async getDriverPerformanceMetrics(dateRange) {
    const { startDate, endDate } = this.getDateRange(dateRange);

    const metrics = await Driver.findAll({
      attributes: [
        [this.sequelize.fn('AVG', this.sequelize.col('driver_rating')), 'avg_rating'],
        [this.sequelize.fn('AVG', this.sequelize.col('acceptance_rate')), 'avg_acceptance_rate'],
        [this.sequelize.fn('AVG', this.sequelize.col('cancellation_rate')), 'avg_cancellation_rate'],
        [this.sequelize.fn('SUM', this.sequelize.col('total_completed_rides')), 'total_rides']
      ],
      where: { 
        created_at: { [Op.between]: [startDate, endDate] }
      }
    });

    const result = metrics[0];
    return {
      average_rating: parseFloat(result?.get('avg_rating') || 0).toFixed(1),
      average_acceptance_rate: parseFloat(result?.get('avg_acceptance_rate') || 0).toFixed(1),
      average_cancellation_rate: parseFloat(result?.get('avg_cancellation_rate') || 0).toFixed(1),
      total_rides: parseInt(result?.get('total_rides') || 0)
    };
  }

  async checkDatabaseConnection() {
    try {
      await this.sequelize.authenticate();
      return true;
    } catch (error) {
      return false;
    }
  }

  async checkRedisConnection() {
    // Implémentation pour vérifier la connexion Redis
    // À adapter selon votre configuration
    return true;
  }

  async measureApiResponseTime() {
    // Mesurer le temps de réponse moyen de l'API
    // Cette implémentation est simplifiée
    return Math.random() * 100 + 50; // Valeur simulée
  }

  async calculateErrorRate() {
    // Calculer le taux d'erreur de l'API
    // Cette implémentation est simplifiée
    return Math.random() * 5; // Valeur simulée en pourcentage
  }

  async getActiveConnections() {
    // Récupérer le nombre de connexions actives
    // Cette implémentation est simplifiée
    return Math.floor(Math.random() * 100) + 50; // Valeur simulée
  }
}

module.exports = AdminService;