const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database.js');

const RideType = sequelize.define('RideType', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  
  name: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
    validate: {
      notEmpty: {
        msg: "Le nom du type de course est obligatoire"
      },
      isIn: {
        args: [['eco', 'comfort', 'premium', 'xl']],
        msg: "Le nom doit être eco, comfort, premium ou xl"
      }
    }
  },
  
  description: {
    type: DataTypes.STRING,
    allowNull: false,
    validate: {
      notEmpty: {
        msg: "La description est obligatoire"
      }
    }
  },
  
  icon_url: {
    type: DataTypes.STRING,
    allowNull: true,
    validate: {
      isUrl: {
        msg: "L'URL de l'icône doit être valide"
      }
    }
  },
  
  // Tarification de base
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
  
  per_km_rate: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    validate: {
      min: {
        args: [0],
        msg: "Le tarif au km ne peut pas être négatif"
      }
    }
  },
  
  per_minute_rate: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    validate: {
      min: {
        args: [0],
        msg: "Le tarif à la minute ne peut pas être négatif"
      }
    }
  },
  
  minimum_fare: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    validate: {
      min: {
        args: [0],
        msg: "Le tarif minimum ne peut pas être négatif"
      }
    }
  },
  
  is_active: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true
  }
}, {
  tableName: 'ride_types',
  indexes: [
    {
      unique: true,
      fields: ['name']
    },
    {
      fields: ['is_active']
    }
  ],
  hooks: {
    beforeValidate: (rideType) => {
      // S'assurer que le tarif minimum est au moins égal au tarif de base
      if (rideType.base_fare && rideType.minimum_fare) {
        if (rideType.minimum_fare < rideType.base_fare) {
          rideType.minimum_fare = rideType.base_fare;
        }
      }
    }
  }
});

module.exports = RideType;