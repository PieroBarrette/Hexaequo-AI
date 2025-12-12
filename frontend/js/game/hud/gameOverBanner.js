import { subscribeToGameState } from '../../store/gameStore.js';
import { setAppState } from '../../store/appStore.js';

export function mountGameOverBanner(element) {
	if (!element) {
		return () => {};
	}

	const unsubscribe = subscribeToGameState((state) => {
		const details = state.metadata?.gameOver ?? null;
		if (!details) {
			element.hidden = true;
			element.innerHTML = '';
			element.closest('.canvas-shell')?.setAttribute('data-game-frozen', 'false');
			setGameFrozen(false);
			return;
		}
		element.closest('.canvas-shell')?.setAttribute('data-game-frozen', 'true');
		setGameFrozen(true);
		const winnerLabel = details.winner === 'ex-aequo'
			? 'Ex Aequo'
			: `${capitalize(details.winner)} wins`;
		const reasonLabel = details.reason ? `by ${details.reason}` : '';
		element.hidden = false;
		element.innerHTML = `
			<div class="game-over-banner__card">
				<p class="game-over-banner__eyebrow">Match over</p>
				<h2 class="game-over-banner__title">${winnerLabel}</h2>
				<p class="game-over-banner__reason">${reasonLabel}</p>
			</div>
		`;
	});
	return () => {
		unsubscribe?.();
	};
}

function capitalize(value) {
	if (!value) return '';
	return value.charAt(0).toUpperCase() + value.slice(1);
}

function setGameFrozen(frozen) {
	setAppState({ gameFrozen: frozen });
}
