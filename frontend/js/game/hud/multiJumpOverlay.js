import { subscribeToGameState } from '../../store/gameStore.js';
import { controllerActions } from '../gameController.js';

export function mountMultiJumpOverlay(element) {
	if (!element) {
		return () => {};
	}

	const handleClick = (event) => {
		const target = event.target.closest('[data-multi-jump-action]');
		if (!target) return;
		const action = target.dataset.multiJumpAction;
		if (action === 'end-turn') {
			controllerActions.endMultiJumpTurn();
		} else if (action === 'cancel') {
			controllerActions.cancelMultiJump();
		}
	};

	const unsubscribe = subscribeToGameState((state) => {
		const metadata = state.metadata ?? {};
		if (!metadata.multiJumping) {
			element.hidden = true;
			element.innerHTML = '';
			return;
		}
		element.hidden = false;
		element.innerHTML = `
			<div class="multi-jump-chip">
				<span>Continue multi-jump?</span>
				<div class="multi-jump-actions">
					<button class="multi-jump-btn confirm" data-multi-jump-action="end-turn" aria-label="End turn">
						✔
					</button>
					<button class="multi-jump-btn ghost" data-multi-jump-action="cancel" aria-label="Cancel sequence">✕</button>
				</div>
			</div>
		`;
	});

	element.addEventListener('click', handleClick);

	return () => {
		unsubscribe?.();
		element.removeEventListener('click', handleClick);
	};
}
