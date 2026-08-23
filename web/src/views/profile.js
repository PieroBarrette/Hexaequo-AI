/**
 * A player's own page: what their record is, where their rating has been, and
 * every game they have played — each one a link into the review board.
 *
 * The record here is computed from the games themselves, so a friendly counts
 * as a game played even though it moved nobody's rating. Both numbers are
 * shown rather than one of them chosen for the reader.
 */

import { t } from '../i18n.js';
import { navigate } from '../router.js';
import { api, isSignedIn, sessionReady, onAuthChange } from '../auth.js';
import { play as playSound } from '../audio.js';
import { openPanel } from '../ui/panels.js';

const escapeText = (value) => String(value).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const cadenceLabel = (id) =>
  t('online.cadence' + String(id || 'none').charAt(0).toUpperCase() + String(id || 'none').slice(1));

function shortDate(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(undefined,
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

  const stop = onAuthChange(() => { if (!who) load(); });

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
          ${game.opponent.pseudo ? escapeText(game.opponent.pseudo) : t('profile.guest')}
        </span>
        <span class="game-meta">${cadenceLabel(game.timeControl)}</span>
        <span class="game-meta">${t('profile.plies', { n: game.plies })}</span>
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
          </div>
        </div>

        ${curveSvg(stats.curve || [])}

        <div class="rule-block">
          <h3>${t('profile.record')}</h3>
          ${recordLine('profile.allGames', stats.all)}
          ${recordLine('profile.ratedGames', stats.rated)}
          ${cadences.length ? `<h3 style="margin-top:16px">${t('profile.byCadence')}</h3>` : ''}
          ${cadences.map(([id, record]) =>
    `<div class="row"><span>${cadenceLabel(id)}</span>
             <b>${record.wins} · ${record.losses} · ${record.draws}</b></div>`).join('')}
        </div>

        <div class="rule-block">
          <h3>${t('profile.history')}</h3>
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
    const row = event.target.closest('[data-game]');
    if (row) {
      playSound('ui');
      // The review board is the play view, handed a finished game instead of
      // a live one.
      navigate('play', { game: row.getAttribute('data-game') });
      return;
    }
    const action = event.target.closest('[data-action]');
    if (action && action.getAttribute('data-action') === 'sign-in') {
      playSound('ui');
      openPanel('account');
    }
  });

  render();
  load();
  return () => stop();
}
