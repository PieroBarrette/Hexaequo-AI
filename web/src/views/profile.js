/**
 * A player's page — your own at #/profile, anybody else's at #/profile?id=…: what their record is, where their rating has been, and
 * every game they have played — each one a link into the review board.
 *
 * The record here is computed from the games themselves, so a friendly counts
 * as a game played even though it moved nobody's rating. Both numbers are
 * shown rather than one of them chosen for the reader.
 */

import { t, currentLanguage } from '../i18n.js';
import { navigate } from '../router.js';
import {
  api, isSignedIn, sessionReady, onAuthChange, sessionToken, currentUser, signOut,
  chooseNickname,
} from '../auth.js';
import { play as playSound } from '../audio.js';
import { openPanel } from '../ui/panels.js';
import { request, connect, identify } from '../net.js';
import { watchPresence, onPresence, presenceOf } from '../presence.js';

const escapeText = (value) => String(value).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const cadenceLabel = (id) =>
  t('online.cadence' + String(id || 'none').charAt(0).toUpperCase() + String(id || 'none').slice(1));

function shortDate(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(currentLanguage(),
    { year: 'numeric', month: 'short', day: 'numeric' });
}

/**
 * The rating curve, as a plain inline SVG.
 *
 * A line drawn from the points we have, not a chart library: it is one series
 * of at most sixty numbers, and a dependency would cost more than it draws.
 */
