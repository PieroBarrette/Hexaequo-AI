/**
 * The world ranking.
 *
 * Only players with a finished rated game appear, so the table is a record of
 * play rather than a list of accounts.
 */

import { t } from '../i18n.js';
import { api, currentUser } from '../auth.js';

export function mountLeaderboard(outlet) {
  let state = { status: 'loading', players: [], total: 0 };

  function render() {
    if (state.status === 'loading') {
      outlet.innerHTML = `<div class="page"><div class="page-inner">
        <p class="lede">${t('leaderboard.loading')}</p></div></div>`;
      return;
    }
    if (state.status === 'error') {
      outlet.innerHTML = `<div class="page"><div class="page-inner">
        <p class="net-error">${t('online.errors.OFFLINE')}</p></div></div>`;
      return;
    }
    if (!state.players.length) {
      outlet.innerHTML = `<div class="page"><div class="page-inner">
        <p class="lede">${t('leaderboard.empty')}</p></div></div>`;
      return;
    }

    const me = currentUser();
    outlet.innerHTML = `
      <div class="page"><div class="page-inner">
        <p class="lede">${t('leaderboard.lede', { count: state.total })}</p>
        <table class="board-table">
          <thead><tr>
            <th>#</th><th>${t('leaderboard.player')}</th>
            <th class="num">${t('account.rating')}</th>
            <th class="num">${t('leaderboard.games')}</th>
            <th class="num">${t('leaderboard.winRate')}</th>
          </tr></thead>
          <tbody>
            ${state.players.map((p) => `
              <tr class="${me && p.id === me.id ? 'is-me' : ''}">
                <td class="num rank">${p.rank}</td>
                <td><a class="player-link" href="#/profile?id=${escapeHtml(p.id)}"
                       >${escapeHtml(p.pseudo)}</a></td>
                <td class="num elo">${p.elo}</td>
                <td class="num">${p.games_played}</td>
                <td class="num">${p.win_rate}%</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div></div>`;
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  render();
  api('/users/leaderboard?limit=100')
    .then((body) => {
      state = { status: 'ready', players: body.players || [], total: body.total || 0 };
      render();
    })
    .catch(() => { state.status = 'error'; render(); });
}
