<!-- 621dbd04-1f34-4f72-a7c8-b8aa114a1635 c15ab872-f270-4725-93e0-7768a07c9ed9 -->
# Migration Hexaequo vers Web App Pure JavaScript

## Phase 1: Conversion de l'IA Python vers JavaScript

Créer un nouveau fichier `ai.js` qui traduira tout l'algorithme Minimax de `AI.py` en JavaScript.

### Fichiers concernés:

- **Nouveau:** `Hexaequo V2/ai.js` (conversion complète de AI.py)
- **Modifier:** `Hexaequo V2/game.js` (intégrer l'IA locale au lieu de fetch HTTP)

### Fonctions à traduire:

- `minimax()` - L'algorithme principal avec alpha-beta pruning
- `evaluate()` - Fonction d'évaluation des positions
- `get_children()` - Génération des coups possibles
- `is_terminal()` - Détection de fin de partie
- Toutes les fonctions de simulation: `simulate_tile_placement()`, `simulate_disc_placement()`, `simulate_ring_placement()`, `simulate_disc_move()`, `simulate_jump()`, `simulate_disc_jump_sequence()`, `simulate_ring_move()`
- Toutes les fonctions de validation: `get_valid_tile_placements()`, `get_valid_disc_placements()`, `get_valid_ring_placements()`, `get_valid_disc_moves()`, `get_valid_disc_jumps()`, `get_valid_ring_moves()`
- Fonctions utilitaires: `get_neighbors()`, `log_move_differences()`

### Points d'attention:

- Les dictionnaires Python deviennent des objets JavaScript
- `copy.deepcopy()` devient une fonction de clonage profond en JS
- Garder la même logique exacte pour assurer la même qualité de jeu

## Phase 2: Web Workers pour Performance

Créer un Web Worker pour exécuter l'IA sans bloquer l'interface utilisateur.

### Fichiers concernés:

- **Nouveau:** `Hexaequo V2/ai-worker.js` (wrapper pour exécuter l'IA en arrière-plan)
- **Modifier:** `Hexaequo V2/game.js` (utiliser Worker au lieu de fonction directe)

### Implémentation:

- Le worker recevra l'état du jeu via `postMessage()`
- Exécutera le Minimax dans un thread séparé
- Renverra le meilleur coup via `postMessage()`
- Permet de garder l'UI responsive pendant le calcul

## Phase 3: Optimisation Mobile et Responsive

Adapter l'interface pour les écrans mobiles et tactiles.

### Fichiers concernés:

- **Modifier:** `Hexaequo V2/styles.css` (media queries, layout responsive)
- **Modifier:** `Hexaequo V2/game.js` (touch events, taille canvas dynamique)
- **Modifier:** `Hexaequo V2/index.html` (viewport meta tag, structure responsive)

### Changements:

- Canvas redimensionnable selon la taille de l'écran
- Détection touch pour mobile (actuellement seulement click)
- Boutons plus grands pour écrans tactiles
- Layout vertical pour petits écrans
- Inventaire repositionné pour mobile

## Phase 4: Progressive Web App (PWA)

Transformer le jeu en PWA installable sur mobile.

### Fichiers concernés:

- **Nouveau:** `Hexaequo V2/manifest.json` (métadonnées PWA)
- **Nouveau:** `Hexaequo V2/service-worker.js` (cache pour offline)
- **Nouveau:** `Hexaequo V2/icons/` (icônes 192x192, 512x512)
- **Modifier:** `Hexaequo V2/index.html` (liens manifest et meta tags)

### Fonctionnalités PWA:

- Installation sur écran d'accueil mobile
- Fonctionnement offline complet
- Cache des assets (images, sons, scripts)
- Thème couleur et splash screen
- Mode standalone (sans barre d'URL du navigateur)

## Phase 5: Préparation GitHub Pages

Organiser les fichiers pour le déploiement.

### Fichiers concernés:

- **Nouveau:** `index.html` (à la racine, redirige vers Hexaequo V2)
- **Nouveau:** `.nojekyll` (désactive Jekyll sur GitHub Pages)
- **Nouveau:** `CNAME` (configure le domaine hexaequo.com)
- **Modifier:** Tous les chemins relatifs pour compatibilité GitHub Pages

### Structure finale:

```
/
├── index.html (point d'entrée)
├── CNAME (hexaequo.com)
├── .nojekyll
└── Hexaequo V2/
    ├── index.html
    ├── game.js
    ├── ai.js
    ├── ai-worker.js
    ├── styles.css
    ├── manifest.json
    ├── service-worker.js
    ├── logo.png
    ├── icons/
    └── sounds/
```

## Phase 6: Tests et Validation

Vérifier que tout fonctionne correctement.

### Tests à effectuer:

- L'IA joue avec la même qualité qu'avant
- Mode 2 joueurs fonctionne
- Responsive sur mobile (iPhone, Android)
- Installation PWA fonctionne
- Fonctionnement offline
- Sons et animations
- Pas d'erreurs console

## Phase 7: Déploiement

Instructions pour mettre en ligne sur GitHub Pages.

### Étapes:

1. Commit et push sur GitHub
2. Activer GitHub Pages dans les settings du repo
3. Sélectionner la branche `main` comme source
4. Ajouter le fichier `CNAME` avec `hexaequo.com`
5. Configurer les DNS de votre domaine (vous le ferez vous-même)
6. Attendre la propagation DNS (quelques heures)

## Fichiers à Supprimer

Une fois la migration terminée:

- `Hexaequo V2/AI.py` (remplacé par ai.js)

## Notes Techniques

### Différences JavaScript vs Python:

- Python dict → JavaScript Object/Map
- `float('inf')` → `Infinity`
- `float('-inf')` → `-Infinity`
- `copy.deepcopy()` → `JSON.parse(JSON.stringify())` ou fonction custom
- Liste comprehension Python → `Array.filter().map()`

### Performance:

- Le Minimax en JavaScript sera légèrement plus lent qu'en Python
- Le Web Worker compense en gardant l'UI responsive
- Profondeur 2 restera très jouable (< 2 secondes par coup)

### Compatibilité:

- Support: tous navigateurs modernes (Chrome, Firefox, Safari, Edge)
- Mobile: iOS Safari 11.3+, Chrome Android 40+
- PWA: iOS 11.3+, Android 5+

### To-dos

- [ ] Créer ai.js et traduire l'algorithme Minimax avec alpha-beta pruning
- [ ] Traduire toutes les fonctions de simulation et validation de coups
- [ ] Remplacer fetch HTTP vers Flask par appel local à ai.js dans game.js
- [ ] Créer ai-worker.js pour exécuter l'IA sans bloquer l'UI
- [ ] Ajouter media queries et layout mobile dans styles.css
- [ ] Implémenter support tactile et canvas redimensionnable dans game.js
- [ ] Créer manifest.json avec métadonnées PWA
- [ ] Générer icônes PWA (192x192, 512x512) à partir du logo
- [ ] Créer service-worker.js pour cache offline
- [ ] Créer fichiers pour GitHub Pages (index racine, CNAME, .nojekyll)
- [ ] Tester sur desktop, mobile, et valider installation PWA
- [ ] Déployer sur GitHub Pages et vérifier le fonctionnement