// models/PushToken.js
'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class PushToken extends Model {
    static associate(models) {
      PushToken.belongsTo(models.User, {
        foreignKey: 'user_id',
        as: 'user'
      });
    }
  }

  PushToken.init({
    id: {
      type: DataTypes.UUID,
      primaryKey: true,
      defaultValue: DataTypes.UUIDV4
    },
    user_id: {
      type: DataTypes.STRING,
      allowNull: false,
      references: {
        model: 'Users',
        key: 'uid'
      }
    },
    token: {
      type: DataTypes.TEXT,
      allowNull: false
    },
    platform: {
      type: DataTypes.ENUM('ios', 'android', 'web'),
      allowNull: false
    },
    device_id: {
      type: DataTypes.STRING,
      allowNull: true
    },
    app_version: {
      type: DataTypes.STRING,
      allowNull: true
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      defaultValue: true
    },
    last_used_at: {
      type: DataTypes.DATE,
      allowNull: true
    },
    revoked_at: {
      type: DataTypes.DATE,
      allowNull: true
    },
    last_error: {
      type: DataTypes.TEXT,
      allowNull: true
    }
  }, {
    sequelize,
    modelName: 'PushToken',
    tableName: 'push_tokens',
    indexes: [
      {
        unique: true,
        fields: ['token', 'platform']
      },
      {
        fields: ['user_id']
      },
      {
        fields: ['is_active']
      }
    ]
  });

  return PushToken;
};