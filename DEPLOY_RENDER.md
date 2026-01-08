# 🚀 Guide de Déploiement Render.com - Hexaequo

## ⚠️ Problème Rencontré

**Erreur en production** :
```
Origin https://hexaequo.com is not allowed by Access-Control-Allow-Origin. 
Status code: 404
XMLHttpRequest cannot load https://hexaequo-backend.onrender.com/socket.io/
```

**Cause** : Socket.IO retourne 404 au lieu de répondre correctement.

## ✅ Solution Appliquée

### 1. Ordre des Middlewares Corrigé

Socket.IO doit être initialisé **AVANT** les middlewares de fichiers statiques et le SPA fallback.

**Ordre correct** :
1. Express app + middlewares de base (CORS, body-parser)
2. Routes API
3. **Créer le serveur HTTP**
4. **Initialiser Socket.IO** ← CRITIQUE
5. Fichiers statiques
6. 404 handler pour API
7. SPA fallback
8. Error handler

### 2. Logs de Debug Ajoutés

Le serveur affiche maintenant :
```
🔌 Initializing Socket.IO server...
✅ Socket.IO server created with CORS origins: 15 origins
✅ Socket.IO transports: [ 'polling', 'websocket' ]
✅ Socket.IO path: /socket.io
✅ Socket.IO initialized on server

🎮 Hexaequo Backend Server running on port 3001
   Socket.IO initialized: YES
   Socket.IO path: /socket.io/
   Public URL: https://hexaequo-backend.onrender.com
```

## 📋 Configuration Render.com

### Settings à Vérifier

1. **Build Command** : (laissez vide ou `npm install`)
2. **Start Command** : `node server.js` OU `npm start`
3. **Root Directory** : `backend`
4. **Environment** : `Node`
5. **Region** : `Frankfurt (EU Central)` (pour performance en Europe)

### Variables d'Environnement Requises

Dans Render Dashboard → Service → Environment :

```bash
# OBLIGATOIRE
NODE_ENV=production
PORT=3001
FRONTEND_URL=https://hexaequo.com

# Base de données (si PostgreSQL activé)
DATABASE_URL=<fourni automatiquement par Render>

# JWT (CRITIQUE - changer en production !)
JWT_SECRET=<votre-secret-jwt-unique>
JWT_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d

# Email (optionnel)
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
EMAIL_FROM=Hexaequo <noreply@hexaequo.com>

# Security
BCRYPT_ROUNDS=12
```

### ⚡ Configuration Avancée (Optionnel)

**Health Check Path** : `/health`  
**Auto-Deploy** : `Yes` (déploiement automatique sur push GitHub)

## 🔍 Vérification du Déploiement

### 1. Vérifier les Logs Render

Après le déploiement, dans Render Dashboard → Logs, cherchez :

```
✅ Socket.IO initialized on server
🎮 Hexaequo Backend Server running on port 3001
   Socket.IO initialized: YES
   Public URL: https://hexaequo-backend.onrender.com
```

Si vous voyez ces logs, Socket.IO est correctement initialisé.

### 2. Tester le Health Check

```bash
curl https://hexaequo-backend.onrender.com/health
```

Devrait retourner :
```json
{
  "status": "ok",
  "timestamp": "...",
  "uptime": 123.45
}
```

### 3. Tester Socket.IO

```bash
curl "https://hexaequo-backend.onrender.com/socket.io/?EIO=4&transport=polling"
```

**Si ça fonctionne** : Retourne une longue chaîne encodée (commençant souvent par `0{...`)  
**Si ça ne fonctionne pas** : Retourne 404 ou erreur HTML

### 4. Tester depuis le Frontend

Ouvrez la console navigateur sur https://hexaequo.com et cherchez :

**✅ Succès** :
```
Connected to server
Socket connected: true
```

**❌ Échec** :
```
Connection error: Error: xhr poll error
Failed to load resource: Status code 404
```

## 🐛 Troubleshooting

### Erreur : 404 sur /socket.io/

**Cause possible** :
- Render n'a pas redémarré le service après le push
- Le build a échoué
- Les dépendances ne sont pas installées

