// models/Route.js
const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database.js');

const Route = sequelize.define('Route', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  startLatitude: {
    type: DataTypes.DECIMAL(10, 8),
    allowNull: false,
  },
  startLongitude: {
    type: DataTypes.DECIMAL(11, 8),
    allowNull: false,
  },
  endLatitude: {
    type: DataTypes.DECIMAL(10, 8),
    allowNull: false,
  },
  endLongitude: {
    type: DataTypes.DECIMAL(11, 8),
    allowNull: false,
  },
  distance: {
    type: DataTypes.DECIMAL(8, 2), // en mètres
    allowNull: false,
  },
  duration: {
    type: DataTypes.DECIMAL(8, 2), // en secondes
    allowNull: false,
  },
  polyline: {
    type: DataTypes.TEXT, // Polyline encodée
    allowNull: false,
  },
  bounds: {
    type: DataTypes.JSON, // {northeast: {lat, lng}, southwest: {lat, lng}}
    allowNull: true,
  },
  mode: {
    type: DataTypes.ENUM('driving', 'walking', 'cycling', 'transit'),
    defaultValue: 'driving',
  },
  provider: {
    type: DataTypes.ENUM('osrm', 'google', 'mapbox'),
    defaultValue: 'osrm',
  },
  metadata: {
    type: DataTypes.JSON,
    defaultValue: {},
  },
}, {
  tableName: 'routes',
  timestamps: true,
});

module.exports = Route;