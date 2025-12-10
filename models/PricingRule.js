const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database.js');

const PricingRule = sequelize.define('PricingRule', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
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
  
  city: {
    type: DataTypes.STRING,
    allowNull: false,
    validate: {
      notEmpty: {
        msg: "La ville est obligatoire"
      },
      isIn: {
        args: [process.env.SUPPORTED_CITIES?.split(',') || []],
        msg: `La ville doit être parmi: ${process.env.SUPPORTED_CITIES}`
      }
    }
  },
  
  is_active: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true
  },
  
  application_scope: {
    type: DataTypes.ENUM('base', 'surcharge', 'bonus', 'fee'),
    allowNull: false,
    validate: {
      isIn: {
        args: [['base', 'surcharge', 'bonus', 'fee']],
        msg: "Le scope d'application doit être base, surcharge, bonus ou fee"
      }
    }
  },
  
  // Conditions d'activation
  condition_type: {
    type: DataTypes.ENUM('time', 'day', 'zone', 'weather', 'demand', 'distance', 'custom'),
    allowNull: false,
    validate: {
      isIn: {
        args: [['time', 'day', 'zone', 'weather', 'demand', 'distance', 'custom']],
        msg: "Le type de condition doit être time, day, zone, weather, demand, distance ou custom"
      }
    }
  },
  
  condition_parameters: {
    type: DataTypes.JSONB,
    allowNull: false,
    validate: {
      isValidConditionParameters(value) {
        if (!value || typeof value !== 'object') {
          throw new Error('Les paramètres de condition doivent être un objet JSON');
        }
      }
    }
  },
  
  condition_expression: {
    type: DataTypes.STRING,
    allowNull: true
  },
  
  // Calcul du prix
  calculation_type: {
    type: DataTypes.ENUM('fixed', 'percentage', 'per_km', 'per_minute', 'formula'),
    allowNull: false,
    validate: {
      isIn: {
        args: [['fixed', 'percentage', 'per_km', 'per_minute', 'formula']],
        msg: "Le type de calcul doit être fixed, percentage, per_km, per_minute ou formula"
      }
    }
  },
  
  calculation_parameters: {
    type: DataTypes.JSONB,
    allowNull: false,
    validate: {
      isValidCalculationParameters(value) {
        if (!value || typeof value !== 'object') {
          throw new Error('Les paramètres de calcul doivent être un objet JSON');
        }
      }
    }
  },
  
  max_amount: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: true,
    validate: {
      min: {
        args: [0],
        msg: "Le montant maximum ne peut pas être négatif"
      }
    }
  },
  
  // Priorité et validité
  priority: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    validate: {
      min: {
        args: [0],
        msg: "La priorité ne peut pas être négative"
      }
    }
  },
  
  valid_from: {
    type: DataTypes.DATE,
    allowNull: false,
    validate: {
      isDate: {
        msg: "La date de début de validité doit être valide"
      }
    }
  },
  
  valid_until: {
    type: DataTypes.DATE,
    allowNull: true,
    validate: {
      isDate: {
        msg: "La date de fin de validité doit être valide"
      }
    }
  },
  
  max_applications: {
    type: DataTypes.INTEGER,
    allowNull: true,
    validate: {
      min: {
        args: [1],
        msg: "Le nombre maximum d'applications doit être au moins 1"
      }
    }
  },
  
  // Métadonnées
  name: {
    type: DataTypes.STRING,
    allowNull: false,
    validate: {
      notEmpty: {
        msg: "Le nom de la règle est obligatoire"
      }
    }
  },
  
  description: {
    type: DataTypes.STRING,
    allowNull: true
  },
  
  created_by: {
    type: DataTypes.STRING,
    allowNull: false,
    validate: {
      notEmpty: {
        msg: "L'ID du créateur est obligatoire"
      }
    }
  }
}, {
  tableName: 'pricing_rules',
  indexes: [
    {
      fields: ['ride_type_id', 'city', 'is_active']
    },
    {
      fields: ['valid_from', 'valid_until']
    },
    {
      fields: ['priority']
    }
  ],
  hooks: {
    beforeValidate: (pricingRule) => {
      // S'assurer que valid_until est après valid_from
      if (pricingRule.valid_from && pricingRule.valid_until) {
        if (new Date(pricingRule.valid_until) <= new Date(pricingRule.valid_from)) {
          throw new Error("La date de fin de validité doit être après la date de début");
        }
      }
    }
  }
});

module.exports = PricingRule;