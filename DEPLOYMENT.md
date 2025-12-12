# HEXAEQUO - Guide de Déploiement

## 🎉 Migration Complétée!

Hexaequo a été migré avec succès vers une architecture moderne avec Progressive Web App (PWA), système d'authentification, ELO rating, et client-side AI!

## 📁 Structure du Projet

```
/
├── index.html              # Page d'accueil (redirige vers frontend/)
├── manifest.json           # Manifeste PWA global
├── service-worker.js       # Service Worker pour offline
├── CNAME                   # Configuration du domaine hexaequo.com
├── .nojekyll              # Désactive Jekyll pour GitHub Pages
├── frontend/               # Application principale (SPA moderne)
│   ├── index.html          # Point d'entrée de l'app
│   ├── css/                # Styles (base, auth, game, lobby, profile)
│   ├── js/
│   │   ├── app.js          # Shell de l'application
│   │   ├── main.js         # Point d'entrée
│   │   ├── api/            # Clients REST API
│   │   ├── auth/           # Authentification (login, signup, reset)
│   │   ├── game/           # Logique de jeu et rendering
│   │   │   ├── ai/         # **Client-side AI avec Web Worker**
│   │   │   │   ├── aiEngine.js           # Minimax avec alpha-beta
│   │   │   │   ├── aiWorkerStandalone.js # Web Worker standalone
│   │   │   │   └── aiClient.js           # Interface haut niveau
│   │   │   ├── canvasGraphics.js         # Rendering canvas avancé
│   │   │   ├── boardRenderer.js          # Orchestration animations
│   │   │   └── ...
│   │   ├── lobby/          # Gestion des rooms multijoueur
│   │   ├── profile/        # Profils utilisateurs et stats
│   │   └── store/          # State management
│   └── assets/             # Icons, sounds, flags, docs
├── backend/                # API Node.js (Express + Socket.IO)
│   ├── server.js           # Serveur principal
│   ├── controllers/        # Logique métier (auth, game, rooms, etc.)
│   ├── services/           # Services (AI, ELO, email, replay, etc.)
│   ├── sockets/            # Événements temps-réel
│   ├── models/             # Modèles de données
│   └── middleware/         # Auth, validation, error handling
├── shared/                 # Logique partagée client/serveur
│   └── game/               # GameState, MoveValidator, History, etc.
└── server/                 # Serveur multiplayer legacy (Render.com)
    └── server.js           # Socket.IO + SQLite (actuellement en prod)
```

## 🚀 Déploiement sur GitHub Pages

### Étape 1: Commit et Push

```bash
cd /Users/blaise/Documents/GitHub/Hexaequo-AI
git add .
git commit -m "Migration vers web app JavaScript pure avec PWA"
git push origin main
```

### Étape 2: Activer GitHub Pages

1. Allez sur votre dépôt GitHub: https://github.com/[votre-username]/Hexaequo-AI
2. Cliquez sur "Settings" (Paramètres)
3. Dans le menu de gauche, cliquez sur "Pages"
4. Sous "Source", sélectionnez:
   - Branch: `main`
   - Folder: `/ (root)`
5. Cliquez sur "Save"
6. GitHub Pages va construire votre site (ça prend 1-2 minutes)

### Étape 3: Configuration du Domaine

Le fichier `CNAME` contient déjà `hexaequo.com`. Maintenant, configurez vos DNS:

1. Allez chez votre registrar de domaine (où vous avez acheté hexaequo.com)
2. Accédez aux paramètres DNS
3. Ajoutez les enregistrements suivants:

**Pour apex domain (hexaequo.com):**
```
Type: A
Name: @
Value: 185.199.108.153
```
```
Type: A
Name: @
Value: 185.199.109.153
```
```
Type: A
Name: @
Value: 185.199.110.153
```
```
Type: A
Name: @
Value: 185.199.111.153
```

**Pour www (optionnel):**
```
Type: CNAME
Name: www
Value: [votre-username].github.io
```

4. Attendez la propagation DNS (2-48 heures, souvent < 1 heure)

