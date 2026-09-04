/**
 * The world ranking: everybody who has signed up, strongest first.
 *
 * It used to be everybody who had finished a rated game, which made the table
 * a record of play rather than a list of members — defensible, and not what
 * somebody wants when they open it on the day they sign up looking for their
 * own name. A thousand is a real rating, the one every account begins at, so a
 * member who has not started sits where a member who has broken even sits, and
 * a tie goes to whoever got here first.
 *
 * A hundred at a time, and the next hundred when the reader reaches the bottom
 * of the last: the whole roll is one scroll rather than one request.
 */

import { t } from '../i18n.js';
import { api, currentUser } from '../auth.js';
import { watchPresence, onPresence, presenceOf } from '../presence.js';

const PAGE = 100;

export function mountLeaderboard(outlet) {
  let state = { status: 'loading', players: [], total: 0 };
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
    return state.players.map((p) => {
      /* Nought games is not a nought per cent win rate. A dash says the column
         has nothing to say about this member yet, where a number would say
         something false about them. */
      const played = Number(p.games_played) > 0;
      return `
        <tr class="${me && p.id === me.id ? 'is-me' : ''}">
          <td class="num rank">${p.rank}</td>
          <td class="player-cell"><span class="pip is-${presenceOf(p.id)}"
                    title="${t('presence.' + presenceOf(p.id))}"></span
              ><a class="player-link" href="#/profile?id=${escapeHtml(p.id)}"
                 >${escapeHtml(p.pseudo)}</a></td>
          <td class="num elo">${p.elo}</td>
          <td class="num">${played ? p.games_played : t('leaderboard.unplayed')}</td>
          <td class="num">${played ? `${p.win_rate}%` : t('leaderboard.unplayed')}</td>
        </tr>`;
    }).join('');
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
    if (!state.players.length) {
      outlet.innerHTML = `<div class="page"><div class="page-inner">
        <p class="lede">${t('leaderboard.empty')}</p></div></div>`;
      return;
    }

    /* Rebuilt whole on every presence change, which is why the scroll position
       is put back afterwards: a light turning green three names down should not
       throw the reader back to the top of the list. */
    const wasAt = scroller ? scroller.scrollTop : 0;
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
          <tbody>${rows()}</tbody>
        </table>
        ${exhausted ? '' : `<p class="lede">${t('leaderboard.more')}</p>`}
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
        total: body.total || state.players.length + batch.length,
      };
      /* Short of a full page, or we now hold everyone: there is no more to ask
         for, and asking again on every scroll would be a loop. */
      exhausted = batch.length < PAGE || state.players.length >= state.total;
      stopWatching();
      stopWatching = watchPresence(state.players.map((p) => p.id));
      render();
      /* A first page that does not fill the panel leaves nothing to scroll, so
         the next one has to be asked for rather than waited for. */
      if (!exhausted && scroller && scroller.scrollHeight <= scroller.clientHeight + 8) {
        loading = false;
        loadMore();
        return;
      }
    } catch {
      if (!state.players.length) { state = { ...state, status: 'error' }; render(); }
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
