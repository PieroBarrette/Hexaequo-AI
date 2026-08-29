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
import { api, isSignedIn, sessionReady, onAuthChange, sessionToken } from '../auth.js';
import { play as playSound } from '../audio.js';
import { openPanel } from '../ui/panels.js';
import { request, connect, identify } from '../net.js';

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

  const stop = onAuthChange(() => load());

  /** Whether this page belongs to somebody other than the person reading it. */
  const someoneElse = () => Boolean(who) && !(stats && stats.isYou);

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
          ${isSignedIn()
    ? `<button class="btn btn--primary btn--sm" data-action="challenge">${t('lobby.challenge')}</button>`
    : ''}
        </div>
        ${notice ? `<p class="lede" style="margin:8px 0 0">${escapeText(notice)}</p>` : ''}
      </div>`;
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
            <h1 style="margin:0">${escapeText(stats.pseudo)}</h1>
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
  async function challenge() {
    if (!who || !isSignedIn()) return;
    try {
      await connect();
      await identify(sessionToken()).catch(() => {});
      const response = await request('hx:challenge', { userId: who, timeControl: 'rapid' });
      notice = response.ok
        ? t('lobby.challengeSent', { name: stats ? stats.pseudo : '' })
        : t('online.errors.' + response.error);
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
    if (action.getAttribute('data-action') === 'challenge') {
      playSound('ui');
      challenge();
    }
  });

  render();
  load();
  return () => stop();
}
