const MOCK_ROOMS = [
	{ code: 'ASTR', host: 'Aria', mode: 'classic', allowSpectators: true, players: 2, rating: 'Unrated' },
	{ code: 'BOLT', host: 'Rex', mode: 'blitz', allowSpectators: false, players: 1, rating: '1500+' },
	{ code: 'CALM', host: 'Noor', mode: 'rapid', allowSpectators: true, players: 2, rating: 'Open' },
	{ code: 'DUEL', host: 'Sia', mode: 'none', allowSpectators: true, players: 1, rating: 'Friends' }
];

export async function fetchRooms(filters = {}) {
	await delay(200);
	const normalized = normalizeFilters(filters);
	return MOCK_ROOMS.filter((room) => {
		const matchesMode = normalized.timeMode === 'any' || room.mode === normalized.timeMode;
		const matchesSpectators = normalized.allowSpectators === 'any'
			? true
			: room.allowSpectators === (normalized.allowSpectators === 'yes');
		return matchesMode && matchesSpectators;
	}).map((room) => ({
		...room,
		timestamp: Date.now()
	}));
}

export async function fetchRoomSummary(roomCode) {
	const trimmed = roomCode?.trim();
	if (!trimmed) return null;
	const baseUrl = deriveServerUrl();
	try {
		const response = await fetch(`${baseUrl}/room/${trimmed.toUpperCase()}`);
		if (!response.ok) {
			throw new Error('Room not found');
		}
		return await response.json();
	} catch (err) {
		console.warn('Room summary lookup failed', err);
		return null;
	}
}

function normalizeFilters(filters) {
	const mode = typeof filters.timeMode === 'string' ? filters.timeMode.toLowerCase() : 'any';
	const spectator = typeof filters.allowSpectators === 'string' ? filters.allowSpectators.toLowerCase() : 'any';
	const validModes = new Set(['any', 'none', 'classic', 'rapid', 'blitz']);
	const normalizedMode = validModes.has(mode) ? mode : 'any';
	const normalizedSpectator = spectator === 'yes' || spectator === 'no' ? spectator : 'any';
	return { timeMode: normalizedMode, allowSpectators: normalizedSpectator };
}

function deriveServerUrl() {
	if (typeof window === 'undefined') {
		return 'https://hexaequo-server.onrender.com';
	}
	return window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
		? 'http://localhost:3000'
		: 'https://hexaequo-server.onrender.com';
}

function delay(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
