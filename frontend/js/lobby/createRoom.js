import {
	getAppState,
	setAppState,
	subscribeToAppState,
	updateLobbyPreferences,
	updateMatchSettings,
	updatePlayerProfile
} from '../store/appStore.js';

const TIMER_MODES = {
	none: {
		label: 'No timer',
		description: 'Free-form session, timer hidden.'
	},
	classic: {
		label: 'Classic 15 | 0',
		description: '15-minute clocks, no increment.'
	},
	rapid: {
		label: 'Rapid 10 | 5',
		description: '10-minute clocks with 5s increment.'
	},
	blitz: {
		label: 'Blitz 5 | 3',
		description: '5-minute clocks with 3s increment.'
	}
};

export function initCreateRoomForm({ socketClient, onHydrateGameState, onNavigateToGame } = {}) {
	const form = document.querySelector('[data-create-room-form]');
	if (!form) {
		return () => {};
	}

	const pseudoInput = form.querySelector('[name="playerPseudo"]');
	const spectatorToggle = form.querySelector('[name="allowSpectators"]');
	const timerRadios = Array.from(form.querySelectorAll('input[name="timeMode"]'));
	const summaryEl = form.querySelector('[data-timer-summary]');
	const statusEl = form.querySelector('[data-create-room-status]');
	const spectatorLabel = form.querySelector('[data-spectator-label]');

	const handleStateSync = (state) => {
		if (pseudoInput && !pseudoInput.matches(':focus')) {
			pseudoInput.value = state.lobby?.pseudo ?? '';
		}
		if (spectatorToggle) {
			spectatorToggle.checked = state.lobby?.allowSpectators !== false;
		}
		const preferredMode = state.lobby?.timeMode ?? 'rapid';
		let matched = false;
		timerRadios.forEach((radio) => {
			const isMatch = radio.value === preferredMode;
			radio.checked = isMatch;
			matched = matched || isMatch;
		});
		if (!matched && timerRadios.length > 0) {
			timerRadios[0].checked = true;
		}
		renderSummary(summaryEl, getSelectedMode(timerRadios));
		renderSpectatorCopy(spectatorLabel, spectatorToggle?.checked ?? true);
	};

	const unsubscribe = subscribeToAppState(handleStateSync, { emitInitial: true });
	const timerChangeHandler = () => {
		const mode = getSelectedMode(timerRadios);
		renderSummary(summaryEl, mode);
	};
	timerRadios.forEach((radio) => radio.addEventListener('change', timerChangeHandler));
	spectatorToggle?.addEventListener('change', () => {
		renderSpectatorCopy(spectatorLabel, spectatorToggle.checked);
	});

	const submitHandler = async (event) => {
		event.preventDefault();
		const selectedMode = getSelectedMode(timerRadios);
		const pseudo = pseudoInput?.value?.trim() || 'Guest Hexer';
		const allowSpectators = spectatorToggle?.checked !== false;
		updateLobbyPreferences({ pseudo, timeMode: selectedMode, allowSpectators });
		statusEl.textContent = 'Creating room…';
		try {
			await socketClient.ensureConnected();
			const response = await socketClient.createRoom({
				pseudo,
				timeMode: selectedMode,
				allowSpectators
			});
			onHydrateGameState?.(response.gameState);
			updateMatchSettings({ timerMode: selectedMode, allowSpectators });
			updatePlayerProfile(response.color, { pseudo });
			setAppState({
				roomCode: response.roomCode,
				playerColor: response.color,
				view: 'game',
				lastError: null
			});
			statusEl.textContent = `Room ${response.roomCode} ready. Share the code.`;
			onNavigateToGame?.('game');
		} catch (err) {
			console.error('Create room failed', err);
			statusEl.textContent = err.message || 'Unable to create room.';
			setAppState({ lastError: err.message });
		}
	};

	form.addEventListener('submit', submitHandler);

	return () => {
		unsubscribe?.();
		form.removeEventListener('submit', submitHandler);
		timerRadios.forEach((radio) => radio.removeEventListener('change', timerChangeHandler));
	};
}

function getSelectedMode(radios) {
	const checked = radios.find((radio) => radio.checked);
	return checked ? checked.value : 'none';
}

function renderSummary(target, mode) {
	if (!target) return;
	const config = TIMER_MODES[mode] ?? TIMER_MODES.none;
	target.textContent = config.description;
}

function renderSpectatorCopy(target, isAllowed) {
	if (!target) return;
	target.textContent = isAllowed ? 'Spectators allowed' : 'Spectators blocked';
}
