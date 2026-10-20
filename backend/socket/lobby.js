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
    createRoom, rooms, online, statusOf, isPlaying, roomOf, onGameFinished, onPresenceChange,
} = require('./onlineGame');
const database = require('../config/database');
const { query } = database;
const push = require('../services/pushService');
const { tell, attentive } = require('./notify');

const PUSH_MS = 1000;                     // coalesce presence updates
const CHALLENGE_TTL_MS = 60 * 1000;
/*
 * A challenge that went to somebody's phone rather than to their screen.
 *
 * A minute is plenty for a person looking at the site and nowhere near enough
 * for one who has to notice a notification, pick up the phone and open the
 * app — so a question that had to be carried to them waits ten.
 */
const NOTIFIED_CHALLENGE_TTL_MS = 10 * 60 * 1000;
/* A yes given to somebody who has since left, and who has been told: the game
   waits this long for them to come back to it. */
const RETURN_TTL_MS = 10 * 60 * 1000;
/* Coming back is a reload, and a reloading page needs a moment to start
   listening before the room it is being sent to is opened. */
const RETURN_SETTLE_MS = 1500;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/* An invitation accepted by somebody mid-game waits for their board to clear.
   Long enough for a real game to finish, short enough that a forgotten
   agreement does not pull two people into a room an hour later. */
const AGREEMENT_TTL_MS = 20 * 60 * 1000;
const CHAT_MAX_LENGTH = 300;
const CHAT_MIN_INTERVAL_MS = 700;
const CHAT_HISTORY = 80;          // shown to someone arriving
const CHAT_KEEP = 500;            // kept in the table behind that
/*
 * How long anything said here lasts.
 *
 * A lobby is a room people pass through, not a record. A day is long enough
 * that somebody coming back in the evening still sees the morning, and short
 * enough that nobody arrives to a wall of last week.
 */
const CHAT_LIFETIME_MS = 24 * 60 * 60 * 1000;
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
            black: { pseudo: black.pseudo, elo: black.elo, userId: black.userId },
            white: { pseudo: white.pseudo, elo: white.elo, userId: white.userId },
            timeControl: room.timeControl,
            plies: room.moves.length,
            watchers: room.watchers.size,
        });
    }
    return out.sort((a, b) => b.plies - a.plies);
}

/** Drop anything said more than a day ago. */
function pruneChat() {
    const cutoff = Date.now() - CHAT_LIFETIME_MS;
    let keep = 0;
    while (keep < chat.length && chat[keep].at < cutoff) keep++;
    if (keep) chat.splice(0, keep);
}

/**
 * Fill the cache from the database, once, at start-up.
 *
 * The rows older than a day stay where they are — the table trims itself by
 * count, and nothing here deletes anybody's data — they are simply not read.
 */
