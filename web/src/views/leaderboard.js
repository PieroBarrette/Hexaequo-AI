/**
 * The world ranking, and under it everybody else.
 *
 * A rating only means something once it has been played for. Ranking a member
 * who has not started at the thousand every account begins with puts them
 * above someone who has played and stands at nine hundred, which is false
 * about both — and prints a number beside a name that never earned it. So the
 * table ranks the players, and a plain list names the members who have not
 * begun: no rank, no rating, just who is here. The first rated game moves a
 * name from the second into the first, which is a nicer thing to arrive at
 * than a row that was always there.
 *
 * The ranking comes a hundred at a time, and the next hundred when the reader
 * reaches the bottom of the last: one scroll rather than one request.
 */

import { t } from '../i18n.js';
import { api, currentUser } from '../auth.js';
import { watchPresence, onPresence, presenceOf } from '../presence.js';

const PAGE = 100;

export function mountLeaderboard(outlet) {
  let state = { status: 'loading', players: [], waiting: [], total: 0 };
  let page = 0;                 // pages already in hand
  let loading = false;
  let exhausted = false;
  let scroller = null;
  /* Nobody is watched until there is a table to put lights on; released when
     the panel closes, so a list nobody is looking at is not kept up to date. */
  let stopWatching = () => {};
  const stopPresence = onPresence(() => { if (state.status === 'ready') render(); });

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function rows() {
    const me = currentUser();
    // Everyone in this table has played, so every column has something to say.
    return state.players.map((p) => `
        <tr class="${me && p.id === me.id ? 'is-me' : ''}">
          <td class="num rank">${p.rank}</td>
          <td class="player-cell"><span class="pip is-${presenceOf(p.id)}"
                    title="${t('presence.' + presenceOf(p.id))}"></span
              ><a class="player-link" href="#/profile?id=${escapeHtml(p.id)}"
                 >${escapeHtml(p.pseudo)}</a></td>
          <td class="num elo">${p.elo}</td>
          <td class="num">${p.games_played}</td>
          <td class="num">${p.win_rate}%</td>
        </tr>`).join('');
  }

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

    /* Rebuilt whole on every presence change, which is why the scroll position
       is put back afterwards: a light turning green three names down should not
       throw the reader back to the top of the list. */
    const wasAt = scroller ? scroller.scrollTop : 0;
    const ranking = state.players.length ? `
        <p class="lede">${t('leaderboard.lede', { count: state.total })}</p>
        <table class="board-table">
          <thead><tr>
            <th>#</th><th>${t('leaderboard.player')}</th>
            <th class="num">${t('account.rating')}</th>
            <th class="num">${t('leaderboard.games')}</th>
            <th class="num">${t('leaderboard.winRate')}</th>
          </tr></thead>
          <tbody>${rows()}</tbody>
        </table>
        ${exhausted ? '' : `<p class="lede">${t('leaderboard.more')}</p>`}`
      : `<p class="lede">${t('leaderboard.empty')}</p>`;

    /* Names and lights, nothing else: no rank to give and no rating to print. */
    const alsoHere = state.waiting.length ? `
        <h2>${t('leaderboard.waiting')}</h2>
        <p class="lede">${t('leaderboard.waitingHint')}</p>
        <ul class="member-roll">
          ${state.waiting.map((p) => `<li><span class="pip is-${presenceOf(p.id)}"
                  title="${t('presence.' + presenceOf(p.id))}"></span
              ><a class="player-link" href="#/profile?id=${escapeHtml(p.id)}"
                 >${escapeHtml(p.pseudo)}</a></li>`).join('')}
        </ul>` : '';

    outlet.innerHTML = `
      <div class="page"><div class="page-inner">
        ${ranking}
        ${alsoHere}
      </div></div>`;

    const next = outlet.querySelector('.page');
    if (next !== scroller) {
      if (scroller) scroller.removeEventListener('scroll', onScroll);
      scroller = next;
      if (scroller) scroller.addEventListener('scroll', onScroll, { passive: true });
    }
    if (scroller) scroller.scrollTop = wasAt;
  }

  function onScroll() {
    if (!scroller || loading || exhausted) return;
    const left = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
    if (left < 240) loadMore();
  }

  async function loadMore() {
    if (loading || exhausted) return;
    loading = true;
    try {
      const body = await api(`/users/leaderboard?limit=${PAGE}&page=${page + 1}`);
      const batch = body.players || [];
      page += 1;
      state = {
        status: 'ready',
        players: state.players.concat(batch),
        // Sent with the first page only; later pages leave it as it stands.
        waiting: body.waiting || state.waiting,
        total: body.total || state.players.length + batch.length,
      };
      /* Short of a full page, or we now hold everyone: there is no more to ask
         for, and asking again on every scroll would be a loop. */
      exhausted = batch.length < PAGE || state.players.length >= state.total;
      stopWatching();
      stopWatching = watchPresence(
        state.players.map((p) => p.id).concat(state.waiting.map((p) => p.id)));
      render();
      /* A first page that does not fill the panel leaves nothing to scroll, so
         the next one has to be asked for rather than waited for. */
      if (!exhausted && scroller && scroller.scrollHeight <= scroller.clientHeight + 8) {
        loading = false;
        loadMore();
        return;
      }
    } catch {
      if (!state.players.length && !state.waiting.length) {
        state = { ...state, status: 'error' };
        render();
      }
      exhausted = true;          // stop hammering a server that is not answering
    }
    loading = false;
  }

  render();
  loadMore();

  return () => {
    if (scroller) scroller.removeEventListener('scroll', onScroll);
    stopWatching();
    stopPresence();
  };
}
