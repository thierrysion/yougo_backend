// Fichier d'export centralisé pour tous les modèles
// Les modèles individuels seront créés dans la Phase 2

/*export { default as User } from './User.js';
export { default as Driver } from './Driver.js';
export { default as RideType } from './RideType.js';
export { default as PricingRule } from './PricingRule.js';
export { default as Ride } from './Ride.js';
export { default as RidePricing } from './RidePricing.js';
export { default as ChatMessage } from './ChatMessage.js';
export { default as RefreshToken } from './RefreshToken.js';*/
const { sequelize } = require('../config/database.js');
const User = require('./User.js');
const Driver = require('./Driver.js');
const RideType = require('./RideType.js');
const PricingRule = require('./PricingRule.js');
const Ride = require('./Ride.js');
const RidePricing = require('./RidePricing.js');
const ChatMessage = require('./ChatMessage.js');
const RefreshToken = require('./RefreshToken.js');

// Définition des relations entre les modèles

// User ↔ Driver (One-to-One)
User.hasOne(Driver, {
  foreignKey: 'user_id',
  as: 'driver_profile',
  onDelete: 'CASCADE',
  onUpdate: 'CASCADE'
});

Driver.belongsTo(User, {
  foreignKey: 'user_id',
  as: 'user',
  onDelete: 'CASCADE',
  onUpdate: 'CASCADE'
});

// User ↔ Ride (One-to-Many - Customer)
User.hasMany(Ride, {
  foreignKey: 'customer_id',
  as: 'customer_rides',
  onDelete: 'RESTRICT',
  onUpdate: 'CASCADE'
});

Ride.belongsTo(User, {
  foreignKey: 'customer_id',
  as: 'customer',
  onDelete: 'RESTRICT',
  onUpdate: 'CASCADE'
});

// Driver ↔ Ride (One-to-Many - Driver)
Driver.hasMany(Ride, {
  foreignKey: 'driver_id',
  as: 'driver_rides',
  onDelete: 'RESTRICT',
  onUpdate: 'CASCADE'
});

Ride.belongsTo(Driver, {
  foreignKey: 'driver_id',
  as: 'driver',
  onDelete: 'RESTRICT',
  onUpdate: 'CASCADE'
});

// RideType ↔ Driver (One-to-Many)
RideType.hasMany(Driver, {
  foreignKey: 'ride_type_id',
  as: 'drivers',
  onDelete: 'RESTRICT',
  onUpdate: 'CASCADE'
});

Driver.belongsTo(RideType, {
  foreignKey: 'ride_type_id',
  as: 'ride_type',
  onDelete: 'RESTRICT',
  onUpdate: 'CASCADE'
});

// RideType ↔ Ride (One-to-Many)
RideType.hasMany(Ride, {
  foreignKey: 'ride_type_id',
  as: 'rides',
  onDelete: 'RESTRICT',
  onUpdate: 'CASCADE'
});

Ride.belongsTo(RideType, {
  foreignKey: 'ride_type_id',
  as: 'ride_type',
  onDelete: 'RESTRICT',
  onUpdate: 'CASCADE'
});

// RideType ↔ PricingRule (One-to-Many)
RideType.hasMany(PricingRule, {
  foreignKey: 'ride_type_id',
  as: 'pricing_rules',
  onDelete: 'CASCADE',
  onUpdate: 'CASCADE'
});

PricingRule.belongsTo(RideType, {
  foreignKey: 'ride_type_id',
  as: 'ride_type',
  onDelete: 'CASCADE',
  onUpdate: 'CASCADE'
});

// Ride ↔ RidePricing (One-to-Many)
Ride.hasMany(RidePricing, {
  foreignKey: 'ride_id',
  as: 'applied_pricing_rules',
  onDelete: 'CASCADE',
  onUpdate: 'CASCADE'
});

RidePricing.belongsTo(Ride, {
  foreignKey: 'ride_id',
  as: 'ride',
  onDelete: 'CASCADE',
  onUpdate: 'CASCADE'
});

// PricingRule ↔ RidePricing (One-to-Many)
PricingRule.hasMany(RidePricing, {
  foreignKey: 'pricing_rule_id',
  as: 'ride_applications',
  onDelete: 'CASCADE',
  onUpdate: 'CASCADE'
});

RidePricing.belongsTo(PricingRule, {
  foreignKey: 'pricing_rule_id',
  as: 'pricing_rule',
  onDelete: 'CASCADE',
  onUpdate: 'CASCADE'
});

// Ride ↔ ChatMessage (One-to-Many)
Ride.hasMany(ChatMessage, {
  foreignKey: 'ride_id',
  as: 'chat_messages',
  onDelete: 'CASCADE',
  onUpdate: 'CASCADE'
});

ChatMessage.belongsTo(Ride, {
  foreignKey: 'ride_id',
  as: 'ride',
  onDelete: 'CASCADE',
  onUpdate: 'CASCADE'
});

// User ↔ ChatMessage (One-to-Many - Sender)
User.hasMany(ChatMessage, {
  foreignKey: 'sender_id',
  as: 'sent_messages',
  onDelete: 'RESTRICT',
  onUpdate: 'CASCADE'
});

ChatMessage.belongsTo(User, {
  foreignKey: 'sender_id',
  as: 'sender',
  onDelete: 'RESTRICT',
  onUpdate: 'CASCADE'
});

// User ↔ RefreshToken (One-to-Many)
User.hasMany(RefreshToken, {
  foreignKey: 'user_id',
  as: 'refresh_tokens',
  onDelete: 'CASCADE',
  onUpdate: 'CASCADE'
});

RefreshToken.belongsTo(User, {
  foreignKey: 'user_id',
  as: 'user',
  onDelete: 'CASCADE',
  onUpdate: 'CASCADE'
});

// User ↔ Driver (Admin approval)
User.hasMany(Driver, {
  foreignKey: 'approved_by_admin_id',
  as: 'approved_drivers',
  onDelete: 'SET NULL',
  onUpdate: 'CASCADE'
});

Driver.belongsTo(User, {
  foreignKey: 'approved_by_admin_id',
  as: 'approved_by_admin',
  onDelete: 'SET NULL',
  onUpdate: 'CASCADE'
});

// User ↔ PricingRule (Creator)
User.hasMany(PricingRule, {
  foreignKey: 'created_by',
  as: 'created_pricing_rules',
  onDelete: 'RESTRICT',
  onUpdate: 'CASCADE'
});

PricingRule.belongsTo(User, {
  foreignKey: 'created_by',
  as: 'creator',
  onDelete: 'RESTRICT',
  onUpdate: 'CASCADE'
});

// Export de tous les modèles et de la connexion
module.exports = { sequelize, User, Driver, RideType, PricingRule, Ride, ChatMessage, RefreshToken }