1. Interface repensée dans les menus : 
Enlever l'indicateur "connected to server" en play online mode, c'était pour le développement mais pas utile en production. 
un symbole de "petit bonhomme" (je peut fournir l'image light et dark juste me dire où les mettre) comme bouton situé en haut à droite du site dans les menus (pas in game) qui va ouvrir un menu hamburger à partir du haut-droit qui va contenir : 

-Si l'utilisateur n'est pas connecté : Boutons Sign-in et Register et une "Gear" pour avoir accès au modal des settings qui sera à cet emplacement. (Retirer le bouton settings du menu principal, on y aura accès par le menu hamburger en haut à droite : donc juste trois boutons un au-dessus de l'autre : "Local Game", "Play Online" et "Rules").

-Si l'utilisateur est connecté : Affichage du pseudo et Elo, bouton "Profile" qui ouvre la page "coming soon" actuellement, la Gear des settings et le bouton "Log Out".

-Le pseudo et Elo de l'utilisateur sera affiché (si un utilisateur est connecté) à côté du bouton lorsque le menu hamburger est fermé.

2. Matchmaking :
Au lieu d'un bouton "Create Room", je veux 2 boutons côte à côte (il n'y aura plus de liste de rooms alors retirer cette liste, les filtres et le bouton refresh): 
Le premier bouton : "Play" montre le loader "waiting for opponent..." avec le bouton "Cancel" et rend l'utilisateur disponible selon ses critères (e.g. Time control, Plage de Elo, friendly mode toggled, etc.)
Le deuxième bouton: "Invite" qui ouvre un modal avec un code qr pour rejoindre la partie (selon les settings du joueur qui invite) ou qui permet de copier un lien ou de le partager directement (par messenger, messages, courriel, whatsapp, etc.)
Note : Un autre utilisateur qui ouvre ce lien est invité à se login directement ou se register si pas de compte et la partie est automatiquement commencée

3. Construire un chat "In game" situé dans le bas de la page qui peut être ouvert ou caché et qui montre les notifications (nombre à côté si des messages reçu lorsque caché) et ce tant qu'un salon est ouvert avec deux joueurs connecté dedans, le chat ne sera pas sauvegardé ni visible par de futurs spectateurs, il y aura deux onglets (un de texte normal, et un autre "rapide" avec des messages préenregistré comme : Hello, Good Luck, Thanks, Oops, Good move, Sorry, Good game, Gotta go et des émojis).

4. Un joueur sur son profil (bouton qui ouvre la page "coming soon" actuellement) a un onglet "Games history" où il y a une liste des parties jouées sauvegardées dans la DB pour cet utilisateur (il y aura un autre onglet "Stats" qui sera coming soon). Cette liste montre : Cadence, pseudo de l'adversaire avec son ELO actuel (pas celui au moment où la partie a été jouée), victoire défaite ou Ex Aequo. En cliquant sur la partie, ça ouvre le jeu mais on ne peut pas joué de coup, on peut juste visualiser la partie (les coups joués) avec un lecteur de type undo redo qui navigue à travers le move history de cette partie, un "X" permet de fermer ce modal et revenir au games history dans le profil.

5. Dans ce même profil il y aura au-dessus des onglets des settings "online" qui définit la plage de Elo (moins combien et plus combien par rapport au elo actuel) contre qui ce joueur veut jouer (+/- 200 du elo actuel par défaut si non modifié) et un autre setting qui accepte ou non les parties friendly (contre des guests)

6. Autres : 
- Faire en sorte que les fichiers de sons mp3 ne remplace pas la lecture de media sur les appareils (il serait possible d'entendre les sons du jeu tout en écoutant une vidéo sur youtube en même temps sans que la vidéo soit mise sur pause sur un iphone par exemple)
- Le ELO par défaut sera 1000 et non 1500
- La formule de calcul de ELO devrait tenir compte de la cadence (plus de point pour des cadences plus lentes comme le classic et moins de variations pour les cadences plus rapides comme le bullet, appliquer un pourcentage et les games avec no timer sont toujours considérées "friendly").



