/**
 * Environment Configuration
 * 
 * Centralized configuration loaded from environment variables.
 */

require('dotenv').config();

module.exports = {
    // Server
    PORT: process.env.PORT || 3001,
    NODE_ENV: process.env.NODE_ENV || 'development',
    
    // Frontend
    FRONTEND_URL: process.env.FRONTEND_URL || 'http://localhost:8080', 
    
    // Database
    DATABASE_URL: process.env.DATABASE_URL || 'postgresql://localhost:5432/hexaequo',
    
    // Redis
    REDIS_URL: process.env.REDIS_URL || 'redis://localhost:6379',
    
    // JWT
    JWT_SECRET: process.env.JWT_SECRET || 'your-secret-key-change-in-production',
    JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '7d',
    JWT_REFRESH_EXPIRES_IN: process.env.JWT_REFRESH_EXPIRES_IN || '30d',
    
    // Email (SMTP)
    SMTP_HOST: process.env.SMTP_HOST || 'smtp.example.com',
    SMTP_PORT: process.env.SMTP_PORT || 587,
    SMTP_USER: process.env.SMTP_USER || '',
    SMTP_PASS: process.env.SMTP_PASS || '',
    EMAIL_FROM: process.env.EMAIL_FROM || 'noreply@hexaequo.com',
    
    // Rate limiting
    RATE_LIMIT_WINDOW_MS: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
    RATE_LIMIT_MAX_REQUESTS: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
    
    // Bcrypt
    BCRYPT_ROUNDS: parseInt(process.env.BCRYPT_ROUNDS) || 12
};
