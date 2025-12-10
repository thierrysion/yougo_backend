// models/Notification.js
'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class Notification extends Model {
    static associate(models) {
      Notification.belongsTo(models.User, {
        foreignKey: 'user_id',
        as: 'user'
      });
    }
  }

  Notification.init({
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
    title: {
      type: DataTypes.STRING,
      allowNull: false
    },
    body: {
      type: DataTypes.TEXT,
      allowNull: false
    },
    type: {
      type: DataTypes.ENUM(
        'ride_request',           // Nouvelle demande de course
        'ride_accepted',          // Course acceptée
        'ride_cancelled',         // Course annulée
        'ride_completed',         // Course terminée
        'driver_en_route',        // Chauffeur en chemin
        'driver_arrived',         // Chauffeur arrivé
        'payment_success',        // Paiement réussi
        'payment_failed',         // Échec paiement
        'promotional',            // Promotion
        'system',                 // Notification système
        'chat_message',           // Nouveau message
        'rating_reminder'         // Rappel d'évaluation
      ),
      allowNull: false
    },
    data: {
      type: DataTypes.JSONB,
      defaultValue: {}
    },
    priority: {
      type: DataTypes.ENUM('low', 'normal', 'high'),
      defaultValue: 'normal'
    },
    is_read: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    is_sent: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    sent_at: {
      type: DataTypes.DATE,
      allowNull: true
    },
    read_at: {
      type: DataTypes.DATE,
      allowNull: true
    },
    expires_at: {
      type: DataTypes.DATE,
      allowNull: true
    },
    delivery_methods: {
      type: DataTypes.JSONB,
      defaultValue: ['push', 'in_app'] // push, in_app, email, sms
    }
  }, {
    sequelize,
    modelName: 'Notification',
    tableName: 'notifications',
    indexes: [
      {
        fields: ['user_id', 'is_read']
      },
      {
        fields: ['type']
      },
      {
        fields: ['created_at']
      }
    ]
  });

  return Notification;
};