async function loadChat() {
    try {
        const { rows } = await query(
            `SELECT user_id, pseudo, text, created_at FROM lobby_messages
             WHERE created_at > NOW() - $2::interval
             ORDER BY created_at DESC, id DESC LIMIT $1`,
            [CHAT_HISTORY, `${Math.round(CHAT_LIFETIME_MS / 1000)} seconds`]
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
 * Who a message names.
 *
 * Matched against who is signed in rather than parsed into a name and trusted:
 * "@" followed by letters is a guess at a pseudonym, and the only pseudonyms
 * worth telling are the ones belonging to somebody who can be told. Pseudonyms
 * may contain spaces, so the longest match at each "@" wins — "@Jean Luc" finds
 * Jean Luc before it finds Jean.
 *
 * Never yourself: naming yourself is a way of writing, not of calling.
 */
function mentioned(text, exceptUserId) {
    const found = new Set();
    const names = [...online.values()]
        .filter((entry) => entry.userId !== exceptUserId)
        .sort((a, b) => b.pseudo.length - a.pseudo.length);
    const lower = text.toLowerCase();
    for (let i = lower.indexOf('@'); i !== -1; i = lower.indexOf('@', i + 1)) {
        const after = lower.slice(i + 1);
        for (const entry of names) {
            if (after.startsWith(entry.pseudo.toLowerCase())) { found.add(entry.userId); break; }
        }
    }
    return found;
}

/* What can follow a name without being part of it. */
const NAME_ENDS = /[^a-z0-9_-]/;

/**
 * Who a message names among the people who are not here.
 *
 * mentioned() can only match the names it can see, and somebody who is away is
 * exactly who a notification is for. So every way the text after an "@" could
 * end as a name — "@Jean", "@Jean Luc" — is looked up at once, and at each "@"
 * the longest that belongs to an account wins, the same rule as above.
 */
async function mentionedAway(text, exceptUserId) {
    const lower = text.toLowerCase();
    const candidates = new Set();
    for (let i = lower.indexOf('@'); i !== -1 && candidates.size < 60; i = lower.indexOf('@', i + 1)) {
        const after = lower.slice(i + 1, i + 31);
        for (let end = 1; end <= after.length; end++) {
            if (end === after.length || NAME_ENDS.test(after[end])) {
                const name = after.slice(0, end).trim();
                if (name.length >= 3) candidates.add(name);
            }
        }
    }
    if (!candidates.size) return new Set();
    let rows;
    try {
        ({ rows } = await query(
            'SELECT id, pseudo FROM users WHERE LOWER(pseudo) = ANY($1::text[])', [[...candidates]]));
    } catch {
        return new Set();            // no database, or not now: nobody is told
    }
    const byName = rows.map((row) => ({ name: String(row.pseudo).toLowerCase(), id: row.id }))
        .sort((a, b) => b.name.length - a.name.length);
    const found = new Set();
    for (let i = lower.indexOf('@'); i !== -1; i = lower.indexOf('@', i + 1)) {
        const after = lower.slice(i + 1, i + 31);
        const hit = byName.find(({ name }) => after.startsWith(name)
            && (after.length === name.length || NAME_ENDS.test(after[name.length])));
        if (hit && hit.id !== exceptUserId) found.add(hit.id);
    }
    return found;
}

/**
 * Somebody not on the site who could still be asked, or null.
 *
 * Only those who have switched notifications on and left challenges on: for
 * anyone else a challenge would sit in memory for ten minutes reaching nobody.
 */
async function reachableAccount(userId) {
    if (!userId || (database.hasDatabase() && !UUID.test(userId))) return null;
    if (!(await push.reachable(userId, 'challenge'))) return null;
    try {
        const { rows } = await query('SELECT id, pseudo, elo FROM users WHERE id = $1', [userId]);
        if (!rows.length) return null;
        return { userId: rows[0].id, pseudo: rows[0].pseudo, elo: rows[0].elo, socketId: null };
    } catch {
        return null;
    }
}

/** A short line of chat, for a notification: the start of it is enough to decide. */
const excerpt = (text) => (text.length > 120 ? `${text.slice(0, 117)}…` : text);

/*
 * Who is here, and what each of them is doing.
 *
 * Whether somebody is at a board is read off the live rooms rather than tracked
 * separately: two sources of truth about the same thing would drift, and a
 * stale "available" is a worse lie than a scan of a handful of rooms.
 *
 * Everyone signed in, not everyone standing in the lobby.
 *
 * It listed only the sockets that had the online page open, so a player
 * halfway through a local game was invisible and could not be challenged —
 * though the challenge would have reached them perfectly well, being addressed
 * by account and sent wherever the person is. The list was the only thing
 * holding it back, and it read the narrower of the two maps for no reason but
 * the order the two were written in.
 */
function roster() {
    const out = [];
    for (const entry of online.values()) {
        const here = present.get(entry.userId);
        out.push({
            userId: entry.userId,
            pseudo: entry.pseudo,
            elo: entry.elo,
            // Since when they have had the lobby open, where they have it open.
            since: here ? here.since : null,
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
        /* Whichever of the two is not looking has a board waiting with their
           name on it — the one who asked, usually, gone to make a coffee. */
        for (const [person, opponent] of [[black, white], [white, black]]) {
            tell(io, person.userId, 'ready', { name: opponent.pseudo },
                { url: `/#/play?online=1&code=${room.code}`, tag: 'challenge', topic: 'challenge' });
        }
        return { room, black, white };
    }

    /**
     * Carry a challenge to somebody's phone.
     *
     * Another person's button pulls this one, so it is rationed: one per pair
     * every five minutes, six an hour for anybody being asked, and past that
     * the challenge still stands but nothing more buzzes.
     */
    function tellChallenge(challenge) {
        const { from, to } = challenge;
        if (!push.allow(`challenge:${from.userId}:${to.userId}`, 1, 5 * 60 * 1000)) return;
        if (!push.allow(`challenged:${to.userId}`, 6, 60 * 60 * 1000)) return;
        tell(io, to.userId, 'challenge', (language) => ({
            name: from.pseudo,
            elo: from.elo,
            cadence: push.cadenceName(language, challenge.timeControl),
        }), { url: `/#/online?challenge=${challenge.id}`, tag: 'challenge', topic: 'challenge' });
    }

    /**
     * A call in the chat, carried to a phone: to whoever is named and not
     * looking, here or not. One per pair every two minutes, so a conversation
     * that keeps saying somebody's name does not keep ringing their pocket.
     */
    async function tellMentioned(message, named) {
        if (!push.enabled() || !message.text.includes('@')) return;
        const everyone = new Set(named);
        for (const userId of await mentionedAway(message.text, message.userId)) everyone.add(userId);
        for (const userId of everyone) {
            if (!push.allow(`mention:${message.userId}:${userId}`, 1, 2 * 60 * 1000)) continue;
            if (!push.allow(`mentioned:${userId}`, 10, 60 * 60 * 1000)) continue;
            tell(io, userId, 'mention', { name: message.pseudo, text: excerpt(message.text) },
                { url: '/#/online', tag: 'mention', topic: 'mention' });
        }
    }

    /* A finished game frees two people; any agreement waiting on either of
       them can now open. */
    onGameFinished(() => {
        for (const id of [...agreements.keys()]) tryStartAgreement(id);
        announce();          // and two lights just changed colour
    });

    /* Signing in, signing out, sitting down at a board: the list is who is here
       and what they are doing, so it is redrawn whenever either moves.

       And somebody arriving may be the one a game is waiting for: the person
       who asked, told by notification that their challenge was accepted while
       they were away. Their page is still loading, so the room opens a moment
       later rather than before it can hear about it. */
    onPresenceChange((userId, status) => {
        announce();
        if (status !== 'free') return;
        for (const [id, deal] of agreements) {
            if (deal.from.userId !== userId && deal.to.userId !== userId) continue;
            const timer = setTimeout(() => tryStartAgreement(id), RETURN_SETTLE_MS);
            if (timer.unref) timer.unref();
        }
    });

    io.on('connection', (socket) => {
        const reply = (callback, payload) => {
            if (typeof callback === 'function') callback(payload);
        };

        /**
         * Step into the room.
         *
         * Anyone may listen: reading who is about and what is being said is
         * part of the site looking inhabited, and a visitor with no account
         * can still watch a game or open a private one. Only a name goes on
         * the list, because only a name can be challenged.
         */
        socket.on('hx:lobby:enter', (payload, callback) => {
            const user = socket.data.user;
            socket.join(LOBBY_ROOM);
            pruneChat();
            if (!user) {
                return reply(callback, {
                    ok: true, players: roster(), games: liveGames(), chat, you: null,
                });
            }
            present.set(user.userId, {
                userId: user.userId,
                pseudo: user.pseudo,
                elo: user.elo,
                socketId: socket.id,
                since: Date.now(),
            });
            socket.data.hxInLobby = true;
            announce();
            reply(callback, { ok: true, players: roster(), games: liveGames(), chat, you: user.userId });
        });

        /*
         * The games anybody may look in on, without stepping into the room.
         *
         * Asked by somebody whose game -- the one they were watching -- has
         * just ended, and who might watch another. Entering the lobby to read
         * the list would put their name on it for everybody else to see.
         */
        socket.on('hx:live', (payload, callback) => {
            reply(callback, { ok: true, games: liveGames() });
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
            pruneChat();
            if (chat.length > CHAT_HISTORY) chat.shift();
            rememberMessage(message);        // not awaited: saying it is what matters
            io.to(LOBBY_ROOM).emit('hx:lobby:chat', { message });

            /* Anyone named goes wherever they are, which is the point of naming
               them: the lobby is a room people are mostly not looking at. Sent
               through toUser rather than to the lobby, so it reaches a player
               in the middle of a local game. */
            const named = mentioned(text, user.userId);
            for (const userId of named) {
                toUser(userId, 'hx:mention', { message });
            }
            reply(callback, { ok: true });
            tellMentioned(message, named);        // not awaited: the chat does not wait on phones
        });

        /** Invite one named player to a game at a cadence you choose. */
        socket.on('hx:challenge', async (payload, callback) => {
            const user = socket.data.user;
            if (!user) return reply(callback, { ok: false, error: 'SIGN_IN_REQUIRED' });
            const targetId = String((payload && payload.userId) || '');
            if (targetId === user.userId) return reply(callback, { ok: false, error: 'NOT_YOURSELF' });
            /*
             * Somebody not on the site can still be asked, if they have said
             * they want to be told: the question goes to their phone. Anybody
             * else is not here, as before.
             */
            let target = online.get(targetId);
            if (!target) {
                const account = await reachableAccount(targetId);
                if (!account) return reply(callback, { ok: false, error: 'NOT_HERE' });
                // They may have arrived while we looked them up.
                target = online.get(targetId) || account;
            }
            const away = !target.socketId;

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
            /* Looking at the site, they answer within the minute or not at
               all. Anywhere else the question has to reach them first. */
            const looking = !away && attentive(io, target.userId);
            const challenge = {
                id,
                from: { userId: user.userId, pseudo: user.pseudo, elo: user.elo },
                to: { userId: target.userId, pseudo: target.pseudo, elo: target.elo },
                timeControl,
                at: Date.now(),
                timer: null,
                notified: !looking,
            };
            challenge.timer = setTimeout(() => dropChallenge(id, 'hx:challenge:expired'),
                looking ? CHALLENGE_TTL_MS : NOTIFIED_CHALLENGE_TTL_MS);
            if (challenge.timer.unref) challenge.timer.unref();
            challenges.set(id, challenge);

            if (!away) {
                io.to(target.socketId).emit('hx:challenge:incoming', {
                    id, from: challenge.from, timeControl,
                    // Said plainly, so the answer can be an informed yes: accepting
                    // while at another board schedules the game rather than
                    // starting it.
                    busy: isPlaying(target.userId),
                });
            }
            if (!looking) tellChallenge(challenge);
            toUser(user.userId, 'hx:challenge:sent', {
                id,
                to: { pseudo: challenge.to.pseudo, elo: challenge.to.elo },
                timeControl,
                away,
            });
            reply(callback, { ok: true, id, busy: !away && isPlaying(target.userId), away });
        });

        socket.on('hx:challenge:accept', async (payload, callback) => {
            const user = socket.data.user;
            if (!user) return reply(callback, { ok: false, error: 'SIGN_IN_REQUIRED' });
            const challenge = challenges.get(String((payload && payload.id) || ''));
            if (!challenge) return reply(callback, { ok: false, error: 'NO_SUCH_CHALLENGE' });
            if (challenge.to.userId !== user.userId) return reply(callback, { ok: false, error: 'NOT_YOURS' });

            /*
             * The one who asked has left. If they can be told, the yes is
             * kept and carried to their phone, and the game opens the moment
             * they are back — the person who answered a notification should
             * not be the one told "too late". If they cannot be told, it is
             * over, as before.
             */
            if (!online.has(challenge.from.userId)) {
                const canTell = await push.reachable(challenge.from.userId, 'accepted');
                if (!challenges.has(challenge.id)) {
                    return reply(callback, { ok: false, error: 'NO_SUCH_CHALLENGE' });
                }
                if (!canTell) {
                    dropChallenge(challenge.id, null);
                    return reply(callback, { ok: false, error: 'NOT_HERE' });
                }
                if (!online.has(challenge.from.userId)) {
                    clearTimeout(challenge.timer);
                    challenges.delete(challenge.id);
                    const deal = { ...challenge, timer: null, agreedAt: Date.now(), notified: true };
                    deal.timer = setTimeout(
                        () => dropChallenge(deal.id, 'hx:challenge:expired'), RETURN_TTL_MS);
                    if (deal.timer.unref) deal.timer.unref();
                    agreements.set(deal.id, deal);
                    toUser(user.userId, 'hx:challenge:agreed', {
                        id: deal.id,
                        timeControl: deal.timeControl,
                        opponent: { pseudo: deal.from.pseudo, elo: deal.from.elo },
                        youAccepted: true,
                        away: true,
                        watchCode: null,
                    });
                    tell(io, deal.from.userId, 'accepted', { name: user.pseudo },
                        { url: '/#/online', tag: 'challenge', topic: 'challenge' });
                    return reply(callback, { ok: true, deferred: true, away: true, id: deal.id });
                }
                // Back while we asked: carry on as if they had never left.
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
            let outgoing = null;
            let agreed = null;
            for (const challenge of challenges.values()) {
                if (challenge.to.userId === user.userId) {
                    incoming = {
                        id: challenge.id,
                        from: challenge.from,
                        timeControl: challenge.timeControl,
                        busy: isPlaying(user.userId),
                    };
                }
                /* One invitation at a time means an unanswered one blocks the
                   next, so whoever sent it has to be able to take it back. */
                if (challenge.from.userId === user.userId) {
                    outgoing = {
                        id: challenge.id,
                        to: { pseudo: challenge.to.pseudo, elo: challenge.to.elo },
                        timeControl: challenge.timeControl,
                        away: !online.has(challenge.to.userId),
                    };
                }
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
                    // Waiting on somebody who is not on the site, and has been told.
                    away: !online.has(mine.userId),
                    watchCode: theirs && !roomOf(user.userId) ? theirs.code : null,
                };
            }
            reply(callback, { ok: true, incoming, outgoing, agreed });
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
            /* Who called it off decides what the other one is told: the
               person asked refused, the person asking withdrew. */
            const withdrawn = challenge.from.userId === user.userId;
            clearTimeout(challenge.timer);
            challenges.delete(id);
            agreements.delete(id);
            for (const person of [challenge.from, challenge.to]) {
                toUser(person.userId, 'hx:challenge:declined', {
                    id, withdrawn, by: user.userId,
                });
            }
            reply(callback, { ok: true });
        });

        socket.on('disconnect', () => {
            const user = socket.data.user;
            if (!user) return;
            const entry = present.get(user.userId);
            if (!entry || entry.socketId !== socket.id) return;   // another tab holds it
            present.delete(user.userId);
            for (const challenge of [...challenges.values(), ...agreements.values()]) {
                /* One carried to a phone keeps its own ten minutes: closing
                   the lobby is not taking it back, and accepting it copes with
                   whoever asked having gone. */
                if (challenge.notified) continue;
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
    pruneChat, CHAT_LIFETIME_MS,
    CHALLENGE_TTL_MS, NOTIFIED_CHALLENGE_TTL_MS, RETURN_TTL_MS, PUSH_MS, mentionedAway,
};
