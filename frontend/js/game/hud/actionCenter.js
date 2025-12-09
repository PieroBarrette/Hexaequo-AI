import { subscribeToGameState } from '../../store/gameStore.js';
import { controllerActions } from '../gameController.js';

export function mountActionCenter(element) {
	if (!element) {
		return () => {};
	}

	const handleClick = (event) => {
		const target = event.target.closest('[data-hud-action]');
		if (!target) return;
		const action = target.dataset.hudAction;
		switch (action) {
			case 'end-multi-jump':
				controllerActions.endMultiJumpTurn();
				break;
			case 'cancel-multi-jump':
				controllerActions.cancelMultiJump();
				break;
			case 'place-disc':
				controllerActions.confirmPlacement('disc');
				break;
			case 'place-ring':
				controllerActions.confirmPlacement('ring');
				break;
			case 'cancel-placement':
				controllerActions.cancelPlacement();
				break;
			default:
				break;
		}
	};

	const unsubscribe = subscribeToGameState((state) => {
		renderActionCenter(element, state);
	});

	element.addEventListener('click', handleClick);

	return () => {
		unsubscribe?.();
		element.removeEventListener('click', handleClick);
	};
}

function renderActionCenter(element, state) {
	const metadata = state.metadata ?? {};
	const sections = [];

	if (metadata.multiJumping) {
		sections.push(renderMultiJumpSection(state, metadata));
	}

	if (metadata.placementPrompt) {
		sections.push(renderPlacementSection(metadata.placementPrompt));
	}

	if (sections.length === 0) {
		element.innerHTML = `
			<span class="hud-label">Contextual Actions</span>
			<p class="hud-muted">No pending actions</p>
		`;
		return;
	}

	element.innerHTML = `
		<span class="hud-label">Contextual Actions</span>
		${sections.join('')}
	`;
}

function renderMultiJumpSection(state, metadata) {
	const captures = Math.max(0, (metadata.jumpPath?.length ?? 1) - 1);
	const captureLabel = captures > 0 ? `${captures} capture${captures === 1 ? '' : 's'}` : 'First capture';
	const playerLabel = capitalize(state.activePlayer ?? 'unknown');

	return `
		<div class="hud-action-group" data-section="multi-jump">
			<div class="hud-action-headline">${playerLabel} multi-jump</div>
			<p class="hud-action-subtext">${captureLabel} logged</p>
			<div class="hud-action-buttons">
				<button class="hud-action-btn primary" data-hud-action="end-multi-jump">End Turn</button>
				<button class="hud-action-btn ghost" data-hud-action="cancel-multi-jump">Cancel Sequence</button>
			</div>
		</div>
	`;
}

function renderPlacementSection(prompt) {
	const tileLabel = `(${prompt.q}, ${prompt.r})`;
	const canPlaceDisc = Boolean(prompt.options?.disc);
	const canPlaceRing = Boolean(prompt.options?.ring);

	return `
		<div class="hud-action-group" data-section="placement">
			<div class="hud-action-headline">Choose piece for tile ${tileLabel}</div>
			<p class="hud-action-subtext">${capitalize(prompt.player)} can drop a disc or ring</p>
			<div class="hud-action-buttons">
				<button class="hud-action-btn primary" data-hud-action="place-disc" ${canPlaceDisc ? '' : 'disabled'}>Place Disc</button>
				<button class="hud-action-btn" data-hud-action="place-ring" ${canPlaceRing ? '' : 'disabled'}>Place Ring</button>
				<button class="hud-action-btn ghost" data-hud-action="cancel-placement">Cancel</button>
			</div>
		</div>
	`;
}

function capitalize(value) {
	if (!value || typeof value !== 'string') {
		return '';
	}
	return value.charAt(0).toUpperCase() + value.slice(1);
}
