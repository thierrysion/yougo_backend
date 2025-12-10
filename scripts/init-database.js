const { sequelize, testConnection, syncDatabase } = require('../config/database');
const { User, Driver, RideType, PricingRule, Ride, ChatMessage, RefreshToken } = require('../models/index.js');
require('dotenv').config();

const initDatabase = async () => {
  try {
    console.log('🔄 Initialisation de la base de données...');
    
    // Test de connexion
    const isConnected = await testConnection();
    if (!isConnected) {
      process.exit(1);
    }
    
    // Synchronisation des tables
    const force = process.argv.includes('--force');
    await syncDatabase(force);
	
	// Données de base
    await createBaseData();
	
    // Message de succès
    console.log(`
🎉 BASE DE DONNÉES INITIALISÉE AVEC SUCCÈS !

📊 Modèles créés :
   • Users (Utilisateurs)
   • Drivers (Chauffeurs) 
   • RideTypes (Types de courses)
   • PricingRules (Règles de tarification)
   • Rides (Courses)
   • RidePricings (Application des règles)
   • ChatMessages (Messages)
   • RefreshTokens (Tokens JWT)

🏙️  Villes supportées: ${process.env.SUPPORTED_CITIES}

Prochaines étapes :
   1. Démarrer le serveur: npm run dev
   2. Vérifier la santé: http://localhost:3000/health
   3. Implémenter l'authentification Firebase
    `);
    
	const createBaseData = async () => {
		try {
			console.log('📝 Création des données de base...');
			
			// Types de courses de base
			const rideTypes = await RideType.bulkCreate([
			  {
				name: 'eco',
				description: 'Course économique - Voiture compacte et abordable',
				base_fare: 500,
				per_km_rate: 250,
				per_minute_rate: 50,
				minimum_fare: 1000
			  },
			  {
				name: 'comfort',
				description: 'Confort - Voiture spacieuse et confortable',
				base_fare: 800,
				per_km_rate: 350,
				per_minute_rate: 70,
				minimum_fare: 1500
			  },
			  {
				name: 'premium',
				description: 'Premium - Voiture haut de gamme avec chauffeur professionnel',
				base_fare: 1200,
				per_km_rate: 500,
				per_minute_rate: 100,
				minimum_fare: 2500
			  },
			  {
				name: 'xl',
				description: 'XL - Véhicule spacieux pour 6 passagers',
				base_fare: 1000,
				per_km_rate: 400,
				per_minute_rate: 80,
				minimum_fare: 2000
			  }
			], { ignoreDuplicates: true });
			
			console.log(`✅ ${rideTypes.length} types de courses créés`);
			
			// Règles de tarification de base pour Douala
			const pricingRules = await PricingRule.bulkCreate([
			  {
				ride_type_id: rideTypes[0].id, // eco
				city: 'Douala',
				name: 'Tarif de base Eco Douala',
				description: 'Tarif standard pour les courses Eco à Douala',
				application_scope: 'base',
				condition_type: 'custom',
				condition_parameters: { type: 'always' },
				calculation_type: 'per_km',
				calculation_parameters: { rate: 250 },
				priority: 0,
				valid_from: new Date(),
				created_by: 'system'
			  },
			  {
				ride_type_id: rideTypes[1].id, // comfort
				city: 'Douala', 
				name: 'Tarif de base Comfort Douala',
				description: 'Tarif standard pour les courses Comfort à Douala',
				application_scope: 'base',
				condition_type: 'custom',
				condition_parameters: { type: 'always' },
				calculation_type: 'per_km',
				calculation_parameters: { rate: 350 },
				priority: 0,
				valid_from: new Date(),
				created_by: 'system'
			  }
			], { ignoreDuplicates: true });
			
			console.log(`✅ ${pricingRules.length} règles de tarification créées`);
		
		} catch (error) {
			console.error('❌ Erreur création données de base:', error);
		}
	};
    
    process.exit(0);    
  } catch (error) {
    console.error('❌ Erreur lors de l\'initialisation:', error);
    process.exit(1);
  }
};

// Gestion des signaux pour un arrêt propre
process.on('SIGINT', async () => {
  console.log('\n🔄 Fermeture de la connexion...');
  await sequelize.close();
  process.exit(0);
});

initDatabase();