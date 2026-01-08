/**
 * chat.js - Chat in-game (Phase 3)
 * 
 * Responsabilités:
 * - Widget fixé en bas de page (position: fixed bottom)
 * - Toggle open/close avec animation
 * - Badge notification (nombre messages non lus quand fermé)
 * - Deux onglets:
 *   1. "Text": Texte libre (max 200 caractères)
 *   2. "Quick": Messages pré-enregistrés
 *      - Hello, Good Luck, Thanks, Oops, Good move
 *      - Sorry, Good game, Gotta go
 *      - Emojis: 👍 👎 😊 😢 🎉 etc.
 * - Affichage pseudo joueur pour chaque message
 * - Auto-scroll sur nouveau message
 * 
 * Notes:
 * - Visible seulement en partie online (2 joueurs connectés)
 * - Messages NON sauvegardés (pas visible par spectateurs/replays)
 * - Rate limiting: 10 msg/minute côté serveur
 * 
 * Dépendances:
 * - multiplayer.js: sendChatMessage(message, type)
 * - Socket events: send-chat-message, chat-message (receive)
 * - i18n.js pour traductions messages rapides
 * 
 * Exports:
 * - Chat class ou init function
 * - openChat(), closeChat(), toggleChat()
 * - sendMessage(text, type), onMessageReceived(callback)
 * - resetUnreadCount()
 */

// TODO: Implémenter Phase 3
