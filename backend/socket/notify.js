/**
 * Whether somebody is looking, and a word to them when they are not.
 *
 * A notification is for news that would otherwise be missed. Somebody with
 * Hexaequo in front of them already sees the card, hears the sound and reads
 * the chat; buzzing their phone as well is noise. So each connection says
 * whether its page is on screen (hx:visible), and nothing is pushed to an
 * account while any of its connections is.
 *
 * A connection that has never said either way counts as not looking: an old
 * copy of the app from before this existed, or a page that went to sleep before
 * it could tell us. Better a notification somebody did not need than one they
 * did not get.
 */

const push = require('../services/pushService');

/* userId → notifications sent since they last looked. It is the number on the
   app's icon, and it goes back to nothing the moment they look. */
const unseen = new Map();

/** Whether any connection of this account has its page on screen. */
function attentive(io, userId) {
    for (const socket of io.sockets.sockets.values()) {
        const user = socket.data && socket.data.user;
        if (user && user.userId === userId && socket.data.hxVisible === true) return true;
    }
    return false;
}

function attachNotifications(io) {
    io.on('connection', (socket) => {
        socket.on('hx:visible', (payload, callback) => {
            socket.data.hxVisible = Boolean(payload && payload.visible);
            const user = socket.data.user;
            if (user && socket.data.hxVisible) {
                unseen.delete(user.userId);
                push.visited(user.userId);
            }
            if (typeof callback === 'function') callback({ ok: true });
        });
    });
}

/**
 * Notify this account, unless they are already looking.
 *
 * Takes what push.notify takes, plus `evenIfLooking` for the rare message that
 * must go regardless. Resolves to how many devices it reached; never rejects.
 */
async function tell(io, userId, kind, vars, options = {}) {
    if (!userId || !push.enabled()) return 0;
    if (!options.evenIfLooking && attentive(io, userId)) return 0;
    const badge = (unseen.get(userId) || 0) + 1;
    unseen.set(userId, badge);
    const reached = await push.notify(userId, kind, vars, { ...options, badge });
    if (!reached && unseen.get(userId) === badge) {
        if (badge > 1) unseen.set(userId, badge - 1); else unseen.delete(userId);
    }
    return reached;
}

module.exports = { attachNotifications, attentive, tell, unseen };
