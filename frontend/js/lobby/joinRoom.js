import { setAppState, subscribeToAppState, updatePlayerProfile } from '../store/appStore.js';

export function initJoinRoomForm({ socketClient, onHydrateGameState, onNavigateToGame } = {}) {
	const form = document.querySelector('[data-join-room-form]');
	if (!form) {
		return () => {};
	}

	const codeInput = form.querySelector('[name="roomCode"]');
	const pseudoInput = form.querySelector('[name="joinPseudo"]');
	const statusEl = form.querySelector('[data-join-room-status]');
	const joinButton = form.querySelector('[data-join-room-submit]');

	const syncFromState = (state) => {
		if (pseudoInput && !pseudoInput.matches(':focus')) {
			pseudoInput.value = state.lobby?.pseudo ?? '';
		}
	};
	const unsubscribe = subscribeToAppState(syncFromState, { emitInitial: true });

	const handlePrefill = (event) => {
		const roomCode = event.detail?.roomCode;
		if (!roomCode || !codeInput) return;
		codeInput.value = roomCode;
		codeInput.focus();
	};
	document.addEventListener('lobby:prefill-room', handlePrefill);

	const submitHandler = async (event) => {
		event.preventDefault();
		const code = codeInput?.value?.trim()?.toUpperCase();
		const pseudo = pseudoInput?.value?.trim() || 'Guest Hexer';
		if (!code || code.length !== 4) {
			statusEl.textContent = 'Enter a 4-letter room code.';
			return;
		}
		statusEl.textContent = `Joining ${code}…`;
		joinButton?.setAttribute('disabled', 'true');
		try {
			await socketClient.ensureConnected();
			const response = await socketClient.joinRoom(code, { pseudo });
			onHydrateGameState?.(response.gameState);
			updatePlayerProfile(response.color, { pseudo });
			setAppState((state) => ({
				matchSettings: {
					...state.matchSettings,
					timerMode: state.matchSettings?.timerMode ?? 'none'
				}
			}));
			setAppState({
				roomCode: response.roomCode,
				playerColor: response.color,
				view: 'game',
				lastError: null
			});
			statusEl.textContent = `Joined room ${response.roomCode}.`;
			onNavigateToGame?.('game');
		} catch (err) {
			console.error('Join room failed', err);
			statusEl.textContent = err.message || 'Unable to join room.';
			setAppState({ lastError: err.message });
		} finally {
			joinButton?.removeAttribute('disabled');
		}
	};

	form.addEventListener('submit', submitHandler);

	return () => {
		unsubscribe?.();
		form.removeEventListener('submit', submitHandler);
		document.removeEventListener('lobby:prefill-room', handlePrefill);
	};
}