function curveSvg(points) {
  if (points.length < 2) return '';
  const width = 560;
  const height = 130;
  const pad = 6;
  const values = points.map((p) => p.elo);
  const low = Math.min(...values);
  const high = Math.max(...values);
  const span = Math.max(1, high - low);
  const x = (i) => pad + (i * (width - pad * 2)) / (points.length - 1);
  const y = (v) => height - pad - ((v - low) * (height - pad * 2)) / span;

  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.elo).toFixed(1)}`).join('');
  const area = `${line}L${x(points.length - 1).toFixed(1)},${height}L${x(0).toFixed(1)},${height}Z`;
  const last = points[points.length - 1];

  return `
    <div class="curve">
      <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img"
           aria-label="${t('profile.curve')}">
        <path d="${area}" fill="var(--accent)" opacity=".12"/>
        <path d="${line}" fill="none" stroke="var(--accent)" stroke-width="2"
              stroke-linejoin="round" stroke-linecap="round"/>
        <circle cx="${x(points.length - 1).toFixed(1)}" cy="${y(last.elo).toFixed(1)}" r="3.5"
                fill="var(--accent)"/>
      </svg>
      <div class="curve-scale"><span>${high}</span><span>${low}</span></div>
    </div>`;
}

export function mountProfile(outlet, params) {
  const who = params && params.get('id');
  let stats = null;
  let games = null;
  let page = 1;
  let error = null;
  let notice = null;
  /* The second step: which cadence, once somebody has decided to ask. */
  let choosing = false;
  /* The account panel is gone: what it held — signing out, and changing your
     nickname or password — belongs with the page that is already about you. */
  let managing = false;
  let manageError = null;
  let manageDone = null;
  let busy = false;

  const stop = onAuthChange(() => load());
  /* One account watched while this page is open; the light follows them in and
     out without the page being reloaded. */
  const stopWatching = who ? watchPresence([who]) : () => {};
  const stopPresence = who ? onPresence(() => render()) : () => {};

  /**
   * Green here and free, amber here but at a board, grey not here.
   *
   * Amber is deliberately not a closed door: somebody in the middle of a game
   * can still agree to play the next one, so the challenge button stays.
   */
  function presencePip() {
    const status = presenceOf(who);
    return `<span class="pip is-${status}" title="${t('presence.' + status)}"></span>`;
  }

  /** Whether this page belongs to somebody other than the person reading it. */
  const someoneElse = () => Boolean(who) && !(stats && stats.isYou);

  /**
   * Whether there is anybody here to ask.
   *
   * Offline is not a maybe: an invitation lives in memory and expires in a
   * minute, so there is nobody for it to reach. Amber is fine — somebody at a
   * board can agree to the game after this one.
   */
  const canChallenge = () =>
    someoneElse() && isSignedIn() && presenceOf(who) !== 'offline';

  /** The cadences a challenge can be played at: every one with a clock. */
  function cadenceChoice() {
    return `
      <div class="cadence-grid" style="margin-top:10px">
        ${['bullet', 'blitz', 'rapid', 'classic'].map((id) =>
    `<button class="btn cadence" data-send-challenge="${id}">${cadenceLabel(id)}</button>`).join('')}
        <button class="btn" data-action="challenge-cancel">${t('game.cancel')}</button>
      </div>`;
  }

  /**
   * How the two of you have got on, and an invitation.
   *
   * A leaderboard whose names lead nowhere is a list. What makes it a place is
   * being able to look someone up, see that you are two games down to them, and
   * ask for another.
   */
  function versusBlock() {
    const record = stats.versus;
    return `
      <div class="rule-block versus-block">
        <div class="versus-line">
          ${record
    ? `<span>${t('profile.versusRecord', { name: escapeText(stats.pseudo) })}
         <b>${record.wins} · ${record.losses} · ${record.draws}</b>
         <span class="muted-small">(${t('profile.games', { n: record.played })})</span></span>`
    : `<span class="lede">${t('profile.versusNever', { name: escapeText(stats.pseudo) })}</span>`}
          ${canChallenge() && !choosing
    ? `<button class="btn btn--primary btn--sm" data-action="challenge">${t('lobby.challenge')}</button>`
    : ''}
        </div>
        ${canChallenge() && choosing ? cadenceChoice() : ''}
        ${notice ? `<p class="lede" style="margin:8px 0 0">${escapeText(notice)}</p>` : ''}
      </div>`;
  }

  /**
   * Your account, where you already are.
   *
   * It used to be a panel that opened over whatever you were doing, whose only
   * real content was three buttons and one of them said "see my profile" —
   * which is this page. So the page absorbed it.
   */
  function accountBlock() {
    const user = currentUser();
    if (!user) return '';
    if (!managing) {
      return `
        <div class="rule-block">
          <div class="row-actions">
            <button class="btn" data-action="manage">${t('account.manage')}</button>
            <button class="btn" data-action="signout">${t('account.signOut')}</button>
          </div>
        </div>`;
    }
    return `
      <div class="rule-block">
        <h3>${t('account.manage')}</h3>
        <p class="lede" style="margin-top:0">${escapeText(user.email || '')}</p>
        ${manageError ? `<p class="net-error">${escapeText(manageError)}</p>` : ''}
        ${manageDone ? `<p class="lede">${escapeText(manageDone)}</p>` : ''}

        <h3 style="margin-top:16px">${t('account.changeNickname')}</h3>
        <div class="row-actions">
          <input class="btn nickname-input" data-input="pseudo" maxlength="20"
                 autocomplete="off" spellcheck="false"
                 value="${escapeText(user.pseudo)}">
          <button class="btn btn--primary" data-action="save-pseudo" ${busy ? 'disabled' : ''}>
            ${t('account.saveNickname')}</button>
        </div>

        ${user.hasPassword === false ? '' : `
        <h3 style="margin-top:16px">${t('account.changePassword')}</h3>
        <div class="manage-grid">
          <input class="btn" type="password" data-input="current" autocomplete="current-password"
                 placeholder="${t('account.currentPassword')}">
          <input class="btn" type="password" data-input="next" autocomplete="new-password"
                 placeholder="${t('account.newPassword')}">
          <button class="btn btn--primary" data-action="save-password" ${busy ? 'disabled' : ''}>
            ${t('account.savePassword')}</button>
        </div>`}

        <div class="row-actions" style="margin-top:18px">
          <button class="btn" data-action="manage-close">${t('common.close')}</button>
          <button class="btn" data-action="signout">${t('account.signOut')}</button>
        </div>
      </div>`;
  }

  /** Change the nickname, using the same endpoint the first choice used. */
  async function savePseudo() {
    const field = outlet.querySelector('[data-input="pseudo"]');
    const pseudo = field ? field.value.trim() : '';
    if (!pseudo) return;
    busy = true; manageError = null; manageDone = null; render();
    try {
      await chooseNickname(pseudo);     // which also refreshes the session copy
      manageDone = t('account.nicknameSaved');
      await load();                      // the page is titled with it
    } catch (error) {
      manageError = error.message;
    }
    busy = false;
    render();
  }

  async function savePassword() {
    const current = outlet.querySelector('[data-input="current"]');
    const next = outlet.querySelector('[data-input="next"]');
    if (!current || !next || !current.value || !next.value) return;
    busy = true; manageError = null; manageDone = null; render();
    try {
      await api('/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword: current.value, newPassword: next.value }),
      });
      manageDone = t('account.passwordSaved');
    } catch (error) {
      manageError = error.message;
    }
    busy = false;
    render();
  }

  function recordLine(labelKey, record) {
    return `<div class="row"><span>${t(labelKey)}</span>
      <b>${record.wins} · ${record.losses} · ${record.draws}
      <span class="muted-small">(${t('profile.games', { n: record.played })})</span></b></div>`;
  }

  function outcomeChip(game) {
    const key = { win: 'won', loss: 'lost', draw: 'drew' }[game.outcome];
    return `<span class="outcome is-${game.outcome}">${t('profile.' + key)}</span>`;
  }

  function gameRow(game) {
    const change = game.ratingChange === null ? ''
      : `<span class="delta ${game.ratingChange > 0 ? 'is-up' : (game.ratingChange < 0 ? 'is-down' : '')}">`
        + `${game.ratingChange > 0 ? '+' : ''}${game.ratingChange}</span>`;
    return `
      <button class="game-row" data-game="${escapeText(game.id)}">
        ${outcomeChip(game)}
        <span class="game-vs">
          <span class="player-dot${game.colour === 1 ? ' is-white' : ''}"></span>
          ${game.opponent.userId && game.opponent.pseudo
    ? `<a class="player-link game-name" href="#/profile?id=${escapeText(game.opponent.userId)}"
          >${escapeText(game.opponent.pseudo)}</a>`
    : `<span class="game-name">${game.opponent.pseudo
      ? escapeText(game.opponent.pseudo) : t('profile.guest')}</span>`}
        </span>
        <span class="game-meta is-cadence">${cadenceLabel(game.timeControl)}</span>
        <span class="game-meta is-plies">${t('profile.plies', { n: game.plies })}</span>
        ${game.rated ? change : `<span class="muted-small">${t('online.unrated')}</span>`}
        <span class="game-meta">${shortDate(game.playedAt)}</span>
      </button>`;
  }

  function render() {
    if (!sessionReady() && !who) {
      outlet.innerHTML = `<div class="page"><div class="page-inner">
        <p class="lede">${t('online.connecting')}</p></div></div>`;
      return;
    }
    if (!who && !isSignedIn()) {
      outlet.innerHTML = `
        <div class="page"><div class="page-inner">
          <h1>${t('profile.title')}</h1>
          <p class="lede">${t('profile.signIn')}</p>
          <button class="btn btn--primary" data-action="sign-in">${t('account.signIn')}</button>
        </div></div>`;
      return;
    }
    if (error) {
      outlet.innerHTML = `<div class="page"><div class="page-inner">
        <h1>${t('profile.title')}</h1><p class="net-error">${escapeText(error)}</p></div></div>`;
      return;
    }
    if (!stats) {
      outlet.innerHTML = `<div class="page"><div class="page-inner">
        <p class="lede">${t('online.connecting')}</p></div></div>`;
      return;
    }

    const cadences = Object.entries(stats.byCadence || {})
      .sort((a, b) => b[1].played - a[1].played);

    outlet.innerHTML = `
      <div class="page"><div class="page-inner">
        <div class="profile-head">
          <div>
            <h1 style="margin:0">
              ${someoneElse() ? presencePip() : ''}${escapeText(stats.pseudo)}</h1>
            <p class="lede" style="margin:2px 0 0">
              ${t('profile.since', { date: shortDate(stats.memberSince) })}</p>
          </div>
          <div class="profile-elo">
            <b>${stats.elo}</b>
            <span class="muted-small">${t('profile.peak', { n: stats.peakElo })}</span>
            ${someoneElse() && isSignedIn()
    ? `<a class="player-link" href="#/profile">${t('profile.mine')}</a>` : ''}
          </div>
        </div>

        ${someoneElse() ? versusBlock() : ''}
        ${!someoneElse() && isSignedIn() ? accountBlock() : ''}

        ${curveSvg(stats.curve || [])}

        <div class="rule-block">
          <h3>${t(someoneElse() ? 'profile.theirRecord' : 'profile.record')}</h3>
          ${recordLine('profile.allGames', stats.all)}
          ${recordLine('profile.ratedGames', stats.rated)}
          ${cadences.length ? `<h3 style="margin-top:16px">${t('profile.byCadence')}</h3>` : ''}
          ${cadences.map(([id, record]) =>
    `<div class="row"><span>${cadenceLabel(id)}</span>
             <b>${record.wins} · ${record.losses} · ${record.draws}</b></div>`).join('')}
        </div>

        <div class="rule-block">
          <h3>${t(someoneElse() ? 'profile.theirGames' : 'profile.history')}</h3>
          ${games && games.games.length
    ? `<div class="game-list">${games.games.map(gameRow).join('')}</div>`
    : `<p class="lede">${t('profile.noGames')}</p>`}
          ${games && games.total > games.pageSize ? pager() : ''}
        </div>
      </div></div>`;
  }

  function pager() {
    const pages = Math.ceil(games.total / games.pageSize);
    return `<div class="row-actions" style="margin-top:12px">
      <button class="btn btn--sm" data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}>←</button>
      <span class="muted-small">${page} / ${pages}</span>
      <button class="btn btn--sm" data-page="${page + 1}" ${page >= pages ? 'disabled' : ''}>→</button>
    </div>`;
  }

  /**
   * Ask this player for a game.
   *
   * A challenge is delivered to somebody who is in the lobby; if they are not
   * there, say so plainly rather than pretending it went.
   */
  async function challenge(timeControl) {
    if (!who || !isSignedIn()) return;
    choosing = false;
    render();
    try {
      await connect();
      await identify(sessionToken()).catch(() => {});
      const response = await request('hx:challenge', { userId: who, timeControl });
      notice = !response.ok
        ? t('online.errors.' + response.error)
        : (presenceOf(who) === 'playing'
          ? t('challenge.sentToBusy', { name: stats ? stats.pseudo : '' })
          : t('lobby.challengeSent', { name: stats ? stats.pseudo : '' }));
    } catch {
      notice = t('online.errors.OFFLINE');
    }
    render();
  }

  async function load() {
    if (!who && !isSignedIn()) { render(); return; }
    error = null;
    try {
      const base = who ? `/profile/${encodeURIComponent(who)}` : '/profile/me';
      const [record, list] = await Promise.all([
        api(base),
        api(`${base}/games?page=${page}`),
      ]);
      stats = record;
      games = list;
    } catch (e) {
      error = e.message;
    }
    render();
  }

  outlet.addEventListener('click', (event) => {
    const send = event.target.closest('[data-send-challenge]');
    if (send) {
      playSound('ui');
      challenge(send.getAttribute('data-send-challenge'));
      return;
    }
    const pageButton = event.target.closest('[data-page]');
    if (pageButton && !pageButton.disabled) {
      page = Number(pageButton.getAttribute('data-page'));
      playSound('ui');
      load();
      return;
    }
    if (event.target.closest('.player-link')) return;   // the name, not the game
    const row = event.target.closest('[data-game]');
    if (row) {
      playSound('ui');
      // The review board is the play view, handed a finished game instead of
      // a live one.
      navigate('play', { game: row.getAttribute('data-game') });
      return;
    }
    const action = event.target.closest('[data-action]');
    if (!action) return;
    if (action.getAttribute('data-action') === 'sign-in') {
      playSound('ui');
      openPanel('account');
      return;
    }
    const what = action.getAttribute('data-action');
    if (what === 'challenge') { playSound('ui'); choosing = true; render(); return; }
    if (what === 'challenge-cancel') { playSound('ui'); choosing = false; render(); return; }
    if (what === 'manage') { playSound('ui'); managing = true; render(); return; }
    if (what === 'manage-close') {
      playSound('ui');
      managing = false; manageError = null; manageDone = null;
      render();
      return;
    }
    if (what === 'save-pseudo') { playSound('ui'); savePseudo(); return; }
    if (what === 'save-password') { playSound('ui'); savePassword(); return; }
    if (what === 'signout') { playSound('ui'); signOut(); navigate('home'); }
  });

  render();
  load();
  return () => { stop(); stopWatching(); stopPresence(); };
}
