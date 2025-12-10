const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database.js');

const User = sequelize.define('User', {
  uid: {
    type: DataTypes.STRING,
    primaryKey: true,
    allowNull: false,
    unique: true,
    validate: {
      notEmpty: {
        msg: "L'UID Firebase est obligatoire"
      }
    }
  },
  
  phone_number: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
    validate: {
      notEmpty: {
        msg: "Le numéro de téléphone est obligatoire"
      },
      is: {
        args: /^\+[1-9]\d{1,14}$/,
        msg: "Le numéro de téléphone doit être au format international (ex: +237612345678)"
      }
    }
  },
  
  role: {
    type: DataTypes.ENUM('customer', 'driver', 'admin'),
    allowNull: false,
    defaultValue: 'customer',
    validate: {
      isIn: {
        args: [['customer', 'driver', 'admin']],
        msg: "Le rôle doit être customer, driver ou admin"
      }
    }
  },
  
  status: {
    type: DataTypes.ENUM('active', 'suspended'),
    allowNull: false,
    defaultValue: 'active',
    validate: {
      isIn: {
        args: [['active', 'suspended']],
        msg: "Le statut doit être active ou suspended"
      }
    }
  },
  
  email: {
    type: DataTypes.STRING,
    allowNull: true,
    validate: {
      isEmail: {
        msg: "L'email doit être valide"
      }
    }
  },
  
  first_name: {
    type: DataTypes.STRING,
    allowNull: true,
    validate: {
      len: {
        args: [1, 50],
        msg: "Le prénom doit contenir entre 1 et 50 caractères"
      }
    }
  },
  
  last_name: {
    type: DataTypes.STRING,
    allowNull: true,
    validate: {
      len: {
        args: [1, 50],
        msg: "Le nom doit contenir entre 1 et 50 caractères"
      }
    }
  },
  
  profile_picture_url: {
    type: DataTypes.STRING,
    allowNull: true,
    validate: {
      isUrl: {
        msg: "L'URL de la photo de profil doit être valide"
      }
    }
  },
  
  customer_rating: {
    type: DataTypes.DECIMAL(3, 2),
    allowNull: false,
    defaultValue: 0.00,
    validate: {
      min: {
        args: [0],
        msg: "La note ne peut pas être négative"
      },
      max: {
        args: [5],
        msg: "La note ne peut pas dépasser 5"
      }
    }
  },
  
  customer_rating_count: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    validate: {
      min: {
        args: [0],
        msg: "Le nombre de notes ne peut pas être négatif"
      }
    }
  }
}, {
  tableName: 'users',
  indexes: [
    {
      unique: true,
      fields: ['phone_number']
    },
    {
      fields: ['role']
    },
    {
      fields: ['status']
    }
  ],
  hooks: {
    beforeValidate: (user) => {
      // Normaliser le numéro de téléphone
      if (user.phone_number) {
        user.phone_number = user.phone_number.trim();
      }
    }
  }
});

module.exports = User;