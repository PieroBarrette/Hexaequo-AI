/**
 * moveList.js — Live move-list / notation panel (QW3)
 *
 * Renders the running list of moves beside the board and lets the player click
 * any move to jump to that position. It stays fully decoupled from game.js:
 *   - game.js pushes updates via window.GameMoveList.render(moveHistory, currentMoveIndex)
 *   - clicking a move calls window.goToHistoryIndex(index) (exposed by game.js)
 *
 * Notation is derived by diffing two serialized game states, so the same helper
 * (window.HexNotation.describeMove) can also be reused by the replay viewer.
 *
 * Serialized state shape (see game.js serializeGameState):
 *   { tiles:{ "q,r":"black|white" },
 *     pieces:{ "q,r":{type,color} },
 *     inventory:{ black:{tiles,discs,rings}, white:{...} },
 *     captured:{ black_discs, black_rings, white_discs, white_rings },
 *     activePlayer:"black|white" }
 */

(function () {
    'use strict';

    // ==================== i18n (self-contained, with fallback) ====================
    const STR = {
        en: { title: 'Moves', empty: 'No moves yet', collapse: 'Hide moves', open: 'Show moves' },
        fr: { title: 'Coups', empty: 'Aucun coup', collapse: 'Masquer les coups', open: 'Afficher les coups' }
    };

    function lang() {
        try {
            const l = (window.i18n && (window.i18n.getLanguage?.() || window.i18n.language || window.i18n.lang))
                || document.documentElement.lang || 'en';
            return String(l).toLowerCase().startsWith('fr') ? 'fr' : 'en';
        } catch (e) {
            return 'en';
        }
    }

    function t(key) {
        const l = lang();
        return (STR[l] && STR[l][key]) || STR.en[key] || key;
    }

    // ==================== Notation ====================
    const GLYPH = { tile: '⬢' /* ⬢ */, disc: '●' /* ● */, ring: '◎' /* ◎ */ };

    function fmt(key) {
        return '(' + key + ')';
    }

    /**
     * Describe the move that transformed `prev` into `curr`.
     * @returns {{ text:string, mover:('black'|'white') }}
     */
    function describeMove(prev, curr) {
        if (!prev || !curr) {
            return { text: '', mover: (curr && curr.activePlayer === 'white') ? 'black' : 'white' };
        }
        const mover = prev.activePlayer; // the side that moved to produce `curr`

        // Tile placement?
        const newTileKey = Object.keys(curr.tiles).find(k => !(k in prev.tiles));

        // Piece additions / removals
        const added = Object.keys(curr.pieces).filter(k => !(k in prev.pieces));
        const removed = Object.keys(prev.pieces).filter(k => !(k in curr.pieces));

        // Capture delta for the mover (captured.<mover>_discs / _rings count what the mover took)
        let capturedDelta = 0;
        if (mover === 'black') {
            capturedDelta = (curr.captured.black_discs - prev.captured.black_discs)
                + (curr.captured.black_rings - prev.captured.black_rings);
        } else {
            capturedDelta = (curr.captured.white_discs - prev.captured.white_discs)
                + (curr.captured.white_rings - prev.captured.white_rings);
        }

        let text;
        if (newTileKey) {
            text = GLYPH.tile + ' ' + fmt(newTileKey);
        } else {
            const moverAdded = added.find(k => curr.pieces[k] && curr.pieces[k].color === mover);
            const moverRemoved = removed.find(k => prev.pieces[k] && prev.pieces[k].color === mover);
            if (moverAdded && moverRemoved) {
                const type = curr.pieces[moverAdded].type;
                text = (GLYPH[type] || GLYPH.disc) + ' ' + fmt(moverRemoved) + '→' + fmt(moverAdded);
            } else if (moverAdded) {
                const type = curr.pieces[moverAdded].type;
                text = (GLYPH[type] || GLYPH.disc) + '+ ' + fmt(moverAdded);
            } else {
                text = '…'; // … (could not characterize, e.g. mid multi-jump)
            }
        }

        if (capturedDelta > 0) {
            text += capturedDelta > 1 ? ' ✕' + capturedDelta : ' ✕';
        }
        return { text, mover };
    }

    // ==================== DOM ====================
    let panelEl = null;
    let listEl = null;
    let countEl = null;
    let toggleEl = null;
    let built = false;

    function escapeHtml(s) {
        return String(s).replace(/[&<>"']/g, c => (
            { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
        ));
    }

    function build() {
        if (built) return;

        panelEl = document.createElement('aside');
        panelEl.id = 'moveListPanel';
        panelEl.className = 'move-list-panel';
        panelEl.setAttribute('aria-label', t('title'));
        panelEl.innerHTML =
            '<div class="move-list-header">' +
                '<span class="move-list-title">' + escapeHtml(t('title')) + '</span>' +
                '<span class="move-list-count" id="moveListCount"></span>' +
                '<button class="move-list-collapse" id="moveListCollapse" type="button" aria-label="' + escapeHtml(t('collapse')) + '">›</button>' +
            '</div>' +
            '<div class="move-list-body" id="moveListBody"></div>';
        document.body.appendChild(panelEl);

        toggleEl = document.createElement('button');
        toggleEl.id = 'moveListToggle';
        toggleEl.className = 'move-list-toggle';
        toggleEl.type = 'button';
        toggleEl.setAttribute('aria-label', t('open'));
        toggleEl.innerHTML =
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
            '<line x1="8" y1="6" x2="20" y2="6"></line><line x1="8" y1="12" x2="20" y2="12"></line>' +
            '<line x1="8" y1="18" x2="20" y2="18"></line><circle cx="4" cy="6" r="1"></circle>' +
            '<circle cx="4" cy="12" r="1"></circle><circle cx="4" cy="18" r="1"></circle></svg>';
        document.body.appendChild(toggleEl);

        listEl = panelEl.querySelector('#moveListBody');
        countEl = panelEl.querySelector('#moveListCount');

        toggleEl.addEventListener('click', () => setOpen(!panelEl.classList.contains('open')));
        panelEl.querySelector('#moveListCollapse').addEventListener('click', () => setOpen(false));

        // Click delegation: jump to a move
        listEl.addEventListener('click', (e) => {
            const cell = e.target.closest('.ml-cell');
            if (!cell || cell.classList.contains('ml-empty')) return;
            const idx = parseInt(cell.getAttribute('data-idx'), 10);
            if (!Number.isNaN(idx) && typeof window.goToHistoryIndex === 'function') {
                window.goToHistoryIndex(idx);
            }
        });

        built = true;
    }

    // ==================== Visibility ====================
    function isInGame() {
        const lobby = document.getElementById('lobbyOverlay');
        if (!lobby) return false;
        if (lobby.classList.contains('hidden')) return true;
        const cs = window.getComputedStyle(lobby);
        return cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0;
    }

    function show() {
        build();
        panelEl.classList.add('visible');
        toggleEl.classList.add('visible');
    }

    function hide() {
        if (!built) return;
        panelEl.classList.remove('visible', 'open');
        toggleEl.classList.remove('visible');
    }

    function setOpen(open) {
        if (!built) return;
        panelEl.classList.toggle('open', !!open);
    }

    // ==================== Render ====================
    function render(history, currentIndex) {
        build();

        if (!isInGame() || !Array.isArray(history) || history.length === 0) {
            hide();
            return;
        }
        show();

        const totalPlies = history.length - 1; // history[0] is the initial position
        let html = '';

        for (let p = 0; p < Math.ceil(totalPlies / 2); p++) {
            const bIdx = 2 * p + 1;
            const wIdx = 2 * p + 2;
            const bCell = cellHtml(history, bIdx, currentIndex);
            const wCell = wIdx <= totalPlies
                ? cellHtml(history, wIdx, currentIndex)
                : '<span class="ml-cell ml-empty"></span>';
            html += '<div class="ml-row"><span class="ml-num">' + (p + 1) + '</span>' + bCell + wCell + '</div>';
        }

        listEl.innerHTML = html || '<div class="ml-empty-state">' + escapeHtml(t('empty')) + '</div>';
        countEl.textContent = totalPlies > 0 ? String(totalPlies) : '';

        // Keep the active move in view
        const active = listEl.querySelector('.ml-cell.active');
        if (active && active.scrollIntoView) active.scrollIntoView({ block: 'nearest' });
    }

    function cellHtml(history, idx, currentIndex) {
        const prev = history[idx - 1] && history[idx - 1].gameState;
        const curr = history[idx] && history[idx].gameState;
        if (!curr) return '<span class="ml-cell ml-empty"></span>';
        const desc = describeMove(prev, curr);
        const activeCls = idx === currentIndex ? ' active' : '';
        const moverCls = desc.mover === 'black' ? ' ml-black' : ' ml-white';
        return '<button type="button" class="ml-cell' + activeCls + moverCls + '" data-idx="' + idx + '">' +
            '<span class="ml-text">' + escapeHtml(desc.text) + '</span></button>';
    }

    // ==================== Exports ====================
    window.HexNotation = { describeMove };
    window.GameMoveList = { render, show, hide, setOpen };
})();
