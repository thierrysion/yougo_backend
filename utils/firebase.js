const admin = require('firebase-admin');
require('dotenv').config();


// Initialisation Firebase Admin SDK
const serviceAccount = {
  type: "service_account",
  project_id: process.env.FIREBASE_PROJECT_ID,
  private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
  private_key: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  client_email: process.env.FIREBASE_CLIENT_EMAIL,
  client_id: process.env.FIREBASE_CLIENT_ID,
  auth_uri: "https://accounts.google.com/o/oauth2/auth",
  token_uri: "https://oauth2.googleapis.com/token",
  auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
  client_x509_cert_url: process.env.FIREBASE_CLIENT_CERT_URL
};

try {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
  console.log('✅ Firebase Admin SDK initialisé');
} catch (error) {
  if (!/already exists/u.test(error.message)) {
    console.error('❌ Erreur initialisation Firebase:', error);
  }
}

// Service de vérification des tokens Firebase
const verifyFirebaseToken = async (idToken) => {
  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    return {
      success: true,
      uid: decodedToken.uid,
      phone: decodedToken.phone_number,
      email: decodedToken.email
    };
  } catch (error) {
    console.error('❌ Erreur vérification token Firebase:', error.message);
    return {
      success: false,
      error: error.message
    };
  }
};

// Service de récupération des infos utilisateur Firebase
const getFirebaseUser = async (uid) => {
  try {
    const userRecord = await admin.auth().getUser(uid);
    return {
      success: true,
      user: {
        uid: userRecord.uid,
        phone: userRecord.phoneNumber,
        email: userRecord.email,
        displayName: userRecord.displayName,
        photoURL: userRecord.photoURL
      }
    };
  } catch (error) {
    console.error('❌ Erreur récupération utilisateur Firebase:', error.message);
    return {
      success: false,
      error: error.message
    };
  }
};

module.exports = { admin, verifyFirebaseToken, getFirebaseUser };