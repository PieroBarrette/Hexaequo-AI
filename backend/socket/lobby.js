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

const {
    createRoom, rooms, online, statusOf, isPlaying, roomOf, onGameFinished,
} = require('./onlineGame');
const { query } = require('../config/database');

const PUSH_MS = 1000;                     // coalesce presence updates
const CHALLENGE_TTL_MS = 60 * 1000;
/* An invitation accepted by somebody mid-game waits for their board to clear.
   Long enough for a real game to finish, short enough that a forgotten
   agreement does not pull two people into a room an hour later. */
const AGREEMENT_TTL_MS = 20 * 60 * 1000;
const CHAT_MAX_LENGTH = 300;
const CHAT_MIN_INTERVAL_MS = 700;
const CHAT_HISTORY = 80;          // shown to someone arriving
const CHAT_KEEP = 500;            // kept in the table behind that
const LOBBY_ROOM = 'hx:lobby';

/** userId → presence. One entry per account, however many tabs are open. */
const present = new Map();
/** id → { from, to, timeControl } while an invitation is outstanding. */
const challenges = new Map();
/*
 * Invitations that have been said yes to but cannot start yet, because one of
 * the two is still at another board. They sit here until both are free.
 */
const agreements = new Map();
/*
 * The last few things said, kept in memory for speed and in the database for
 * keeps.
 *
 * It used to be memory alone, which meant every deploy and every idle
 * spin-down quietly erased the conversation — someone came back to a room that
 * claimed nothing had ever been said in it.
 */
const chat = [];

/** Games in progress that anybody may look in on. */
function liveGames() {
    const out = [];
    for (const room of rooms.values()) {
        if (room.result) continue;
        const [black, white] = room.players;
        if (!black || !white || !room.seats[0] || !room.seats[1]) continue;
        out.push({
            code: room.code,
            black: { pseudo: black.pseudo, elo: black.elo },
            white: { pseudo: white.pseudo, elo: white.elo },
            timeControl: room.timeControl,
            plies: room.moves.length,
            watchers: room.watchers.size,
        });
    }
    return out.sort((a, b) => b.plies - a.plies);
}

/** Fill the cache from the database, once, at start-up. */
async function loadChat() {
    try {
        const { rows } = await query(
            `SELECT user_id, pseudo, text, created_at FROM lobby_messages
             ORDER BY created_at DESC, id DESC LIMIT $1`,
            [CHAT_HISTORY]
        );
        chat.length = 0;
        for (const row of rows.reverse()) {
            chat.push({
                userId: row.user_id,
                pseudo: row.pseudo,
                text: row.text,
                at: new Date(row.created_at).getTime(),
            });
        }
    } catch (error) {
        // A lobby with no history is still a working lobby.
        console.error('[lobby] could not read the chat history:', error.message);
    }
}

/** Write one message, and trim the table so it cannot grow without end. */
async function rememberMessage(message) {
    try {
        await query(
            'INSERT INTO lobby_messages (user_id, pseudo, text) VALUES ($1,$2,$3)',
            [message.userId, message.pseudo, message.text]
        );
        if (Math.random() < 0.05) {
            await query(
                `DELETE FROM lobby_messages WHERE id NOT IN (
                     SELECT id FROM lobby_messages ORDER BY id DESC LIMIT $1)`,
                [CHAT_KEEP]
            );
        }
    } catch (error) {
        console.error('[lobby] could not store a message:', error.message);
    }
}

let nextChallengeId = 1;

