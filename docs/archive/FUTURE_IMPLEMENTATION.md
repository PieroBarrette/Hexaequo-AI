# Hexaequo - Plan d'implémentation des nouvelles fonctionnalités

**Date**: Janvier 2026  
**Statut**: Planification  
**Référence**: TO_DO.md

---

## Vue d'ensemble

Ce document décrit l'architecture et le plan d'implémentation pour les nouvelles fonctionnalités majeures d'Hexaequo, incluant la refonte de l'interface utilisateur, le système de matchmaking automatique, le chat in-game, et le système de profil utilisateur complet.

---

## 1. Architecture globale souhaitée

### 1.1 Composants Frontend (nouveaux)

```
hexaequo-v2/
├── components/
│   ├── userMenu.js              # Menu hamburger utilisateur (nouveau)
│   ├── matchmaking.js           # Système Play/Invite (nouveau)
│   ├── chat.js                  # Chat in-game (nouveau)
│   ├── profile.js               # Page profil utilisateur (nouveau)
│   ├── gameHistory.js           # Liste historique parties (nouveau)
│   ├── replayViewer.js          # Lecteur de replay (nouveau)
│   └── qrCodeModal.js           # Modal QR code invitation (nouveau)
├── styles/
│   ├── userMenu.css             # Styles menu utilisateur (nouveau)
│   ├── matchmaking.css          # Styles matchmaking (nouveau)
│   ├── chat.css                 # Styles chat (nouveau)
│   └── profile.css              # Styles profil (nouveau)
└── assets/
    └── icons/
        ├── user-icon-light.png  # Icône utilisateur mode clair
        └── user-icon-dark.png   # Icône utilisateur mode sombre
```

### 1.2 Composants Backend (nouveaux/modifiés)

```
backend/
├── models/
│   ├── userPreferencesModel.js  # Settings online utilisateur (nouveau)
│   ├── chatMessageModel.js      # Messages chat (nouveau)
│   └── matchmakingQueueModel.js # File d'attente matchmaking (nouveau)
├── services/
│   ├── matchmakingService.js    # Logique matchmaking (nouveau)
│   ├── chatService.js           # Gestion chat (nouveau)
│   ├── invitationService.js     # Liens d'invitation (nouveau)
│   └── eloService.js            # À MODIFIER: formules ELO par cadence
├── controllers/
│   ├── matchmakingController.js # Endpoints matchmaking (nouveau)
│   ├── chatController.js        # Endpoints chat (nouveau)
│   └── userController.js        # À MODIFIER: ajout préférences
└── socket/
    └── socketHandler.js         # À MODIFIER: events chat + matchmaking
```

### 1.3 Base de données (nouvelles tables)

```sql
-- Préférences utilisateur online
CREATE TABLE user_preferences (
    user_id UUID PRIMARY KEY REFERENCES users(id),
    elo_range_min INT DEFAULT -200,
    elo_range_max INT DEFAULT 200,
    allow_friendly_games BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- File d'attente matchmaking
CREATE TABLE matchmaking_queue (
    id UUID PRIMARY KEY,
    user_id UUID REFERENCES users(id),
    elo INT NOT NULL,
    time_mode VARCHAR(20) NOT NULL,
    preferences JSONB,
    created_at TIMESTAMP DEFAULT NOW(),
    expires_at TIMESTAMP NOT NULL
);

-- Messages chat (temporaires, non sauvegardés après partie)
-- Optionnel: peut être géré en mémoire uniquement
CREATE TABLE chat_messages (
    id UUID PRIMARY KEY,
    room_code VARCHAR(10) NOT NULL,
    user_id UUID REFERENCES users(id),
    message TEXT NOT NULL,
    message_type VARCHAR(20) DEFAULT 'text', -- 'text' ou 'quick'
    created_at TIMESTAMP DEFAULT NOW()
);

-- Liens d'invitation
CREATE TABLE invitations (
    id UUID PRIMARY KEY,
    code VARCHAR(20) UNIQUE NOT NULL,
    creator_user_id UUID REFERENCES users(id),
    room_settings JSONB NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    expires_at TIMESTAMP NOT NULL,
    used BOOLEAN DEFAULT false
);
```

---

## 2. Phases d'implémentation

### Phase 0: Préparation et ajustements ELO (1-2 jours)

