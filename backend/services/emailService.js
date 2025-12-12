/**
 * Email Service
 * 
 * Handles sending emails for verification, password reset, etc.
 */

const nodemailer = require('nodemailer');
const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, EMAIL_FROM, FRONTEND_URL } = require('../config/env');

// Create transporter (configure for your SMTP provider)
const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth: SMTP_USER ? {
        user: SMTP_USER,
        pass: SMTP_PASS
    } : undefined
});

/**
 * Send an email
 */
async function sendEmail({ to, subject, html, text }) {
    try {
        await transporter.sendMail({
            from: EMAIL_FROM,
            to,
            subject,
            html,
            text
        });
        console.log(`Email sent to ${to}: ${subject}`);
    } catch (error) {
        console.error('Failed to send email:', error);
        // Don't throw - email failure shouldn't break user flow
    }
}

/**
 * Send verification email
 */
exports.sendVerificationEmail = async (email, token) => {
    const verifyUrl = `${FRONTEND_URL}/verify-email?token=${token}`;

    await sendEmail({
        to: email,
        subject: 'Verify your Hexaequo account',
        html: `
            <h1>Welcome to Hexaequo!</h1>
            <p>Thank you for creating an account. Please verify your email address by clicking the link below:</p>
            <p><a href="${verifyUrl}">Verify Email Address</a></p>
            <p>Or copy and paste this URL into your browser:</p>
            <p>${verifyUrl}</p>
            <p>This link will expire in 24 hours.</p>
            <p>If you didn't create an account, you can safely ignore this email.</p>
        `,
        text: `Welcome to Hexaequo! Please verify your email by visiting: ${verifyUrl}`
    });
};

/**
 * Send password reset email
 */
exports.sendPasswordResetEmail = async (email, token) => {
    const resetUrl = `${FRONTEND_URL}/reset-password?token=${token}`;

    await sendEmail({
        to: email,
        subject: 'Reset your Hexaequo password',
        html: `
            <h1>Password Reset Request</h1>
            <p>You requested to reset your password. Click the link below to set a new password:</p>
            <p><a href="${resetUrl}">Reset Password</a></p>
            <p>Or copy and paste this URL into your browser:</p>
            <p>${resetUrl}</p>
            <p>This link will expire in 1 hour.</p>
            <p>If you didn't request a password reset, you can safely ignore this email.</p>
        `,
        text: `Reset your Hexaequo password by visiting: ${resetUrl}`
    });
};

/**
 * Send game invitation email
 */
exports.sendGameInvitationEmail = async (email, inviterPseudo, roomCode) => {
    const gameUrl = `${FRONTEND_URL}/game/${roomCode}`;

    await sendEmail({
        to: email,
        subject: `${inviterPseudo} invited you to play Hexaequo`,
        html: `
            <h1>Game Invitation</h1>
            <p>${inviterPseudo} has invited you to play Hexaequo!</p>
            <p><a href="${gameUrl}">Join Game</a></p>
            <p>Room Code: ${roomCode}</p>
        `,
        text: `${inviterPseudo} invited you to play Hexaequo! Join at: ${gameUrl}`
    });
};

module.exports = {
    sendEmail,
    sendVerificationEmail: exports.sendVerificationEmail,
    sendPasswordResetEmail: exports.sendPasswordResetEmail,
    sendGameInvitationEmail: exports.sendGameInvitationEmail
};