/**
 * Whether this player is in a game right now.
 *
 * Read off the live rooms rather than tracked separately: two sources of truth
 * about the same thing would drift, and a stale "available" is a worse lie than
 * a scan of a handful of rooms.
 */
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
    loadChat();

    /** Tell the lobby who is in it, at most once a second. */
    function announce() {
        if (pushPending) return;
        pushPending = true;
        const timer = setTimeout(() => {
            pushPending = false;
            io.to(LOBBY_ROOM).emit('hx:lobby:update', { players: roster(), games: liveGames() });
        }, PUSH_MS);
        if (timer.unref) timer.unref();
    }

    /** Send to whoever holds this account, wherever on the site they are. */
    function toUser(userId, event, payload) {
        const entry = online.get(userId);
        if (entry) io.to(entry.socketId).emit(event, payload);
    }

    /** Take an invitation off the table, telling both sides why if there is a why. */
    function dropChallenge(id, event) {
        const challenge = challenges.get(id) || agreements.get(id);
        if (!challenge) return;
        clearTimeout(challenge.timer);
        challenges.delete(id);
        agreements.delete(id);
        if (!event) return;
        for (const userId of [challenge.from.userId, challenge.to.userId]) {
            toUser(userId, event, { id });
        }
    }

    /**
     * Open the room two people have agreed to, once neither is at another
     * board. Called when a game ends and when somebody's light changes, so an
     * agreement made mid-game starts the moment it can.
     */
    async function tryStartAgreement(id) {
        const deal = agreements.get(id);
        if (!deal) return;
        for (const person of [deal.from, deal.to]) {
            if (statusOf(person.userId) !== 'free') return;      // not yet
        }
        agreements.delete(id);
        clearTimeout(deal.timer);
        await openAgreedRoom(deal);
    }

    /** Build the room and send both players into it. */
    async function openAgreedRoom(deal) {
        // Colours by coin toss, as in quick match: being the one who asked
        // should not decide who moves first.
        const [black, white] = Math.random() < 0.5
            ? [deal.from, deal.to]
            : [deal.to, deal.from];
        let room;
        try {
            room = await createRoom({
                timeControl: deal.timeControl,
                reserved: [black.userId, white.userId],
            });
        } catch (error) {
            for (const person of [deal.from, deal.to]) {
                toUser(person.userId, 'hx:challenge:expired', { id: deal.id });
            }
            return null;
        }
        const send = (person, seat, opponent) => toUser(person.userId, 'hx:challenge:ready', {
            code: room.code,
            colour: seat,
            timeControl: room.timeControl,
            opponent: { pseudo: opponent.pseudo, elo: opponent.elo },
        });
        send(black, 0, white);
        send(white, 1, black);
        return { room, black, white };
    }

    /* A finished game frees two people; any agreement waiting on either of
       them can now open. */
    onGameFinished(() => {
        for (const id of [...agreements.keys()]) tryStartAgreement(id);
    });

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
            reply(callback, { ok: true, players: roster(), games: liveGames(), chat, you: user.userId });
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
            rememberMessage(message);        // not awaited: saying it is what matters
            io.to(LOBBY_ROOM).emit('hx:lobby:chat', { message });
            reply(callback, { ok: true });
        });

        /** Invite one named player to a game at a cadence you choose. */
        socket.on('hx:challenge', (payload, callback) => {
            const user = socket.data.user;
            if (!user) return reply(callback, { ok: false, error: 'SIGN_IN_REQUIRED' });
            const targetId = String((payload && payload.userId) || '');
            if (targetId === user.userId) return reply(callback, { ok: false, error: 'NOT_YOURSELF' });
            const target = online.get(targetId);
            if (!target) return reply(callback, { ok: false, error: 'NOT_HERE' });

            /*
             * One at a time, in both directions. A repeated click resends
             * rather than stacking; a second person's invitation waits until
             * the first has been answered, so nobody is asked two questions
             * they can only say yes to once.
             */
            for (const existing of [...challenges.values(), ...agreements.values()]) {
                if (existing.from.userId === user.userId && existing.to.userId === targetId) {
                    return reply(callback, { ok: true, id: existing.id, resent: true });
                }
                if (existing.from.userId === user.userId) {
                    return reply(callback, { ok: false, error: 'ALREADY_ASKING' });
                }
                if (existing.to.userId === targetId || existing.from.userId === targetId
                    || existing.to.userId === user.userId) {
                    return reply(callback, { ok: false, error: 'ALREADY_ASKED' });
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
                // Said plainly, so the answer can be an informed yes: accepting
                // while at another board schedules the game rather than
                // starting it.
                busy: isPlaying(target.userId),
            });
            reply(callback, { ok: true, id, busy: isPlaying(target.userId) });
        });

        socket.on('hx:challenge:accept', async (payload, callback) => {
            const user = socket.data.user;
            if (!user) return reply(callback, { ok: false, error: 'SIGN_IN_REQUIRED' });
            const challenge = challenges.get(String((payload && payload.id) || ''));
            if (!challenge) return reply(callback, { ok: false, error: 'NO_SUCH_CHALLENGE' });
            if (challenge.to.userId !== user.userId) return reply(callback, { ok: false, error: 'NOT_YOURS' });

            if (!online.has(challenge.from.userId)) {
                dropChallenge(challenge.id, null);
                return reply(callback, { ok: false, error: 'NOT_HERE' });
            }

            clearTimeout(challenge.timer);
            challenges.delete(challenge.id);

            /*
             * Somebody still at a board can say yes; what they are agreeing to
             * is the next game rather than this minute. The agreement is held
             * until neither of them is playing, and both are told which of the
             * two answers they got.
             */
            const waiting = [challenge.from, challenge.to]
                .some((person) => statusOf(person.userId) === 'playing');
            if (waiting) {
                const deal = { ...challenge, timer: null, agreedAt: Date.now() };
                deal.timer = setTimeout(
                    () => dropChallenge(deal.id, 'hx:challenge:expired'), AGREEMENT_TTL_MS);
                if (deal.timer.unref) deal.timer.unref();
                agreements.set(deal.id, deal);
                for (const [person, other] of [[deal.from, deal.to], [deal.to, deal.from]]) {
                    const theirs = roomOf(other.userId);
                    toUser(person.userId, 'hx:challenge:agreed', {
                        id: deal.id,
                        timeControl: deal.timeControl,
                        opponent: { pseudo: other.pseudo, elo: other.elo },
                        // The one who said yes already knows they said yes.
                        youAccepted: person.userId === user.userId,
                        // Where the other one is, so waiting can be watching.
                        watchCode: theirs && !roomOf(person.userId) ? theirs.code : null,
                    });
                }
                return reply(callback, { ok: true, deferred: true, id: deal.id });
            }

            const opened = await openAgreedRoom(challenge);
            if (!opened) return reply(callback, { ok: false, error: 'ENGINE_UNAVAILABLE' });
            reply(callback, {
                ok: true,
                code: opened.room.code,
                colour: opened.black.userId === user.userId ? 0 : 1,
            });
        });

        /** Anything addressed to me that is still standing. */
        socket.on('hx:challenge:pending', (payload, callback) => {
            const user = socket.data.user;
            if (!user) return reply(callback, { ok: true, incoming: null, agreed: null });
            let incoming = null;
            let agreed = null;
            for (const challenge of challenges.values()) {
                if (challenge.to.userId !== user.userId) continue;
                incoming = {
                    id: challenge.id,
                    from: challenge.from,
                    timeControl: challenge.timeControl,
                    busy: isPlaying(user.userId),
                };
            }
            for (const deal of agreements.values()) {
                const mine = deal.from.userId === user.userId ? deal.to
                    : (deal.to.userId === user.userId ? deal.from : null);
                if (!mine) continue;
                const theirs = roomOf(mine.userId);
                agreed = {
                    id: deal.id,
                    timeControl: deal.timeControl,
                    opponent: { pseudo: mine.pseudo, elo: mine.elo },
                    youAccepted: true,      // nothing new happened; say nothing about it
                    watchCode: theirs && !roomOf(user.userId) ? theirs.code : null,
                };
            }
            reply(callback, { ok: true, incoming, agreed });
        });

        socket.on('hx:challenge:decline', (payload, callback) => {
            const user = socket.data.user;
            const id = String((payload && payload.id) || '');
            const challenge = challenges.get(id) || agreements.get(id);
            if (!challenge) return reply(callback, { ok: true });
            // Either side may call it off: the target declines, the challenger
            // withdraws, and an agreement already made can be cancelled by
            // whoever changes their mind first.
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
            for (const challenge of [...challenges.values(), ...agreements.values()]) {
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
    attachLobby, present, challenges, agreements, chat, roster, liveGames, loadChat,
    CHALLENGE_TTL_MS, PUSH_MS,
};
