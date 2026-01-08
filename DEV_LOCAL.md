# 🛠️ Guide de Développement Local - Hexaequo

## 🚀 Démarrage Rapide

### Option 1 : Script automatique (recommandé)

```bash
# Rendre le script exécutable (première fois seulement)
chmod +x dev-local.sh

# Lancer les serveurs
./dev-local.sh
```

Le script démarre automatiquement :
- **Frontend** : http://localhost:8080
- **Backend** : http://localhost:3001

Appuyez sur `Ctrl+C` pour arrêter les deux serveurs.

---

### Option 2 : Démarrage manuel

#### Terminal 1 - Backend (WebSocket + API REST)

```bash
cd backend
npm install  # Première fois seulement
npm run dev  # Lance avec nodemon (redémarre automatiquement)
```

Le serveur backend sera disponible sur **http://localhost:3001**

#### Terminal 2 - Frontend

```bash
cd hexaequo-v2
npx http-server -p 8080 -c-1 --cors
```

Le frontend sera disponible sur **http://localhost:8080**

---

## 📁 Structure du Projet

```
/backend          → Serveur backend (API REST + WebSocket)
  ├── server.js   → Point d'entrée
  ├── socket/     → Gestion WebSocket
  ├── routes/     → Routes API REST
  └── .env        → Configuration locale

/hexaequo-v2      → Frontend (HTML/CSS/JS)
  ├── index.html  → Page principale
  ├── multiplayer.js → Client WebSocket
  └── modules/    → Logique de jeu

/shared/game      → Logique partagée entre frontend et backend
```

---

## ⚙️ Configuration

### Fichier `.env` du Backend

Le fichier `/backend/.env` contient la configuration locale. Valeurs par défaut :

```env
NODE_ENV=development
PORT=3001
FRONTEND_URL=http://localhost:8080
DATABASE_URL=postgresql://postgres:password@localhost:5432/hexaequo
JWT_SECRET=hexaequo-jwt-secret-change-this-in-production-2026
```

**Note** : En mode développement, la base de données n'est pas obligatoire. Le serveur utilise un store en mémoire si la DB n'est pas disponible.

---

## 🔄 Workflow de Développement

### 1. Modifier le Code

- **Frontend** : Les fichiers dans `/hexaequo-v2` se rechargent automatiquement (refresh navigateur)
- **Backend** : Nodemon redémarre automatiquement le serveur à chaque modification

### 2. Tester en Local

1. Ouvrir http://localhost:8080
2. Les changements sont immédiats, pas besoin de commit/deploy
3. Les WebSockets sont connectés à `localhost:3001`

### 3. Déployer sur Render (quand prêt)

```bash
git add .
git commit -m "Description des changements"
git push origin main
```

Render redéploie automatiquement après le push.

---

## 🧪 Tests et Debugging

### Vérifier que le Backend Fonctionne

```bash
curl http://localhost:3001/health
```

Devrait retourner :
```json
{
  "status": "ok",
  "timestamp": "...",
  "uptime": 123.45
}
```

### Logs du Backend

Nodemon affiche les logs en temps réel dans le terminal. Cherchez :
- `✅ Database connected` ou `⚠️ Database not connected (running in memory mode)`
- `🎮 Hexaequo Backend Server running on port 3001`
- `WebSocket: enabled`

### Tester les WebSockets

Ouvrez la console du navigateur (F12) sur http://localhost:8080 et tapez :

```javascript
// Vérifier la connexion WebSocket
console.log('Socket connected:', window.socket?.connected);
```

---

## 🔧 Commandes Utiles

### Backend

```bash
cd backend

# Développement avec auto-reload
npm run dev

# Production
npm start

# Initialiser la base de données (si PostgreSQL configuré)
npm run db:init

# Réinitialiser la base de données
npm run db:reset
```

### Frontend

```bash
cd hexaequo-v2

# Serveur HTTP simple (recommandé)
npx http-server -p 8080 -c-1 --cors

# Alternative : Python (si installé)
python3 -m http.server 8080

# Alternative : Node.js (si installé globalement)
http-server -p 8080
```

---

## 🐛 Troubleshooting

### Port déjà utilisé

**Backend (3001)** :
```bash
# Trouver le processus
lsof -ti:3001

# Tuer le processus
kill -9 $(lsof -ti:3001)
```

**Frontend (8080)** :
```bash
# Trouver le processus
lsof -ti:8080

# Tuer le processus
kill -9 $(lsof -ti:8080)
```

### Erreur de connexion WebSocket

1. Vérifier que le backend est démarré : http://localhost:3001/health
2. Vérifier les logs du backend pour des erreurs Socket.IO
3. Vérifier que le frontend charge bien `multiplayer.js`
4. Ouvrir la console navigateur (F12) et chercher des erreurs

### Base de données non connectée

Ce n'est **pas un problème** en développement ! Le serveur fonctionne en mode mémoire.

Pour utiliser PostgreSQL :
1. Installer PostgreSQL : `brew install postgresql` (macOS)
2. Créer la DB : `createdb hexaequo`
3. Mettre à jour `backend/.env` avec l'URL correcte
4. Initialiser : `cd backend && npm run db:init`

---

## 📊 Avantages du Développement Local

✅ **Rapide** : Changements instantanés sans commit/deploy  
✅ **Offline** : Travaillez sans connexion internet  
✅ **Debugger facilement** : Logs en temps réel + outils de dev  
✅ **Tests multiples** : Testez autant que nécessaire sans limites  
✅ **Pas de coûts** : Pas de déploiement sur Render à chaque test  

---

## 🎯 Workflow Recommandé

1. **Développer en local** : Utilisez `./dev-local.sh`
2. **Tester localement** : http://localhost:8080
3. **Commit seulement quand c'est stable**
4. **Push sur GitHub pour déployer** sur Render

**Avant** : Modifier → Commit → Push → Deploy Render → Tester (5-10 min)  
**Maintenant** : Modifier → Tester immédiatement (< 1 sec)

---

## 📝 Notes Importantes

- Le backend écoute sur **0.0.0.0** pour être accessible depuis d'autres appareils sur le réseau local
- Les CORS sont configurés pour accepter `http://localhost:8080`
- La base de données n'est **pas requise** en développement (mode mémoire)
- Les WebSockets sont gérés par le serveur backend sur le même port (3001)

---

## 🤝 Besoin d'Aide ?

Vérifiez les logs dans les terminaux :
- **Terminal backend** : Messages du serveur Node.js
- **Console navigateur (F12)** : Erreurs JavaScript frontend

Pour plus de détails sur les événements WebSocket : voir [docs/SOCKET_EVENTS.md](docs/SOCKET_EVENTS.md)
