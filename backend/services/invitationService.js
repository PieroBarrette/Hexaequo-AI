/**
 * invitationService.js - Gestion invitations (Phase 2)
 * 
 * Responsabilités:
 * - Création liens d'invitation avec code unique
 * - Validation et utilisation des codes
 * - Génération URL: https://hexaequo.com/?invite=ABC12345
 * - Expiration automatique (24h par défaut)
 * 
 * Flow invitation:
 * 1. Joueur A appelle createInvitation(roomSettings)
 * 2. Service génère code unique + sauvegarde
 * 3. Joueur A partage lien/QR code
 * 4. Joueur B ouvre lien, frontend détecte ?invite=CODE
 * 5. Joueur B s'authentifie si nécessaire
 * 6. Joueur B appelle acceptInvitation(code)
 * 7. Service valide code, crée room, retourne roomCode
 * 8. Les 2 joueurs rejoignent la room
 * 
 * Exports:
 * - createInvitation(userId, roomSettings) → {code, url, expires_at}
 * - acceptInvitation(code, userId) → {valid, roomCode?, error?}
 * - getInvitationInfo(code) → {valid, creator, settings, expires_at}
 * - cancelInvitation(code, userId) → boolean
 */

const invitationModel = require('../models/invitationModel');
const roomService = require('./roomService');

// TODO: Implémenter Phase 2

module.exports = {
    // createInvitation,
    // acceptInvitation,
    // getInvitationInfo,
    // cancelInvitation
};
