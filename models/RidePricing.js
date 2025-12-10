const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database.js');

const RidePricing = sequelize.define('RidePricing', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  
  ride_id: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'rides',
      key: 'id'
    },
    validate: {
      notEmpty: {
        msg: "L'ID de la course est obligatoire"
      }
    }
  },
  
  pricing_rule_id: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'pricing_rules',
      key: 'id'
    },
    validate: {
      notEmpty: {
        msg: "L'ID de la règle de tarification est obligatoire"
      }
    }
  },
  
  applied_parameters: {
    type: DataTypes.JSONB,
    allowNull: false,
    validate: {
      isValidParameters(value) {
        if (!value || typeof value !== 'object') {
          throw new Error('Les paramètres appliqués doivent être un objet JSON');
        }
      }
    }
  },
  
  calculated_amount: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    validate: {
      min: {
        args: [0],
        msg: "Le montant calculé ne peut pas être négatif"
      }
    }
  },
  
  application_order: {
    type: DataTypes.INTEGER,
    allowNull: false,
    validate: {
      min: {
        args: [0],
        msg: "L'ordre d'application ne peut pas être négatif"
      }
    }
  }
}, {
  tableName: 'ride_pricings',
  indexes: [
    {
      fields: ['ride_id']
    },
    {
      fields: ['pricing_rule_id']
    },
    {
      unique: true,
      fields: ['ride_id', 'pricing_rule_id']
    }
  ]
});

module.exports = RidePricing;