**Objectif**: Corriger les valeurs ELO par défaut et implémenter la formule ajustée par cadence.

#### Fichiers à modifier:
- `backend/services/eloService.js`
  - Changer `DEFAULT_ELO` de 1500 → 1000
  - Ajouter multiplicateurs par cadence:
    - `none`: 0 (friendly, pas de changement ELO)
    - `bullet`: 0.75
    - `blitz`: 0.9
    - `rapid`: 1.0
    - `classic`: 1.2
  - Modifier `calculateNewRatings()` pour appliquer le multiplicateur

- `shared/game/constants.js`
  - Mettre à jour `DEFAULT_ELO = 1000`

#### Tests:
- [ ] Vérifier que les nouveaux utilisateurs ont ELO 1000
- [ ] Simuler parties dans différentes cadences
- [ ] Valider que classic donne +20% points, bullet -25%

---

### Phase 1: Refonte UI du menu principal (3-4 jours)

**Objectif**: Créer le menu hamburger utilisateur et réorganiser l'interface lobby.

#### 1.1 Création du menu hamburger utilisateur

**Fichiers à créer**:
- `hexaequo-v2/components/userMenu.js`
  - Composant menu hamburger
  - États: fermé / ouvert
  - Variantes: non connecté / connecté
  - Gestion affichage pseudo + ELO

- `hexaequo-v2/styles/userMenu.css`
  - Styles responsive
  - Animations slide-in
  - Support mode clair/sombre

**Fichiers à modifier**:
- `hexaequo-v2/index.html`
  - Ajouter bouton icône utilisateur (top-right)
  - Retirer bouton "Settings" du menu principal
  - Simplifier menu: 3 boutons (Local Game, Play Online, Rules)
  - Insérer structure HTML menu hamburger

- `hexaequo-v2/lobby.js`
  - Retirer indicateur "connected to server" en mode online
  - Intégrer logique menu hamburger
  - Gérer état connexion utilisateur

- `hexaequo-v2/styles.css`
  - Ajuster layout pour bouton utilisateur top-right
  - Styles menu simplifié (3 boutons)

#### 1.2 Intégration avec système d'authentification

**Fichiers à modifier**:
- `hexaequo-v2/components/userMenu.js`
  - Récupérer tokens localStorage
  - Afficher pseudo + ELO depuis JWT
  - Boutons Sign-in/Register → modals existants
  - Bouton Logout → appel API + clear tokens

#### Tests:
- [ ] Menu s'ouvre/ferme correctement
- [ ] Affichage correct si non connecté (Sign-in, Register, Settings)
- [ ] Affichage correct si connecté (Pseudo, ELO, Profile, Settings, Logout)
- [ ] Bouton Settings ouvre modal settings
- [ ] Logout déconnecte et rafraîchit UI
- [ ] Responsive sur mobile

---

### Phase 2: Système de matchmaking automatique (5-7 jours)

**Objectif**: Remplacer la liste de rooms par un système Play/Invite.

#### 2.1 Backend - Service de matchmaking

**Fichiers à créer**:
- `backend/models/matchmakingQueueModel.js`
  - CRUD file d'attente
  - Recherche adversaires compatibles
  - Cleanup des entrées expirées

- `backend/services/matchmakingService.js`
  - `joinQueue(userId, timeMode, preferences)` → ajout file
  - `findMatch(userId, elo, preferences)` → recherche adversaire
  - `leaveQueue(userId)` → retrait file
  - Logique matching:
    - ELO dans plage définie (±200 par défaut)
    - Même time_mode
    - Respect allow_friendly_games
  - Création automatique room si match trouvé

- `backend/controllers/matchmakingController.js`
  - `POST /api/matchmaking/join` → rejoindre queue
  - `POST /api/matchmaking/leave` → quitter queue
  - `GET /api/matchmaking/status` → statut dans queue

**Fichiers à modifier**:
- `backend/socket/socketHandler.js`
  - Event `join-matchmaking-queue`
  - Event `leave-matchmaking-queue`
  - Event `match-found` → broadcast aux 2 joueurs
  - Polling ou event-driven matching (toutes les 2s)

#### 2.2 Backend - Système d'invitation

**Fichiers à créer**:
- `backend/models/invitationModel.js`
  - Génération codes uniques (8 caractères alphanumériques)
  - Stockage settings room (timeMode, etc.)
  - Expiration automatique (24h)

