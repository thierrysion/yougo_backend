// models/Payment.js
'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class Payment extends Model {
    static associate(models) {
      Payment.belongsTo(models.Ride, {
        foreignKey: 'ride_id',
        as: 'ride'
      });
      Payment.belongsTo(models.User, {
        foreignKey: 'user_id',
        as: 'user'
      });
    }
  }

  Payment.init({
    id: {
      type: DataTypes.UUID,
      primaryKey: true,
      defaultValue: DataTypes.UUIDV4
    },
    ride_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'Rides',
        key: 'id'
      }
    },
    user_id: {
      type: DataTypes.STRING,
      allowNull: false,
      references: {
        model: 'Users',
        key: 'uid'
      }
    },
    amount: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false
    },
    currency: {
      type: DataTypes.STRING(3),
      defaultValue: 'XAF'
    },
    payment_method: {
      type: DataTypes.ENUM(
        'card',
        'mobile_money',
        'wallet',
        'cash',
        'bank_transfer'
      ),
      allowNull: false
    },
    payment_status: {
      type: DataTypes.ENUM(
        'pending',
        'processing',
        'completed',
        'failed',
        'refunded',
        'partially_refunded'
      ),
      defaultValue: 'pending'
    },
    provider: {
      type: DataTypes.ENUM('stripe', 'paypal', 'flutterwave', 'orange_money', 'mtn_money', 'cash'),
      allowNull: false
    },
    provider_payment_id: {
      type: DataTypes.STRING,
      allowNull: true
    },
    provider_transaction_id: {
      type: DataTypes.STRING,
      allowNull: true
    },
    customer_email: {
      type: DataTypes.STRING,
      allowNull: true
    },
    customer_phone: {
      type: DataTypes.STRING,
      allowNull: true
    },
    metadata: {
      type: DataTypes.JSONB,
      defaultValue: {}
    },
    failure_reason: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    refunded_amount: {
      type: DataTypes.DECIMAL(10, 2),
      defaultValue: 0
    },
    processed_at: {
      type: DataTypes.DATE,
      allowNull: true
    },
    refunded_at: {
      type: DataTypes.DATE,
      allowNull: true
    }
  }, {
    sequelize,
    modelName: 'Payment',
    tableName: 'payments',
    indexes: [
      {
        fields: ['ride_id']
      },
      {
        fields: ['user_id']
      },
      {
        fields: ['provider_payment_id']
      },
      {
        fields: ['payment_status']
      }
    ]
  });

  return Payment;
};