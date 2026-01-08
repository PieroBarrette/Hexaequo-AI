# 🔧 Correctifs Appliqués - Socket.IO

## Problème Initial

Erreur de connexion Socket.IO dans le navigateur :
```
Failed to load resource: Connexion au serveur impossible. (socket.io, line 0)
Connection error: Error: xhr poll error
```

## Modifications Apportées

### 1. **Correction de l'architecture du serveur HTTP** ([backend/server.js](backend/server.js))

**Avant** (Problématique) :
```javascript
// Création d'un serveur HTTP vide
const httpServer = createServer();

// Socket.IO attaché au serveur vide
const io = initializeSocket(httpServer);

// Express attaché via event listener
httpServer.on('request', app);
```

**Après** (Correct) :
```javascript
// Express app créé en premier avec tous ses middlewares
const app = express();
// ... configuration de app ...

// Serveur HTTP créé AVEC l'app Express
const httpServer = createServer(app);

// Socket.IO attaché au serveur qui utilise Express
const io = initializeSocket(httpServer);
```

**Pourquoi ce changement ?**
- Socket.IO doit être attaché à un serveur HTTP qui utilise déjà Express
- La méthode `httpServer.on('request', app)` ne garantit pas le bon ordre de traitement
- Créer le serveur avec `createServer(app)` assure qu'Express gère toutes les requêtes HTTP, et Socket.IO intercepte seulement `/socket.io/*`

### 2. **Suppression du middleware bloquant** ([backend/server.js](backend/server.js))

**Supprimé** :
```javascript
app.use((req, res, next) => {
    if (req.path.startsWith('/socket.io')) {
        return; // Ne bloque plus Express
    }
    next();
});
```

**Pourquoi ?**
- Ce middleware bloquait les requêtes `/socket.io` mais ne les transférait à personne
- Socket.IO gère automatiquement ses propres routes quand attaché correctement
- Pas besoin de middleware personnalisé pour éviter les conflits

### 3. **Correction du typo dans socketHandler** ([backend/socket/socketHandler.js](backend/socket/socketHandler.js))

**Avant** :
```javascript
connectedSockets.set(socket.id, {
    oderId: playerId,  // ❌ Typo!
    pseudo: socket.pseudo || 'Guest',
    roomCode: null
});
```

**Après** :
```javascript
connectedSockets.set(socket.id, {
    userId: playerId,  // ✅ Correct
    pseudo: socket.pseudo || 'Guest',
    roomCode: null
});
```

### 4. **Amélioration des logs de démarrage** ([backend/server.js](backend/server.js))

Ajout de logs plus explicites :
```javascript
httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🎮 Hexaequo Backend Server running on port ${PORT}`);
    console.log(`   Listening on: 0.0.0.0:${PORT}`);
    console.log(`   Socket.IO endpoint: http://localhost:${PORT}/socket.io/`);
    // ...
});
```

## Comment Vérifier que Ça Fonctionne

### 1. Démarrer les serveurs
```bash
./dev-local.sh
```

### 2. Ouvrir la page de test
```bash
open http://localhost:8080/test-socket.html
```

Ou manuellement :
- Ouvrir votre navigateur
- Aller à http://localhost:8080/test-socket.html

### 3. Vérifier les logs

Dans la page de test, vous devriez voir :
```
✅ CONNEXION RÉUSSIE ! Socket ID: xyz123
✅ Transport utilisé: polling (puis upgrade vers websocket)
```

### 4. Test via curl (optionnel)
```bash
curl "http://localhost:3001/socket.io/?EIO=4&transport=polling"
```

Devrait retourner une réponse Socket.IO (longue chaîne de caractères encodés).

## Configuration Socket.IO

### Côté Serveur ([backend/socket/socketHandler.js](backend/socket/socketHandler.js))

```javascript
const io = new Server(httpServer, {
    cors: {
        origin: [
            'http://localhost:8080',
            'http://localhost:3001',
            // ... autres origines autorisées
        ],
        methods: ['GET', 'POST'],
        credentials: true
    },
    transports: ['polling', 'websocket'],
    pingTimeout: 120000,
    pingInterval: 25000,
    allowUpgrades: true
});
```

### Côté Client ([hexaequo-v2/multiplayer.js](hexaequo-v2/multiplayer.js))

```javascript
socket = io('http://localhost:3001', {
    transports: ['polling', 'websocket'],
    upgrade: true,
    timeout: 20000,
    reconnection: true,
    reconnectionAttempts: 5
});
```

## Ordre d'Initialisation Correct

1. ✅ Créer l'application Express
2. ✅ Configurer les middlewares (CORS, body-parser, etc.)
3. ✅ Définir les routes API
4. ✅ Créer le serveur HTTP avec Express : `createServer(app)`
5. ✅ Initialiser Socket.IO avec le serveur HTTP
6. ✅ Démarrer le serveur : `httpServer.listen(PORT)`

## Problèmes Courants et Solutions

### ❌ Erreur : `xhr poll error`
**Cause** : Socket.IO ne peut pas se connecter au serveur  
**Solution** : Vérifier que le backend est démarré sur le bon port (3001)

### ❌ Erreur : `CORS policy`
**Cause** : L'origine du frontend n'est pas dans la liste CORS  
**Solution** : Ajouter l'URL dans `socketHandler.js` configuration CORS

### ❌ Erreur : `404 Not Found` sur `/socket.io/`
**Cause** : Socket.IO n'est pas correctement attaché au serveur  
**Solution** : Utiliser `createServer(app)` et non `createServer()` vide

### ❌ Le serveur ne démarre pas
**Cause** : Port déjà utilisé ou erreur de syntaxe  
**Solutions** :
```bash
# Trouver le processus sur le port 3001
lsof -ti:3001

# Tuer le processus
kill -9 $(lsof -ti:3001)

# Vérifier la syntaxe
node -c backend/server.js
```

## Tests de Validation

### Test 1 : Health Check
```bash
curl http://localhost:3001/health
```
Attendu : `{"status":"ok", ...}`

### Test 2 : Socket.IO Endpoint
```bash
curl "http://localhost:3001/socket.io/?EIO=4&transport=polling"
```
Attendu : Longue réponse encodée (pas une 404)

### Test 3 : Page de Test
Ouvrir http://localhost:8080/test-socket.html  
Attendu : Logs verts "✅ CONNEXION RÉUSSIE !"

## Liens Utiles

- [Documentation Socket.IO](https://socket.io/docs/v4/)
- [Socket.IO avec Express](https://socket.io/docs/v4/server-installation/)
- [CORS avec Socket.IO](https://socket.io/docs/v4/handling-cors/)
- [Guide de développement local](DEV_LOCAL.md)

## Prochaines Étapes

Une fois que Socket.IO fonctionne en local :

1. ✅ Tester la création de room
2. ✅ Tester le join de room
3. ✅ Tester les mouvements multiplayer
4. ✅ Commit et push sur GitHub
5. ✅ Déployer sur Render
6. ✅ Vérifier que ça fonctionne en production

---

**Date de correction** : 7 janvier 2026  
**Fichiers modifiés** :
- `backend/server.js` (architecture HTTP/Socket.IO)
- `backend/socket/socketHandler.js` (typo userId)
- `test-socket.html` (outil de test créé)
