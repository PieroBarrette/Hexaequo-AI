import { subscribeToAppState } from '../store/appStore.js';

export function initSpectatorSummary() {
	const target = document.querySelector('[data-spectator-summary]');
	if (!target) {
		return () => {};
	}

	const unsubscribe = subscribeToAppState((state) => {
		const allowSpectators = state.lobby?.allowSpectators !== false;
		const timerMode = state.lobby?.timeMode ?? 'none';
		target.innerHTML = `
			<div class="spectator-pill${allowSpectators ? '' : ' is-muted'}">
				<span>${allowSpectators ? 'Spectators allowed' : 'Spectators blocked'}</span>
			</div>
			<p class="spectator-copy">${describeTimer(timerMode)}</p>
		`;
	});

	return () => unsubscribe?.();
}

function describeTimer(mode) {
	switch (mode) {
		case 'classic':
			return 'Classic clocks 15 | 0';
		case 'rapid':
			return 'Rapid clocks 10 | 5';
		case 'blitz':
			return 'Blitz clocks 5 | 3';
		default:
			return 'No timers selected yet';
	}
}