- `backend/services/invitationService.js`
  - `createInvitation(userId, roomSettings)` → génère code
  - `getInvitation(code)` → récupère settings
  - `useInvitation(code)` → marque utilisé, crée room

- `backend/controllers/invitationController.js`
  - `POST /api/invitations/create` → crée invitation
  - `GET /api/invitations/:code` → info invitation
  - `POST /api/invitations/:code/accept` → accepte + crée room

**Fichiers à modifier**:
- `backend/routes/roomRoutes.js`
  - Ajouter routes invitations

#### 2.3 Frontend - UI Matchmaking

**Fichiers à créer**:
- `hexaequo-v2/components/matchmaking.js`
  - Bouton "Play" → appel `join-matchmaking-queue`
  - Loader "Waiting for opponent..." avec timer
  - Bouton "Cancel" → `leave-matchmaking-queue`
  - Bouton "Invite" → ouvre modal QR code

- `hexaequo-v2/components/qrCodeModal.js`
  - Génération lien invitation: `https://hexaequo.com/?invite=ABC12345`
  - QR code (lib: qrcode.js)
  - Bouton "Copy Link"
  - Boutons partage natif (Web Share API)

- `hexaequo-v2/styles/matchmaking.css`
  - Layout 2 boutons côte à côte
  - Styles loader + animation
  - Modal QR code responsive

**Fichiers à modifier**:
- `hexaequo-v2/index.html`
  - Retirer liste rooms, filtres, bouton refresh
  - Ajouter section matchmaking (2 boutons)
  - Ajouter modal QR code

- `hexaequo-v2/lobby.js`
  - Intégrer composant matchmaking
  - Gérer event `match-found` → transition vers game
  - Parsing URL paramètre `?invite=CODE`
  - Si invite code: prompt login/register puis auto-join

- `hexaequo-v2/multiplayer.js`
  - Ajouter méthodes `joinMatchmakingQueue()`, `leaveMatchmakingQueue()`
  - Ajouter callback `onMatchFound`

#### Tests:
- [ ] Bouton "Play" ajoute à la queue
- [ ] Loader s'affiche avec timer
- [ ] Cancel retire de la queue
- [ ] Match trouvé quand 2 joueurs compatibles
- [ ] Bouton "Invite" génère code + QR
- [ ] Lien copié fonctionne
- [ ] URL avec ?invite=CODE redirige vers login puis game
- [ ] Matchmaking respecte plage ELO
- [ ] Matchmaking respecte time_mode

---

### Phase 3: Chat in-game (4-5 jours)

**Objectif**: Système de chat avec onglets texte libre et messages rapides.

#### 3.1 Backend - Service chat

**Fichiers à créer**:
- `backend/services/chatService.js`
  - Messages stockés en mémoire par room_code
  - `sendMessage(roomCode, userId, message, type)`
  - `getMessages(roomCode)` → messages de la room
  - Cleanup automatique quand room fermée

- `backend/models/chatMessageModel.js` (optionnel)
  - Si on veut persister temporairement
  - Sinon: Map en mémoire suffit

**Fichiers à modifier**:
- `backend/socket/socketHandler.js`
  - Event `send-chat-message` → broadcast à la room
  - Event `chat-message-received` → envoyé aux joueurs
  - Format: `{userId, pseudo, message, type, timestamp}`
  - Validation: max 200 caractères texte libre

#### 3.2 Frontend - Composant chat

**Fichiers à créer**:
- `hexaequo-v2/components/chat.js`
  - Widget bas de page (fixe)
  - États: ouvert / fermé
  - Badge notification (nombre messages non lus)
  - 2 onglets: "Text" et "Quick"
  - Onglet Text: input + send button
  - Onglet Quick: boutons prédéfinis
    - Messages: Hello, Good Luck, Thanks, Oops, Good move, Sorry, Good game, Gotta go
    - Emojis: 😊 👍 😮 🤔 🎉 😢
  - Auto-scroll messages
  - Affichage pseudo joueur pour chaque message

- `hexaequo-v2/styles/chat.css`
  - Position: fixed bottom
  - Hauteur fermé: 40px
  - Hauteur ouvert: 300px
  - Animation slide-up
  - Design chat moderne (bulles messages)

