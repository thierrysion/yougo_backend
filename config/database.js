const { Sequelize } = require('sequelize');
require('dotenv').config();

const sequelize = new Sequelize(
  process.env.DB_NAME,
  process.env.DB_USER,
  process.env.DB_PASSWORD,
  {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    dialect: 'postgres',
    logging: process.env.NODE_ENV === 'development' ? console.log : false,
    pool: {
      max: 10,
      min: 0,
      acquire: 30000,
      idle: 10000
    },
    define: {
      timestamps: true,
      underscored: true,
	  freezeTableName: true
    }
	
	// Timezone pour le Cameroun
    //timezone: '+01:00'
  }
);

const testConnection = async () => {
  try {
    await sequelize.authenticate();
    console.log('✅ PostgreSQL connecté avec succès');
    return true;
  } catch (error) {
    console.error('❌ Impossible de se connecter à PostgreSQL:', error.message);
    return false;
  }
};

// Synchronisation sécurisée (seulement en développement)
const syncDatabase = async (force = false) => {
  try {
    if (process.env.NODE_ENV === 'development' || force) {
      await sequelize.sync({ force });
      console.log('✅ Base de données synchronisée');
    } else {
      console.log('ℹ️  Synchronisation auto désactivée en production');
    }
  } catch (error) {
    console.error('❌ Erreur synchronisation base de données:', error);
    throw error;
  }
};

module.exports = { sequelize, testConnection, syncDatabase };