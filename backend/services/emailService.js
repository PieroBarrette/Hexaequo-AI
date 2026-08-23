/**
 * Sending mail.
 *
 * Two ways out, tried in order: Resend's HTTP API when a key is configured,
 * then SMTP when a host is. With neither, sending is a no-op that says so —
 * the site still works, but anything that depends on a link reaching an inbox
 * will not, and the caller is told rather than left guessing.
 *
 * Links are hash routes. The app is served by the SPA fallback, so a path like
 * /verify-email loads the page and quietly drops the token; #/verify keeps it.
 */

const {
    RESEND_API_KEY, SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, EMAIL_FROM, FRONTEND_URL,
} = require('../config/env');

const RESEND_ENDPOINT = 'https://api.resend.com/emails';
/** A host nobody configured. The default in env.js is a placeholder. */
const smtpConfigured = () => Boolean(SMTP_HOST) && SMTP_HOST !== 'smtp.example.com';

/** Which way out is available, if any. Exported so callers can warn honestly. */
function transport() {
    if (RESEND_API_KEY) return 'resend';
    if (smtpConfigured()) return 'smtp';
    return null;
}

const site = () => String(FRONTEND_URL || 'https://hexaequo.com').replace(/\/+$/, '');
const link = (route, token) => `${site()}/#/${route}?token=${encodeURIComponent(token)}`;

async function viaResend({ to, subject, html, text }) {
    const response = await fetch(RESEND_ENDPOINT, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${RESEND_API_KEY}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ from: EMAIL_FROM, to: [to], subject, html, text }),
    });
    if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new Error(`Resend refused the message (${response.status}): ${detail.slice(0, 200)}`);
    }
}

async function viaSmtp({ to, subject, html, text }) {
    // Required lazily: an install without nodemailer can still use Resend.
    const nodemailer = require('nodemailer');
    const port = Number(SMTP_PORT) || 587;
    const mailer = nodemailer.createTransport({
        host: SMTP_HOST,
        port,
        secure: port === 465,
        auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
    });
    await mailer.sendMail({ from: EMAIL_FROM, to, subject, html, text });
}

/**
 * Send one message. Never throws: a message that cannot be sent must not cost
 * someone their sign-up. Returns whether it went.
 */
async function sendEmail({ to, subject, html, text }) {
    const via = transport();
    if (!via) {
        console.warn(
            `[email] not configured, so nothing was sent to ${to} ("${subject}"). `
            + 'Set RESEND_API_KEY (or SMTP_HOST) to turn this on.'
        );
        return false;
    }
    try {
        if (via === 'resend') await viaResend({ to, subject, html, text });
        else await viaSmtp({ to, subject, html, text });
        console.log(`[email] sent to ${to} via ${via}: ${subject}`);
        return true;
    } catch (error) {
        console.error(`[email] could not send to ${to} via ${via}:`, error.message);
        return false;
    }
}

/** One look for every message, so they are recognisably from the same place. */
function wrap(title, body) {
    return `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;
                        max-width:520px;margin:0 auto;padding:24px;color:#1a1a1a">
      <h1 style="font-size:20px;margin:0 0 16px">${title}</h1>
      ${body}
      <p style="margin-top:28px;font-size:12px;color:#767676">
        Hexaequo · <a href="${site()}" style="color:#767676">hexaequo.com</a>
      </p>
    </div>`;
}

const button = (url, label) =>
    `<p style="margin:20px 0"><a href="${url}"
        style="background:#c8722e;color:#fff;text-decoration:none;padding:11px 20px;
               border-radius:8px;display:inline-block;font-weight:600">${label}</a></p>`;

/* Both languages in one message: we know the address, not the reader. */

exports.sendVerificationEmail = async (email, token) => {
    const url = link('verify', token);
    return sendEmail({
        to: email,
        subject: 'Hexaequo — confirmez votre adresse / confirm your address',
        html: wrap('Bienvenue sur Hexaequo', `
            <p>Confirmez votre adresse pour terminer la création de votre compte.</p>
            ${button(url, 'Confirmer mon adresse')}
            <p style="font-size:13px;color:#555">Ce lien expire dans 24 heures.
               Si vous n'avez pas créé de compte, ignorez ce message.</p>
            <hr style="border:0;border-top:1px solid #e5e5e5;margin:24px 0">
            <p>Confirm your address to finish creating your account.</p>
            ${button(url, 'Confirm my address')}
            <p style="font-size:13px;color:#555">This link expires in 24 hours.
               If you did not create an account, ignore this message.</p>
            <p style="font-size:12px;color:#767676;word-break:break-all">${url}</p>`),
        text: `Hexaequo — confirmez votre adresse / confirm your address: ${url}`,
    });
};

exports.sendPasswordResetEmail = async (email, token) => {
    const url = link('reset', token);
    return sendEmail({
        to: email,
        subject: 'Hexaequo — réinitialiser votre mot de passe / reset your password',
        html: wrap('Réinitialiser votre mot de passe', `
            <p>Quelqu'un a demandé un nouveau mot de passe pour ce compte.</p>
            ${button(url, 'Choisir un nouveau mot de passe')}
            <p style="font-size:13px;color:#555">Ce lien expire dans une heure.
               Si ce n'était pas vous, ignorez ce message : rien n'a changé.</p>
            <hr style="border:0;border-top:1px solid #e5e5e5;margin:24px 0">
            <p>Someone asked for a new password for this account.</p>
            ${button(url, 'Choose a new password')}
            <p style="font-size:13px;color:#555">This link expires in one hour.
               If it was not you, ignore this message: nothing has changed.</p>
            <p style="font-size:12px;color:#767676;word-break:break-all">${url}</p>`),
        text: `Hexaequo — réinitialiser / reset: ${url}`,
    });
};

exports.sendGameInvitationEmail = async (email, inviterPseudo, roomCode) => {
    const url = `${site()}/#/play?online=1&code=${encodeURIComponent(roomCode)}`;
    return sendEmail({
        to: email,
        subject: `${inviterPseudo} vous invite à jouer / invites you to play`,
        html: wrap(`${inviterPseudo} vous invite à jouer`, `
            ${button(url, 'Rejoindre la partie / Join the game')}
            <p style="font-size:13px;color:#555">Code : <strong>${roomCode}</strong></p>`),
        text: `${inviterPseudo} — ${url}`,
    });
};

module.exports = {
    sendEmail,
    transport,
    isConfigured: () => transport() !== null,
    sendVerificationEmail: exports.sendVerificationEmail,
    sendPasswordResetEmail: exports.sendPasswordResetEmail,
    sendGameInvitationEmail: exports.sendGameInvitationEmail,
};