**Fichiers à modifier**:
- `hexaequo-v2/game.js`
  - Intégrer composant chat
  - Afficher seulement si online mode
  - Masquer chat si retour lobby

- `hexaequo-v2/multiplayer.js`
  - Méthodes `sendChatMessage(message, type)`
  - Callback `onChatMessageReceived(data)`

- `hexaequo-v2/index.html`
  - Ajouter structure HTML chat (hidden par défaut)

#### Tests:
- [ ] Chat s'ouvre/ferme correctement
- [ ] Messages texte envoyés et reçus
- [ ] Messages rapides fonctionnent
- [ ] Badge notification compte messages non lus
- [ ] Chat visible seulement en partie online
- [ ] Auto-scroll sur nouveau message
- [ ] Validation max 200 caractères

---

### Phase 4: Profil utilisateur et historique (6-8 jours)

**Objectif**: Page profil complète avec settings online, historique parties, et replay viewer.

#### 4.1 Backend - Préférences utilisateur

**Fichiers à créer**:
- `backend/models/userPreferencesModel.js`
  - CRUD préférences: elo_range_min, elo_range_max, allow_friendly_games
  - Valeurs par défaut: ±200, friendly = true

- `backend/services/userService.js` (modifier)
  - `getPreferences(userId)`
  - `updatePreferences(userId, preferences)`

- `backend/controllers/userController.js` (modifier)
  - `GET /api/users/:id/preferences`
  - `PUT /api/users/:id/preferences`

#### 4.2 Backend - Historique parties amélioré

**Fichiers à modifier**:
- `backend/services/gameService.js`
  - Améliorer `getGames()` pour inclure:
    - Pseudo adversaire
    - ELO actuel adversaire (pas historique)
    - Résultat (victoire/défaite/nul)
    - Time mode
  - Query optimisée avec joins

- `backend/controllers/gameController.js`
  - `GET /api/games?userId=X` → historique paginé

- `backend/services/replayService.js` (modifier)
  - `getGameReplay(gameId)` → move history complet
  - Format: `[{moveNumber, player, type, from, to, captures}, ...]`

#### 4.3 Frontend - Page profil

**Fichiers à créer**:
- `hexaequo-v2/components/profile.js`
  - Page profil complète
  - Header: pseudo + ELO + avatar
  - Settings section (au-dessus onglets):
    - Slider plage ELO (min/max)
    - Toggle "Accept friendly games"
    - Bouton "Save preferences"
  - Onglets: "Games History" (actif), "Stats" (coming soon)

- `hexaequo-v2/components/gameHistory.js`
  - Liste parties paginée
  - Colonnes: Date, Time mode, Adversaire (pseudo + ELO), Résultat (W/L/D)
  - Click sur partie → ouvre replay viewer

- `hexaequo-v2/components/replayViewer.js`
  - Canvas pour afficher board
  - Contrôles lecteur:
    - ◀️ Previous move
    - ▶️ Next move
    - ⏪ First move
    - ⏩ Last move
    - Progress bar cliquable
  - Affichage move number + description
  - Bouton X fermer modal

- `hexaequo-v2/styles/profile.css`
  - Layout page profil
  - Styles onglets
  - Tableau historique
  - Modal replay viewer (fullscreen)

**Fichiers à modifier**:
- `hexaequo-v2/index.html`
  - Ajouter page profil (hidden)
  - Ajouter modal replay viewer

- `hexaequo-v2/lobby.js`
  - Bouton "Profile" (menu hamburger) → charge page profil
  - Navigation profil ↔ lobby

- `hexaequo-v2/modules/gameController.js` ou nouveau module
  - Fonction `applyMove(state, move)` pour replay
  - Reconstruire état board à partir move history

#### Tests:
- [ ] Page profil affiche pseudo + ELO
- [ ] Settings plage ELO modifiables et sauvegardés
- [ ] Toggle friendly games fonctionne
- [ ] Historique charge parties utilisateur
- [ ] Pagination historique fonctionne
- [ ] Click partie ouvre replay viewer
- [ ] Replay viewer affiche moves correctement
- [ ] Navigation moves (prev/next/first/last)
- [ ] Progress bar cliquable
- [ ] Fermer modal revient à historique

---

### Phase 5: Améliorations audio (1-2 jours)

**Objectif**: Sons du jeu n'interrompent pas médias externes (iOS/Android).