### Étape 4: Vérification

Une fois déployé:

## 🔌 Serveur Multijoueur Render

Pendant que GitHub Pages distribue le client, toutes les parties en ligne passent par `server/server.js`, un service Express + Socket.IO actuellement hébergé sur Render (free tier).

- URL publique par défaut: `https://hexaequo-server.onrender.com`
- Variables d’environnement essentielles:
    - `PORT` (Render fournit automatiquement `process.env.PORT`).
    - `FRONTEND_URL` → `https://hexaequo.com` (ajoutez aussi `http://localhost:8080` pour les tests).
    - `DATABASE_PATH` si vous souhaitez pointer vers un fichier SQLite persistant, sinon `server/hexaequo.db` est créé.
- Endpoints HTTP disponibles pour la supervision: `GET /health`, `GET /room/:code` (retourne statut + joueurs actifs).
- Socket.IO doit autoriser les origines GitHub Pages + Render pour éviter les erreurs CORS.
- Les nouvelles préférences lobby (mode timer + spectateurs) sont envoyées comme métadonnées dans `create-room`, ce qui permet à la SPA d’afficher l’intention même si le serveur ignore encore ces champs.

- Socket.IO 4.7+ pour le pont Render ↔ SPA
- L'application fonctionne offline une fois chargée
- Installation possible sur mobile et desktop

### 4. Pont Multijoueur Render
- Nouvelle interface lobby dans la SPA moderne (sélection de pseudo, timer `classic/rapid/blitz` ou mode libre).
- Basculer "Allow spectators" directement dans le formulaire de création; l’information apparaît également dans la liste de salons.
- Adaptateur `frontend/js/utils/socketClient.js` réutilise la logique historique (`hexaequo-v2/multiplayer.js`) mais sous forme d’ES module, prêt pour la future migration backend.
- Canvas adaptatif à toutes les tailles d'écran
- Support tactile optimisé
- Interface adaptée mobile/tablet/desktop
- Mode paysage supporté

### 3. Performance
- IA exécutée dans un Web Worker (UI non bloquée)
- Temps de réponse < 2 secondes pour l'IA
- Aucun serveur backend nécessaire

### 4. Compatibilité
- Chrome, Firefox, Safari, Edge (dernières versions)
- iOS Safari 11.3+
- Android Chrome 40+

## 🧪 Tests Locaux

### Tester l'Application Principale

```bash
cd "c:\Users\ebarp018\Documents\GitHub\Hexaequo-AI"
# Avec Python
python -m http.server 8000

# OU avec Node.js (si http-server installé)
npx http-server -p 8000
```

Puis ouvrez: http://localhost:8000

### Test PWA

1. Ouvrez Chrome
2. Allez sur http://localhost:8000
3. Ouvrez DevTools (F12)
4. Onglet "Application" > "Service Workers"
5. Vérifiez que le SW est enregistré (`hexaequo-v1.0.9`)
6. Onglet "Manifest" pour vérifier le manifeste
7. Testez l'installation (icône + dans la barre d'adresse)
8. Mode hors ligne: DevTools > Network > Offline, rechargez la page

### Test AI Local (Client-Side)

```javascript
// Dans la console DevTools
import { createAIClient, AI_DIFFICULTY } from '/frontend/js/game/ai/aiClient.js';

const ai = createAIClient();
console.log('Using Web Worker:', ai.usingWorker);

// Tester avec un état de jeu
const result = await ai.computeMove(gameState, AI_DIFFICULTY.MEDIUM);
console.log('AI move:', result);
```

### Test Mobile

1. Connectez votre téléphone au même réseau
2. Trouvez votre IP locale: `ipconfig` (Windows) ou `ifconfig` (Mac/Linux)
3. Ouvrez sur mobile: http://[votre-ip]:8000
4. Testez les interactions tactiles

## 🔧 Architecture Technique

### Client-Side AI (2025-12-11)

