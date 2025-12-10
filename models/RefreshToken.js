const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database.js');

const RefreshToken = sequelize.define('RefreshToken', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  
  user_id: {
    type: DataTypes.STRING,
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
  
  refresh_token: {
    type: DataTypes.TEXT,
    allowNull: false,
    unique: true,
    validate: {
      notEmpty: {
        msg: "Le refresh token est obligatoire"
      }
    }
  },
  
  expires_at: {
    type: DataTypes.DATE,
    allowNull: false,
    validate: {
      isDate: {
        msg: "La date d'expiration doit être valide"
      },
      isAfter: {
        args: new Date().toISOString(),
        msg: "Le token doit expirer dans le futur"
      }
    }
  },
  
  is_revoked: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false
  },
  
  ip_address: {
    type: DataTypes.STRING,
    allowNull: true,
    validate: {
      isIP: {
        msg: "L'adresse IP doit être valide"
      }
    }
  },
  
  user_agent: {
    type: DataTypes.STRING,
    allowNull: true
  }
}, {
  tableName: 'refresh_tokens',
  indexes: [
    {
      fields: ['user_id']
    },
    {
      fields: ['expires_at']
    },
    {
      fields: ['is_revoked']
    }
  ],
  hooks: {
    beforeValidate: (token) => {
      // S'assurer que la date d'expiration est dans le futur
      if (token.expires_at && new Date(token.expires_at) <= new Date()) {
        throw new Error("Le token doit expirer dans le futur");
      }
    }
  }
});

module.exports = RefreshToken;