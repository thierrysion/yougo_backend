const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database.js');

const Ride = sequelize.define('Ride', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  
  // Participants
  customer_id: {
    type: DataTypes.STRING,
    allowNull: false,
    references: {
      model: 'users',
      key: 'uid'
    },
    validate: {
      notEmpty: {
        msg: "L'ID du client est obligatoire"
      }
    }
  },
  
  driver_id: {
    type: DataTypes.STRING,
    allowNull: true,
    references: {
      model: 'drivers',
      key: 'user_id'
    }
  },
  
  // Trajet
  pickup_location: {
    type: DataTypes.GEOMETRY('POINT'),
    allowNull: false,
    validate: {
      notNull: {
        msg: "La localisation de départ est obligatoire"
      }
    }
  },
  
  pickup_address: {
    type: DataTypes.STRING,
    allowNull: false,
    validate: {
      notEmpty: {
        msg: "L'adresse de départ est obligatoire"
      }
    }
  },
  
  destination_location: {
    type: DataTypes.GEOMETRY('POINT'),
    allowNull: false,
    validate: {
      notNull: {
        msg: "La localisation de destination est obligatoire"
      }
    }
  },
  
  destination_address: {
    type: DataTypes.STRING,
    allowNull: false,
    validate: {
      notEmpty: {
        msg: "L'adresse de destination est obligatoire"
      }
    }
  },
  
  // Type et calcul
  ride_type_id: {
    type: DataTypes.UUID,
    allowNull: false,
    validate: {
      notEmpty: {
        msg: "Le type de course est obligatoire"
      }
    }
  },
  
  base_fare: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    validate: {
      min: {
        args: [0],
        msg: "Le tarif de base ne peut pas être négatif"
      }
    }
  },
  
  distance_km: {
    type: DataTypes.DECIMAL(8, 2),
    allowNull: false,
    validate: {
      min: {
        args: [0.1],
        msg: "La distance doit être d'au moins 0.1 km"
      }
    }
  },
  
  estimated_duration_minutes: {
    type: DataTypes.INTEGER,
    allowNull: false,
    validate: {
      min: {
        args: [1],
        msg: "La durée estimée doit être d'au moins 1 minute"
      }
    }
  },
  
  applied_rules_count: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    validate: {
      min: {
        args: [0],
        msg: "Le nombre de règles appliquées ne peut pas être négatif"
      }
    }
  },
  
  fare_breakdown: {
    type: DataTypes.JSONB,
    allowNull: false,
    defaultValue: {
      base: 0,
      distance: 0,
      time: 0,
      surcharges: 0,
      bonuses: 0,
      fees: 0,
      total: 0
    },
    validate: {
      isValidFareBreakdown(value) {
        if (!value || typeof value !== 'object') {
          throw new Error('Le détail du prix doit être un objet JSON');
        }
        const required = ['base', 'distance', 'time', 'surcharges', 'bonuses', 'fees', 'total'];
        for (const key of required) {
          if (typeof value[key] !== 'number') {
            throw new Error(`Le détail du prix doit contenir la clé ${key} avec une valeur numérique`);
          }
        }
      }
    }
  },
  
  estimated_fare: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    validate: {
      min: {
        args: [0],
        msg: "Le prix estimé ne peut pas être négatif"
      }
    }
  },
  
  final_fare: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: true,
    validate: {
      min: {
        args: [0],
        msg: "Le prix final ne peut pas être négatif"
      }
    }
  },
  
  // Statuts
  status: {
    type: DataTypes.ENUM(
      'requested', 
      'accepted', 
      'driver_en_route', 
      'arrived', 
      'in_progress', 
      'completed', 
      'cancelled'
    ),
    allowNull: false,
    defaultValue: 'requested',
    validate: {
      isIn: {
        args: [['requested', 'accepted', 'driver_en_route', 'arrived', 'in_progress', 'completed', 'cancelled']],
        msg: "Statut de course invalide"
      }
    }
  },
  
  payment_status: {
    type: DataTypes.ENUM('pending', 'paid', 'cancelled'),
    allowNull: false,
    defaultValue: 'pending',
    validate: {
      isIn: {
        args: [['pending', 'paid', 'cancelled']],
        msg: "Statut de paiement invalide"
      }
    }
  },
  
  payment_method: {
    type: DataTypes.ENUM('cash', 'card', 'mobile_money'),
    allowNull: false,
    defaultValue: 'cash',
    validate: {
      isIn: {
        args: [['cash', 'card', 'mobile_money']],
        msg: "Méthode de paiement invalide"
      }
    }
  },
  
  // Horodatages
  requested_at: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW
  },
  
  accepted_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  
  driver_en_route_at: {
	type: DataTypes.DATE,
	allowNull: true
  },
  
  driver_arrived_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  
  started_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  
  driver_wait_time_minutes: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  customer_wait_time_minutes: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  total_ride_time_minutes: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  final_distance_km: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: true
  },
  final_duration_minutes: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  actual_route: {
    type: DataTypes.TEXT, // Pour stocker un polyline
    allowNull: true
  },
  cancellation_fee: {
    type: DataTypes.DECIMAL(10, 2),
    defaultValue: 0
  },
  driver_current_location: {
    type: DataTypes.GEOMETRY('POINT'),
    allowNull: true
  },
  
  completed_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  
  cancelled_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  
  // Annulation
  cancelled_by: {
    type: DataTypes.ENUM('customer', 'driver', 'system'),
    allowNull: true,
    validate: {
      isIn: {
        args: [['customer', 'driver', 'system']],
        msg: "L'annulation doit être par customer, driver ou system"
      }
    }
  },
  
  cancellation_reason: {
    type: DataTypes.STRING,
    allowNull: true
  }
}, {
  tableName: 'rides',
  indexes: [
    {
      fields: ['customer_id', 'status']
    },
    {
      fields: ['driver_id', 'status']
    },
    {
      fields: ['status']
    },
    {
      fields: ['requested_at']
    },
    {
      type: 'SPATIAL',
      fields: ['pickup_location']
    },
    {
      type: 'SPATIAL',
      fields: ['destination_location']
    }
  ],
  hooks: {
    beforeValidate: (ride) => {
      // Calculer le prix total à partir du détail
      if (ride.fare_breakdown && typeof ride.fare_breakdown === 'object') {
        const total = Object.values(ride.fare_breakdown).reduce((sum, value) => {
          return sum + (typeof value === 'number' ? value : 0);
        }, 0);
        ride.estimated_fare = total;
      }
    }
  }
});

module.exports = Ride;