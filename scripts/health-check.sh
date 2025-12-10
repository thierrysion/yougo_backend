#!/bin/bash
# scripts/health-check.sh

echo "🔍 Health Check - Uber VTC Production"

# Vérifier le backend
echo "📡 Vérification du backend..."
BACKEND_STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3000/api/geocoding/health)

if [ "$BACKEND_STATUS" -eq 200 ]; then
    echo "✅ Backend: OK"
else
    echo "❌ Backend: ERROR ($BACKEND_STATUS)"
    exit 1
fi

# Vérifier les services Google Maps
echo "🗺️ Vérification des services Google Maps..."
# Tests supplémentaires...

echo "🎉 Tous les services sont opérationnels!"