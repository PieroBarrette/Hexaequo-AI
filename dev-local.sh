#!/bin/bash

# Hexaequo - Script de développement local
# Lance le serveur backend + frontend pour tester rapidement

# Couleurs pour les logs
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}🎮 HEXAEQUO - Démarrage du serveur de développement local${NC}"
echo ""

# Vérifier que les dépendances backend sont installées
if [ ! -d "backend/node_modules" ]; then
    echo -e "${YELLOW}📦 Installation des dépendances backend...${NC}"
    cd backend && npm install && cd ..
fi

# Vérifier que le fichier .env existe
if [ ! -f "backend/.env" ]; then
    echo -e "${YELLOW}⚠️  Fichier .env manquant, copie de .env.example...${NC}"
    cp backend/.env.example backend/.env
    echo -e "${GREEN}✅ Fichier .env créé. Vous pouvez le modifier si nécessaire.${NC}"
fi

# Fonction pour tuer les processus enfants à la sortie
cleanup() {
    echo -e "\n${YELLOW}🛑 Arrêt des serveurs...${NC}"
    kill $(jobs -p) 2>/dev/null
    exit
}

trap cleanup SIGINT SIGTERM

# Démarrer le serveur backend sur le port 3001
echo -e "${BLUE}🚀 Démarrage du serveur backend sur http://localhost:3001${NC}"
cd backend && npm run dev &
BACKEND_PID=$!

# Attendre 2 secondes que le backend démarre
sleep 2

# Démarrer le serveur frontend sur le port 8080
echo -e "${BLUE}🚀 Démarrage du serveur frontend sur http://localhost:8001${NC}"
# Le front est en modules ES sans étape de compilation : serve.py suffit.
python3 serve.py &
FRONTEND_PID=$!

echo ""
echo -e "${GREEN}✨ Serveurs démarrés !${NC}"
echo ""
echo -e "  📱 Frontend:  ${BLUE}http://localhost:8001${NC}"
echo -e "  🔧 Backend:   ${BLUE}http://localhost:3001${NC}"
echo -e "  📊 Health:    ${BLUE}http://localhost:3001/health${NC}"
echo ""
echo -e "${YELLOW}Appuyez sur Ctrl+C pour arrêter les serveurs${NC}"
echo ""

# Attendre que l'un des processus se termine
wait