#### Fichiers à modifier:
- `hexaequo-v2/game.js` (ou module audio dédié)
  - Utiliser Web Audio API au lieu de `<audio>` tags
  - Créer `AudioContext` avec `{category: 'ambient'}`
  - Charger sons en AudioBuffer
  - Jouer via `AudioBufferSourceNode` avec faible volume
  - Alternative: utiliser `mixToMono: true` et `category: 'ambient'`

**Recherche requise**:
- Tester comportement iOS Safari avec AudioContext
- Vérifier si `playsInline` + `muted: false` + faible volume suffit
- Possiblement: `navigator.mediaSession.playbackState = 'none'`

#### Tests:
- [ ] Sons jouent sur iOS pendant lecture YouTube
- [ ] Sons jouent sur Android pendant lecture Spotify
- [ ] Pas d'interruption des médias externes
- [ ] Volume sons approprié

---

## 3. Architecture de test

### 3.1 Tests unitaires (Jest)

**Nouveaux tests à créer**:
- `backend/tests/unit/eloService.test.js`
  - Formules ELO avec multiplicateurs cadence
  - Vérifier DEFAULT_ELO = 1000

- `backend/tests/unit/matchmakingService.test.js`
  - Logique matching avec plage ELO
  - Respect préférences friendly games
  - Expiration queue

- `backend/tests/unit/invitationService.test.js`
  - Génération codes uniques
  - Expiration invitations
  - Utilisation unique

### 3.2 Tests d'intégration

**Nouveaux tests**:
- `backend/tests/integration/matchmaking.test.js`
  - 2 joueurs rejoignent queue → match trouvé
  - Joueurs hors plage ELO → pas de match
  - Cancel queue fonctionne

- `backend/tests/integration/chat.test.js`
  - Envoi messages entre joueurs
  - Messages rapides
  - Cleanup messages fin partie

- `backend/tests/integration/profile.test.js`
  - GET/PUT préférences utilisateur
  - GET historique parties
  - GET replay spécifique

### 3.3 Tests E2E (manuels ou Playwright)

**Scénarios critiques**:
1. **Matchmaking flow complet**:
   - User A clique "Play"
   - User B clique "Play"
   - Match trouvé, partie commence
   - Partie se termine, ELO mis à jour

2. **Invitation flow**:
   - User A clique "Invite"
   - Copie lien
   - User B (non connecté) ouvre lien
   - Register/Login
   - Partie commence automatiquement

3. **Profil et replay**:
   - Joueur ouvre profil
   - Modifie préférences, sauvegarde
   - Consulte historique
   - Ouvre replay d'une partie
   - Navigue à travers moves

4. **Chat in-game**:
   - 2 joueurs dans partie
   - Envoie message texte
   - Envoie message rapide
   - Badge notification fonctionne

---

## 4. Migration et déploiement

### 4.1 Migration base de données

**Scripts à créer**:
- `backend/scripts/migration_001_user_preferences.sql`
  - Créer table user_preferences
  - Insérer préférences par défaut pour utilisateurs existants

- `backend/scripts/migration_002_matchmaking.sql`
  - Créer tables matchmaking_queue, invitations

- `backend/scripts/migration_003_update_elo_default.sql`
  - Optionnel: ajuster ELO utilisateurs existants (1500 → 1000)
  - Attention: peut nécessiter recalcul historique

**Commandes**:
```bash
npm run db:migrate  # Exécute migrations en séquence
```

### 4.2 Variables d'environnement

**Ajouter à `.env`**:
```bash
# Matchmaking
MATCHMAKING_QUEUE_EXPIRATION=300  # 5 minutes
MATCHMAKING_POLL_INTERVAL=2000    # 2 secondes

# Invitations
INVITATION_EXPIRATION=86400       # 24 heures
INVITATION_CODE_LENGTH=8

# Chat
CHAT_MAX_MESSAGE_LENGTH=200
CHAT_RATE_LIMIT=10                # 10 messages/minute

# ELO
DEFAULT_ELO=1000
ELO_MULTIPLIER_BULLET=0.75
ELO_MULTIPLIER_BLITZ=0.9
ELO_MULTIPLIER_RAPID=1.0
ELO_MULTIPLIER_CLASSIC=1.2
```

### 4.3 Déploiement progressif

