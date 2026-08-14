/**
 * The lobby: who is here, what they are saying, and who wants to play whom.
 *
 * Quick match answers "find me a game". This answers the other question — "is
 * anyone around?" — which is what makes a small site feel inhabited rather than
 * empty. You appear in the list while you have the lobby open, you can be
 * challenged by name, and the chat is one shared room.
 *
 * Signing in is required, for the same reason as quick match: a challenge needs
 * somebody to address, and a name to address them by.
 */

const { createRoom, rooms } = require('./onlineGame');

const PUSH_MS = 1000;                     // coalesce presence updates
const CHALLENGE_TTL_MS = 60 * 1000;
const CHAT_MAX_LENGTH = 300;
const CHAT_MIN_INTERVAL_MS = 700;
const CHAT_HISTORY = 80;
const LOBBY_ROOM = 'hx:lobby';

/** userId → presence. One entry per account, however many tabs are open. */
const present = new Map();
/** id → { from, to, timeControl } while an invitation is outstanding. */
const challenges = new Map();
const chat = [];

let nextChallengeId = 1;

/**
 * Whether this player is in a game right now.
 *
 * Read off the live rooms rather than tracked separately: two sources of truth
 * about the same thing would drift, and a stale "available" is a worse lie than
 * a scan of a handful of rooms.
 */
function isPlaying(userId) {
    for (const room of rooms.values()) {
        if (room.result) continue;
        for (let seat = 0; seat < 2; seat++) {
            const player = room.players[seat];
            if (player && player.userId === userId && room.seats[seat]) return true;
        }
    }
    return false;
}

function roster() {
    const out = [];
    for (const entry of present.values()) {
        out.push({
            userId: entry.userId,
            pseudo: entry.pseudo,
            elo: entry.elo,
            since: entry.since,
            playing: isPlaying(entry.userId),
        });
    }
    // Strongest first, which is also the order that makes the list feel like a
    // room rather than a log.
    out.sort((a, b) => b.elo - a.elo);
    return out;
}

