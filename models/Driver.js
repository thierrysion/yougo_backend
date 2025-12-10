const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database.js');

const Driver = sequelize.define('Driver', {
  user_id: {
    type: DataTypes.STRING,
    primaryKey: true,
    allowNull: false,
    references: {
      model: 'users',
      key: 'uid'
    },
    validate: {
      notEmpty: {
        msg: "L'ID utilisateur est obligatoire"
      }
    }
  },
  
  driver_license_number: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
    validate: {
      notEmpty: {
        msg: "Le numéro de permis est obligatoire"
      }
    }
  },
  
  license_expiry_date: {
    type: DataTypes.DATEONLY,
    allowNull: false,
    validate: {
      isDate: {
        msg: "La date d'expiration du permis doit être valide"
      },
      isAfter: {
        args: new Date().toISOString().split('T')[0],
        msg: "Le permis doit être valide (date d'expiration dans le futur)"
      }
    }
  },
  
  years_of_experience: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    validate: {
      min: {
        args: [0],
        msg: "L'expérience ne peut pas être négative"
      },
      max: {
        args: [60],
        msg: "L'expérience ne peut pas dépasser 60 ans"
      }
    }
  },
  
  driver_status: {
    type: DataTypes.ENUM('pending', 'approved', 'rejected', 'suspended'),
    allowNull: false,
    defaultValue: 'pending',
    validate: {
      isIn: {
        args: [['pending', 'approved', 'rejected', 'suspended']],
        msg: "Le statut chauffeur doit être pending, approved, rejected ou suspended"
      }
    }
  },
  
  // Informations véhicule
  vehicle_make: {
    type: DataTypes.STRING,
    allowNull: false,
    validate: {
      notEmpty: {
        msg: "La marque du véhicule est obligatoire"
      }
    }
  },
  
  vehicle_model: {
    type: DataTypes.STRING,
    allowNull: false,
    validate: {
      notEmpty: {
        msg: "Le modèle du véhicule est obligatoire"
      }
    }
  },
  
  license_plate: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
    validate: {
      notEmpty: {
        msg: "La plaque d'immatriculation est obligatoire"
      }
    }
  },
  
  vehicle_color: {
    type: DataTypes.STRING,
    allowNull: false,
    validate: {
      notEmpty: {
        msg: "La couleur du véhicule est obligatoire"
      }
    }
  },
  
  vehicle_year: {
    type: DataTypes.INTEGER,
    allowNull: false,
    validate: {
      min: {
        args: [1990],
        msg: "L'année du véhicule doit être après 1990"
      },
      max: {
        args: [new Date().getFullYear() + 1],
        msg: "L'année du véhicule ne peut pas être dans le futur"
      }
    }
  },
  
  ride_type_id: {
    type: DataTypes.UUID,
    allowNull: false,
    validate: {
      notEmpty: {
        msg: "Le type de course est obligatoire"
      }
    }
  },
  
  // Localisation et disponibilité
  current_location: {
    type: DataTypes.GEOMETRY('POINT'),
    allowNull: true
  },

  last_location_update: {
    type: DataTypes.DATE,
    allowNull: true
  },
  
  current_zone: {
    type: DataTypes.STRING,
    allowNull: true
  },
  
  is_online: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false
  },

  online_since: {
    type: DataTypes.DATE,
    allowNull: true
  },
  
  // Notation chauffeur
  driver_rating: {
    type: DataTypes.DECIMAL(3, 2),
    allowNull: false,
    defaultValue: 0.00,
    validate: {
      min: 0,
      max: 5
    }
  },
  
  driver_rating_count: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    validate: {
      min: 0
    }
  },
  
  // Statistiques
  total_completed_rides: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    validate: {
      min: 0
    }
  },
  
  acceptance_rate: {
    type: DataTypes.DECIMAL(5, 2),
    allowNull: false,
    defaultValue: 0.00,
    validate: {
      min: 0,
      max: 100
    }
  },
  
  cancellation_rate: {
    type: DataTypes.DECIMAL(5, 2),
    allowNull: false,
    defaultValue: 0.00,
    validate: {
      min: 0,
      max: 100
    }
  },
  
  // Métadonnées administratives
  approved_by_admin_id: {
    type: DataTypes.STRING,
    allowNull: true,
    references: {
      model: 'users',
      key: 'uid'
    }
  },
  
  approved_at: {
    type: DataTypes.DATE,
    allowNull: true
  }
}, {
  tableName: 'drivers',
  indexes: [
    {
      unique: true,
      fields: ['driver_license_number']
    },
    {
      unique: true,
      fields: ['license_plate']
    },
    {
      fields: ['driver_status']
    },
    {
      fields: ['is_online']
    },
    {
      fields: ['current_zone']
    },
    {
      type: 'SPATIAL',
      fields: ['current_location']
    }
  ],
  hooks: {
    beforeValidate: (driver) => {
      // Normaliser la plaque d'immatriculation
      if (driver.license_plate) {
        driver.license_plate = driver.license_plate.toUpperCase().replace(/\s/g, '');
      }
    }
  }
});

module.exports = Driver;