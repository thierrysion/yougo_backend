# Utiliser une image Node.js officielle comme base
FROM node:20-slim

# Créer le répertoire de l'application
WORKDIR /usr/src/app

# Copier les fichiers de dépendances pour les installer
COPY package*.json ./

# Installer les dépendances
RUN npm install --omit=dev

# Copier le reste du code source
COPY . .

# Spécifier le port sur lequel l'application écoute
# Cloud Run injecte la variable d'environnement PORT, assurez-vous que votre
# application écoute sur process.env.PORT (généralement 8080)
EXPOSE 8080 

# Commande pour démarrer l'application
CMD [ "npm", "start" ]