**Solution** :
1. Dans Render Dashboard : **Manual Deploy** → **Clear build cache & deploy**
2. Vérifier les logs de build pour des erreurs
3. Vérifier que `socket.io` est dans `backend/package.json` dependencies (pas devDependencies)

### Erreur : CORS Policy

**Cause** : L'origine du frontend n'est pas dans la liste CORS

**Solution** : Vérifier que `https://hexaequo.com` est bien dans :
- `backend/socket/socketHandler.js` (ligne ~25)
- `backend/server.js` CORS config (ligne ~35)

### Erreur : Service Unavailable ou Timeout

**Cause** : Render cold start (serveur endormi)

**Solution** :
- Render Free tier met les services en veille après 15 min d'inactivité
- Premier accès après veille prend ~30 secondes
- Pour éviter : passer au plan payant ($7/mois) ou utiliser un ping service

### Le serveur démarre mais crash immédiatement

**Vérifier** :
1. Variables d'environnement manquantes (surtout `PORT`, `NODE_ENV`, `FRONTEND_URL`)
2. Erreur de syntaxe dans le code
3. Module npm manquant

**Dans les logs Render** cherchez :
```
Error: Cannot find module 'xyz'
```

**Solution** : Vérifier que toutes les dépendances sont dans `package.json`

## 🔄 Workflow de Déploiement Optimal

### Développement → Production

1. **Tester en local** :
   ```bash
   ./dev-local.sh
   ```
   Vérifier sur http://localhost:8080

2. **Commit** :
   ```bash
   git add .
   git commit -m "Description des changements"
   ```

3. **Push sur GitHub** :
   ```bash
   git push origin main
   ```

4. **Render Auto-Deploy** :
   - Render détecte le push et redéploie automatiquement
   - Durée : ~2-5 minutes

5. **Vérifier en production** :
   - Ouvrir https://hexaequo.com
   - Tester le multiplayer
   - Vérifier les logs Render si problème

## 📊 Monitoring en Production

### Logs à Surveiller

Dans Render Dashboard → Logs, surveillez :

**✅ Bon signe** :
```
🎮 Hexaequo Backend Server running on port 3001
Client connected: xyz123 (guest)
✅ Database connected
```

**⚠️ Attention** :
```
⚠️  Database not connected (running in memory mode)
```
→ Normal en dev, mais en production il faut une DB PostgreSQL

**❌ Problème** :
```
Error: Cannot find module
EADDRINUSE: Port already in use
Uncaught Exception: ...
```

### Performance

- **Cold Start** : ~10-30 secondes (Free tier)
- **Requête Socket.IO** : ~50-200ms (Europe)
- **Reconnexion automatique** : 5 tentatives

## 🎯 Checklist Avant de Pusher

- [ ] Code testé en local avec `./dev-local.sh`
- [ ] Aucune erreur dans les logs backend
- [ ] Socket.IO fonctionne en local (http://localhost:8080/test-socket.html)
- [ ] Multiplayer testé avec 2 onglets/navigateurs
- [ ] Pas de `console.log()` de debug inutiles
- [ ] Variables d'environnement sensibles dans `.env` (pas dans le code)
- [ ] Fichiers `.env` dans `.gitignore` (ne pas commit les secrets !)

## 🔐 Sécurité

**IMPORTANT** : Ne JAMAIS commiter :
- `.env` avec secrets en production
- Clés JWT en clair dans le code
- Mots de passe de base de données

Tous les secrets doivent être dans Render Environment Variables.

## 📚 Liens Utiles

- [Render Dashboard](https://dashboard.render.com/)
- [Render Node.js Guide](https://render.com/docs/deploy-node-express-app)
- [Socket.IO avec Render](https://socket.io/docs/v4/server-deployment/#render)
- [Logs Render en temps réel](https://dashboard.render.com/)

---

**Dernière mise à jour** : 7 janvier 2026  
**Status** : ✅ Socket.IO corrigé et fonctionnel en local  
**Prochaine étape** : Push sur GitHub et vérifier sur Render