**Stratégie recommandée**:
1. **Phase 0 + 5** (ELO + Audio): Deploy sans impact UI
2. **Phase 1** (UI Menu): Deploy, teste régression
3. **Phase 2** (Matchmaking): Deploy en beta, feature flag
4. **Phase 3** (Chat): Deploy, optionnel activer room par room
5. **Phase 4** (Profil): Deploy final

**Feature flags** (optionnel):
```javascript
const FEATURES = {
  MATCHMAKING_ENABLED: process.env.FEATURE_MATCHMAKING === 'true',
  CHAT_ENABLED: process.env.FEATURE_CHAT === 'true',
  PROFILE_ENABLED: process.env.FEATURE_PROFILE === 'true'
};
```

---

## 5. Risques et points d'attention

### 5.1 Performance

**Matchmaking**:
- Queue peut grossir (centaines de joueurs)
- Solution: indexer par timeMode + plage ELO
- Limiter recherche à 100 joueurs max

**Chat**:
- Messages en mémoire → risque fuite si rooms non nettoyées
- Solution: TTL strict (2h max), cleanup régulier

**Replay**:
- Parties longues = move history volumineux
- Solution: paginer historique, lazy load replays

### 5.2 UX

**Matchmaking timeout**:
- Si pas d'adversaire après 5 minutes → notification
- Proposer élargir plage ELO ou accepter friendly

**Invitation expirée**:
- Message clair si code expiré ou déjà utilisé
- Proposer créer nouvelle invitation

**Mobile**:
- Chat doit être ergonomique sur petit écran
- QR code doit être scannable
- Menu hamburger accessible au pouce

### 5.3 Sécurité

**Rate limiting**:
- Chat: 10 messages/minute
- Matchmaking: 3 join/leave par minute
- Invitations: 10 créations/heure

**Validation**:
- Messages chat: sanitize HTML, max 200 chars
- Codes invitation: vérifier format, ownership
- Préférences: valider plages ELO (-500 à +500 max)

**Spam**:
- Bloquer spam messages rapides (max 1/seconde)
- Détection comportement abusif

---

## 6. Dépendances externes

### NPM packages à ajouter:

**Frontend**:
```json
{
  "qrcode": "^1.5.3",          // Génération QR codes
  "web-share-wrapper": "^0.3.0" // Polyfill Web Share API
}
```

**Backend**:
```json
{
  "uuid": "^9.0.1",             // Déjà présent, pour codes invitation
  "node-schedule": "^2.1.1"     // Cleanup automatique queues/invitations
}
```

---

## 7. Documentation à mettre à jour

**Post-implémentation**:
- [ ] `docs/SOCKET_EVENTS.md` → ajouter events chat + matchmaking
- [ ] `docs/API.md` → ajouter endpoints matchmaking, invitations, préférences
- [ ] `.github/copilot-instructions.md` → ajouter sections matchmaking, chat, profil
- [ ] `README.md` → features list, captures d'écran

---

## 8. Estimation totale

| Phase | Durée estimée | Complexité |
|-------|---------------|------------|
| Phase 0 (ELO) | 1-2 jours | Faible |
| Phase 1 (UI Menu) | 3-4 jours | Moyenne |
| Phase 2 (Matchmaking) | 5-7 jours | Élevée |
| Phase 3 (Chat) | 4-5 jours | Moyenne |
| Phase 4 (Profil) | 6-8 jours | Élevée |
| Phase 5 (Audio) | 1-2 jours | Faible |
| Tests & Debug | 3-5 jours | Moyenne |
| **TOTAL** | **23-33 jours** | **1 mois environ** |

---

## 9. Checklist de démarrage

Avant de commencer l'implémentation:
- [ ] Valider architecture avec équipe
- [ ] Designer mockups UI (menu, matchmaking, chat, profil)
- [ ] Préparer assets (icônes utilisateur light/dark)
- [ ] Créer feature branch: `feature/ui-matchmaking-chat-profile`
- [ ] Setup environnement de test (DB staging)
- [ ] Vérifier compatibilité librairies (qrcode.js, etc.)

---

**Note finale**: Ce plan est adaptable. Certaines phases peuvent être parallélisées (ex: Phase 3 et 4) si plusieurs développeurs. Privilégier une approche incrémentale avec tests à chaque étape.