function attachLobby(io) {
    let pushPending = false;

    /** Tell the lobby who is in it, at most once a second. */
    function announce() {
        if (pushPending) return;
        pushPending = true;
        const timer = setTimeout(() => {
            pushPending = false;
            io.to(LOBBY_ROOM).emit('hx:lobby:update', { players: roster() });
        }, PUSH_MS);
        if (timer.unref) timer.unref();
    }

    /** Take an invitation off the table, telling both sides why if there is a why. */
    function dropChallenge(id, event) {
        const challenge = challenges.get(id);
        if (!challenge) return;
        clearTimeout(challenge.timer);
        challenges.delete(id);
        if (!event) return;
        for (const userId of [challenge.from.userId, challenge.to.userId]) {
            const entry = present.get(userId);
            if (entry) io.to(entry.socketId).emit(event, { id });
        }
    }

    io.on('connection', (socket) => {
        const reply = (callback, payload) => {
            if (typeof callback === 'function') callback(payload);
        };

        /** Step into the room: you are now visible and challengeable. */
        socket.on('hx:lobby:enter', (payload, callback) => {
            const user = socket.data.user;
            if (!user) return reply(callback, { ok: false, error: 'SIGN_IN_REQUIRED' });
            present.set(user.userId, {
                userId: user.userId,
                pseudo: user.pseudo,
                elo: user.elo,
                socketId: socket.id,
                since: Date.now(),
            });
            socket.join(LOBBY_ROOM);
            socket.data.hxInLobby = true;
            announce();
            reply(callback, { ok: true, players: roster(), chat, you: user.userId });
        });

        socket.on('hx:lobby:leave', (payload, callback) => {
            const user = socket.data.user;
            if (user) {
                const entry = present.get(user.userId);
                if (entry && entry.socketId === socket.id) present.delete(user.userId);
            }
            socket.leave(LOBBY_ROOM);
            socket.data.hxInLobby = false;
            announce();
            reply(callback, { ok: true });
        });

        socket.on('hx:lobby:chat', (payload, callback) => {
            const user = socket.data.user;
            if (!user) return reply(callback, { ok: false, error: 'SIGN_IN_REQUIRED' });
            if (!present.has(user.userId)) return reply(callback, { ok: false, error: 'NOT_IN_LOBBY' });

            const text = String((payload && payload.text) || '').replace(/\s+/g, ' ').trim();
            if (!text) return reply(callback, { ok: false, error: 'EMPTY' });
            const now = Date.now();
            if (now - (socket.data.hxLastLobbyChatAt || 0) < CHAT_MIN_INTERVAL_MS) {
                return reply(callback, { ok: false, error: 'TOO_FAST' });
            }
            socket.data.hxLastLobbyChatAt = now;

            const message = {
                userId: user.userId,
                pseudo: user.pseudo,
                text: text.slice(0, CHAT_MAX_LENGTH),
                at: now,
            };
            chat.push(message);
            if (chat.length > CHAT_HISTORY) chat.shift();
            io.to(LOBBY_ROOM).emit('hx:lobby:chat', { message });
            reply(callback, { ok: true });
        });

        /** Invite one named player to a game at a cadence you choose. */
        socket.on('hx:challenge', (payload, callback) => {
            const user = socket.data.user;
            if (!user) return reply(callback, { ok: false, error: 'SIGN_IN_REQUIRED' });
            const targetId = String((payload && payload.userId) || '');
            if (targetId === user.userId) return reply(callback, { ok: false, error: 'NOT_YOURSELF' });
            const target = present.get(targetId);
            if (!target) return reply(callback, { ok: false, error: 'NOT_HERE' });

            // One invitation at a time between the same two people, so a
            // repeated click does not fill the other player's screen.
            for (const existing of challenges.values()) {
                if (existing.from.userId === user.userId && existing.to.userId === targetId) {
                    return reply(callback, { ok: true, id: existing.id, resent: true });
                }
            }

            const id = String(nextChallengeId++);
            const timeControl = String((payload && payload.timeControl) || 'rapid');
            const challenge = {
                id,
                from: { userId: user.userId, pseudo: user.pseudo, elo: user.elo },
                to: { userId: target.userId, pseudo: target.pseudo, elo: target.elo },
                timeControl,
                at: Date.now(),
                timer: null,
            };
            challenge.timer = setTimeout(
                () => dropChallenge(id, 'hx:challenge:expired'), CHALLENGE_TTL_MS);
            if (challenge.timer.unref) challenge.timer.unref();
            challenges.set(id, challenge);

            io.to(target.socketId).emit('hx:challenge:incoming', {
                id, from: challenge.from, timeControl,
            });
            reply(callback, { ok: true, id });
        });

        socket.on('hx:challenge:accept', async (payload, callback) => {
            const user = socket.data.user;
            if (!user) return reply(callback, { ok: false, error: 'SIGN_IN_REQUIRED' });
            const challenge = challenges.get(String((payload && payload.id) || ''));
            if (!challenge) return reply(callback, { ok: false, error: 'NO_SUCH_CHALLENGE' });
            if (challenge.to.userId !== user.userId) return reply(callback, { ok: false, error: 'NOT_YOURS' });

            const challenger = present.get(challenge.from.userId);
            if (!challenger) {
                dropChallenge(challenge.id, null);
                return reply(callback, { ok: false, error: 'NOT_HERE' });
            }

            // Colours by coin toss, as in quick match: being the one who asked
            // should not decide who moves first.
            const [black, white] = Math.random() < 0.5
                ? [challenge.from, challenge.to]
                : [challenge.to, challenge.from];
            let room;
            try {
                room = await createRoom({
                    timeControl: challenge.timeControl,
                    reserved: [black.userId, white.userId],
                });
            } catch (error) {
                return reply(callback, { ok: false, error: 'ENGINE_UNAVAILABLE' });
            }
            dropChallenge(challenge.id, null);

            const send = (person, seat, opponent) => {
                const entry = present.get(person.userId);
                if (!entry) return;
                io.to(entry.socketId).emit('hx:challenge:ready', {
                    code: room.code,
                    colour: seat,
                    timeControl: room.timeControl,
                    opponent: { pseudo: opponent.pseudo, elo: opponent.elo },
                });
            };
            send(black, 0, white);
            send(white, 1, black);
            reply(callback, { ok: true, code: room.code, colour: black.userId === user.userId ? 0 : 1 });
        });

        socket.on('hx:challenge:decline', (payload, callback) => {
            const user = socket.data.user;
            const challenge = challenges.get(String((payload && payload.id) || ''));
            if (!challenge) return reply(callback, { ok: true });
            // Either side may call it off: the target declines, the challenger
            // withdraws.
            if (!user || (challenge.to.userId !== user.userId && challenge.from.userId !== user.userId)) {
                return reply(callback, { ok: false, error: 'NOT_YOURS' });
            }
            dropChallenge(challenge.id, 'hx:challenge:declined');
            reply(callback, { ok: true });
        });

        socket.on('disconnect', () => {
            const user = socket.data.user;
            if (!user) return;
            const entry = present.get(user.userId);
            if (!entry || entry.socketId !== socket.id) return;   // another tab holds it
            present.delete(user.userId);
            for (const challenge of [...challenges.values()]) {
                if (challenge.from.userId === user.userId || challenge.to.userId === user.userId) {
                    dropChallenge(challenge.id, 'hx:challenge:expired');
                }
            }
            announce();
        });
    });

    return { announce };
}

module.exports = {
    attachLobby, present, challenges, chat, roster, isPlaying,
    CHALLENGE_TTL_MS, PUSH_MS,
};