**Migration de hexaequo-v2 → frontend/js/game/ai/**

L'IA Minimax avec alpha-beta pruning maintenant disponible côté client:
- **Web Worker**: Calculs en arrière-plan (pas de blocage UI)
- **Profondeur configurable**: 2 (facile), 3 (moyen), 4 (difficile)
- **Fallback automatique**: Si Worker échoue, utilise le thread principal
- **Performance**: ~200ms (depth 3) sur hardware moderne

Exemple d'utilisation:
```javascript
import { getAIClient, AI_DIFFICULTY } from '/frontend/js/game/ai/aiClient.js';

const ai = getAIClient();
const nextState = await ai.computeMove(currentGameState, AI_DIFFICULTY.HARD);
```

### PWA Features (Service Worker)

**Stratégies de cache:**
- **Static assets**: Cache-first (CSS, JS, HTML)
- **API calls**: Network-first, cache fallback
- **Dynamic content**: Stale-while-revalidate
- **Version management**: `hexaequo-v1.0.9` (auto-cleanup old versions)

### Theme System

**Unifié sous CSS Variables** (`frontend/css/base.css`):
- Variables CSS pour dark/light themes
- Toggle dynamique via `body[data-theme='light']`
- Plus maintenable que multiple color schemes hardcodés

## 📱 Installation PWA

### Sur iOS:
1. Ouvrez Safari
2. Tapez sur l'icône de partage
3. "Ajouter à l'écran d'accueil"
4. Nommez l'app et confirmez

### Sur Android:
1. Ouvrez Chrome
2. Menu (⋮) > "Installer l'application"
3. Confirmez l'installation

### Sur Desktop (Chrome):
1. Icône + dans la barre d'adresse
2. Cliquez sur "Installer"

## 🎮 Utilisation

### Mode 2 Joueurs
- Cliquez sur "Switch to AI Mode" pour basculer
- Les deux joueurs jouent localement sur le même appareil

### Mode IA
- Le joueur noir (vous) commence
- L'IA joue blanc automatiquement après chaque coup
- L'IA calcule son coup en arrière-plan

### Règles
- Placez des tuiles (adjacentes à 2+ tuiles)
- Placez des disques et anneaux
- Déplacez vos pièces
- Capturez les pièces adverses
- Gagnez en capturant 6 disques ou 3 anneaux

## 🐛 Dépannage

### L'IA ne répond pas
- Vérifiez la console (F12) pour les erreurs
- Assurez-vous que Web Workers sont supportés
- Rechargez la page

### PWA ne s'installe pas
- Vérifiez que vous êtes en HTTPS (ou localhost)
- Vérifiez que manifest.json et service-worker.js sont accessibles
- Regardez la console pour les erreurs

### Sons ne marchent pas
- Vérifiez que les fichiers .mp3 sont présents dans sounds/
- Autorisez le son dans le navigateur
- Sur mobile, interagissez d'abord avec la page

### Canvas trop petit/grand
- Le canvas s'adapte automatiquement
- Rechargez la page
- Vérifiez les styles CSS

## 📊 Statistiques

- **Temps de développement**: Migration complète
- **Taille totale**: ~200 KB (sans sons)
- **Temps de chargement**: < 2 secondes
- **Performance IA**: < 2 secondes par coup (profondeur 2)
- **Support navigateurs**: 95%+ des utilisateurs

## 🔜 Améliorations Futures

Suggestions pour étendre l'application:

1. **Augmenter la profondeur de l'IA** (3-4) avec Web Assembly
2. **Multijoueur en ligne** avec WebSockets
3. **Classements et statistiques** avec Firebase
4. **Replay de parties** avec sauvegarde locale
5. **Tutoriel interactif** pour nouveaux joueurs
6. **Thèmes additionnels** (dark mode, etc.)
7. **Animations améliorées** pour les mouvements
8. **Son personnalisé** pour différentes actions

## 📞 Support

Si vous rencontrez des problèmes:
1. Vérifiez la console du navigateur
2. Testez sur un autre navigateur
3. Effacez le cache et rechargez
4. Vérifiez que tous les fichiers sont bien déployés

Bon jeu! 🎲

