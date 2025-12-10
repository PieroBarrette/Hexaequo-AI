import { initCreateRoomForm } from './createRoom.js';
import { initJoinRoomForm } from './joinRoom.js';
import { initRoomFilters } from './roomFilters.js';
import { initRoomList } from './roomList.js';
import { initSpectatorSummary } from './spectatorList.js';

export function initLobbyPanel({ socketClient, onHydrateGameState, onNavigateToGame } = {}) {
	const disposers = [];

	const roomList = initRoomList();
	disposers.push(() => roomList.dispose?.());

	disposers.push(
		initRoomFilters({
			onChange: (filters) => roomList.setFilters?.(filters)
		})
	);

	disposers.push(initSpectatorSummary());

	disposers.push(
		initCreateRoomForm({
			socketClient,
			onHydrateGameState,
			onNavigateToGame
		})
	);

	disposers.push(
		initJoinRoomForm({
			socketClient,
			onHydrateGameState,
			onNavigateToGame
		})
	);

	return () => {
		disposers.forEach((dispose) => dispose?.());
	};
}
