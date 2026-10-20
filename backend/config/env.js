/**
 * Environment Configuration
 * 
 * Centralized configuration loaded from environment variables.
 */

// Anchored on this file rather than the working directory, so `node
// backend/server.js` from anywhere still finds the same .env.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

module.exports = {
    // Server
    PORT: process.env.PORT || 3001,
    NODE_ENV: process.env.NODE_ENV || 'development',
    
    // Frontend
    FRONTEND_URL: process.env.FRONTEND_URL || 'https://hexaequo.com',
    
    // Database
    DATABASE_URL: process.env.DATABASE_URL || 'postgresql://localhost:5432/hexaequo',
    
    // Redis
    REDIS_URL: process.env.REDIS_URL || 'redis://localhost:6379',
    
    // JWT
    JWT_SECRET: process.env.JWT_SECRET || 'your-secret-key-change-in-production',
    JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '7d',
    JWT_REFRESH_EXPIRES_IN: process.env.JWT_REFRESH_EXPIRES_IN || '30d',
    
    // Email. Resend is tried first; SMTP is the fallback. With neither, mail
    // is not sent and emailService says so rather than failing quietly.
    RESEND_API_KEY: process.env.RESEND_API_KEY || '',

    SMTP_HOST: process.env.SMTP_HOST || 'smtp.example.com',
    SMTP_PORT: process.env.SMTP_PORT || 587,
    SMTP_USER: process.env.SMTP_USER || '',
    SMTP_PASS: process.env.SMTP_PASS || '',
    EMAIL_FROM: process.env.EMAIL_FROM || 'Hexaequo <noreply@hexaequo.com>',
    /* Where a reply should go, when it is not where the message came from.
       Automated mail is sent from an address nobody reads; a person who hits
       reply should still reach somebody. Empty means "reply to the sender". */
    EMAIL_REPLY_TO: process.env.EMAIL_REPLY_TO || '',

    /* Push notifications. The VAPID pair signs every message so that a push
       service can tell it came from us; without both halves the feature is
       simply off, and the settings say so. Generated once and never changed —
       a new pair silently cuts off every device that has subscribed. */
    VAPID_PUBLIC_KEY: process.env.VAPID_PUBLIC_KEY || '',
    VAPID_PRIVATE_KEY: process.env.VAPID_PRIVATE_KEY || '',
    VAPID_SUBJECT: process.env.VAPID_SUBJECT || 'https://hexaequo.com',

    // Rate limiting
    RATE_LIMIT_WINDOW_MS: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
    RATE_LIMIT_MAX_REQUESTS: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
    
    // Bcrypt
    BCRYPT_ROUNDS: parseInt(process.env.BCRYPT_ROUNDS) || 12
};
