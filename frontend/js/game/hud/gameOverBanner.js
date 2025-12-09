import { subscribeToGameState, resetGameState } from '../../store/gameStore.js';
import { createInitialState } from '../gameState.js';

export function mountGameOverBanner(element) {
	if (!element) {
		return () => {};
	}

	const handleClick = (event) => {
		const action = event.target.closest('[data-game-over-action]');
		if (!action) return;
		if (action.dataset.gameOverAction === 'reset') {
			resetGameState(createInitialState());
		}
	};

	const unsubscribe = subscribeToGameState((state) => {
		const details = state.metadata?.gameOver ?? null;
		if (!details) {
			element.hidden = true;
			element.innerHTML = '';
			return;
		}
		const winnerLabel = details.winner === 'ex-aequo'
			? 'Ex Aequo'
			: `${capitalize(details.winner)} wins`;
		const reasonLabel = details.reason ? `by ${details.reason}` : '';
		element.hidden = false;
		element.innerHTML = `
			<div class="game-over-card">
				<h2>${winnerLabel}</h2>
				<p>${reasonLabel}</p>
				<button data-game-over-action="reset">Reset Game</button>
			</div>
		`;
	});

	element.addEventListener('click', handleClick);

	return () => {
		unsubscribe?.();
		element.removeEventListener('click', handleClick);
	};
}

function capitalize(value) {
	if (!value) return '';
	return value.charAt(0).toUpperCase() + value.slice(1);
}
