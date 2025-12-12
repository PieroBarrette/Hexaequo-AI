import { fetchRooms } from '../api/roomApi.js';

const REFRESH_INTERVAL_MS = 15000;

export function initRoomList({ onRoomSelect } = {}) {
	const listEl = document.querySelector('[data-room-list]');
	const emptyEl = document.querySelector('[data-room-empty]');
	if (!listEl) {
		return { dispose() {} };
	}

	let filters = { timeMode: 'any', allowSpectators: 'any', sortOrder: 'recent' };
	let isDisposed = false;
	let refreshTimer = null;

	const loadRooms = async () => {
		try {
			const rooms = await fetchRooms({ timeMode: filters.timeMode, allowSpectators: filters.allowSpectators });
			const sorted = sortRooms(rooms, filters.sortOrder);
			renderRoomList(listEl, emptyEl, sorted, onRoomSelect);
		} catch (err) {
			console.error('Failed to load rooms', err);
			if (emptyEl) {
				emptyEl.textContent = 'Unable to load lobby data right now.';
				emptyEl.hidden = false;
			}
		}
	};

	const scheduleRefresh = () => {
		if (refreshTimer) {
			clearInterval(refreshTimer);
		}
		refreshTimer = setInterval(loadRooms, REFRESH_INTERVAL_MS);
	};

	loadRooms();
	scheduleRefresh();

	return {
		dispose() {
			isDisposed = true;
			if (refreshTimer) {
				clearInterval(refreshTimer);
			}
		},
		setFilters(nextFilters = {}) {
			if (isDisposed) return;
			filters = { ...filters, ...nextFilters };
			loadRooms();
		}
	};
}

function renderRoomList(target, emptyEl, rooms, onRoomSelect) {
	if (!target) return;
	if (!rooms || rooms.length === 0) {
		target.innerHTML = '';
		if (emptyEl) {
			emptyEl.hidden = false;
		}
		return;
	}
	emptyEl && (emptyEl.hidden = true);
	target.innerHTML = rooms
		.map((room) => createRoomRow(room))
		.join('');
	target.querySelectorAll('[data-room-code]').forEach((button) => {
		button.addEventListener('click', () => {
			const code = button.getAttribute('data-room-code');
			document.dispatchEvent(
				new CustomEvent('lobby:prefill-room', {
					detail: { roomCode: code }
				})
			);
			onRoomSelect?.(code);
		});
	});
}

function sortRooms(rooms = [], order = 'recent') {
	const list = [...rooms];
	switch (order) {
		case 'players':
			return list.sort((a, b) => (b.players ?? 0) - (a.players ?? 0));
		case 'az':
			return list.sort((a, b) => (a.host || '').localeCompare(b.host || ''));
		case 'recent':
		default:
			return list.sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));
	}
}

function createRoomRow(room) {
	const spectatorLabel = room.allowSpectators ? 'Spectators welcome' : 'Spectators off';
	const spectatorClass = room.allowSpectators ? 'room-card__tag' : 'room-card__tag room-card__tag--muted';
	return `
		<article class="room-card">
			<header class="room-card__header">
				<div>
					<p class="room-card__eyebrow">${room.rating}</p>
					<h3>${room.host}'s table</h3>
				</div>
				<button type="button" class="room-card__join" data-room-code="${room.code}">Join</button>
			</header>
			<div class="room-card__meta">
				<span class="room-card__code">Code ${room.code}</span>
				<span class="room-card__mode">${formatMode(room.mode)}</span>
				<span class="${spectatorClass}">${spectatorLabel}</span>
			</div>
			<p class="room-card__foot">${room.players} player${room.players === 1 ? '' : 's'} inside</p>
		</article>
	`;
}

function formatMode(mode) {
	switch (mode) {
		case 'classic':
			return 'Classic 15 | 0';
		case 'rapid':
			return 'Rapid 10 | 5';
		case 'blitz':
			return 'Blitz 5 | 3';
		case 'none':
		default:
			return 'No timer';
	}
}
