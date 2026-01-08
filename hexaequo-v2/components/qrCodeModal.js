/**
 * qrCodeModal.js - Modal QR code invitation (Phase 2)
 * 
 * Responsabilités:
 * - Génération lien invitation: https://hexaequo.com/?invite=ABC12345
 * - Affichage QR code scannable
 * - Bouton "Copy Link" 
 * - Boutons partage natif (Web Share API): Messenger, WhatsApp, Email, etc.
 * - Affichage code texte pour copie manuelle
 * 
 * Format invitation:
 * - Code: 8 caractères alphanumériques
 * - Expiration: 24h
 * - Room settings encodés (time_mode, etc.)
 * 
 * Dépendances:
 * - Librairie qrcode (npm install qrcode) ou qrcode.js CDN
 * - API: POST /api/invitations/create
 * - Web Share API (navigator.share)
 * 
 * Exports:
 * - QrCodeModal class ou init function
 * - openModal(roomSettings), closeModal()
 * - generateInviteCode()
 */

// TODO: Implémenter Phase 2
