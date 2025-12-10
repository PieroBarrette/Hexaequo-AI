import { subscribeToGameState } from '../../store/gameStore.js';
import { controllerActions } from '../gameController.js';

export function mountInlinePrompts(element) {
	if (!element) {
		return () => {};
	}

	const handleClick = (event) => {
		const target = event.target.closest('[data-inline-action]');
		if (!target || target.disabled) return;
		switch (target.dataset.inlineAction) {
			case 'place-disc':
				controllerActions.confirmPlacement('disc');
				break;
			case 'place-ring':
				controllerActions.confirmPlacement('ring');
				break;
			case 'cancel-placement':
				controllerActions.cancelPlacement();
				break;
			case 'end-multi-jump':
				controllerActions.endMultiJumpTurn();
				break;
			case 'cancel-multi-jump':
				controllerActions.cancelMultiJump();
				break;
			default:
				break;
		}
	};

	const unsubscribe = subscribeToGameState((state) => {
		renderInlinePrompts(element, state);
	});

	element.addEventListener('click', handleClick);

	return () => {
		unsubscribe?.();
		element.removeEventListener('click', handleClick);
	};
}

function renderInlinePrompts(element, state) {
	const metadata = state.metadata ?? {};
	const chips = [];

	if (metadata.placementPrompt) {
		chips.push(renderPlacementChip(metadata.placementPrompt));
	}

	if (metadata.multiJumping) {
		chips.push(renderMultiJumpChip(state, metadata));
	}

	if (chips.length === 0) {
		element.innerHTML = '';
		element.dataset.visible = 'false';
		return;
	}

	element.dataset.visible = 'true';
	element.innerHTML = `
		<div class="prompt-rail">
			${chips.join('')}
		</div>
	`;
}

function renderPlacementChip(prompt) {
	const tileLabel = formatCoordinate(prompt);
	const canDisc = Boolean(prompt.options?.disc);
	const canRing = Boolean(prompt.options?.ring);
	const playerLabel = capitalize(prompt.player ?? '');
	return `
		<article class="prompt-chip prompt-chip--placement" data-player="${prompt.player ?? ''}">
			<div class="prompt-chip__copy">
				<p class="prompt-chip__eyebrow">${playerLabel} placement</p>
				<p class="prompt-chip__title">Drop on ${tileLabel}</p>
			</div>
			<div class="prompt-chip__actions">
				<button type="button" class="prompt-symbol prompt-symbol--disc ${canDisc ? 'is-ready' : ''}" data-inline-action="place-disc" ${canDisc ? '' : 'disabled'} aria-label="Place disc">
					<span class="prompt-symbol__icon" aria-hidden="true"></span>
					<small>Disc</small>
				</button>
				<button type="button" class="prompt-symbol prompt-symbol--ring ${canRing ? 'is-ready' : ''}" data-inline-action="place-ring" ${canRing ? '' : 'disabled'} aria-label="Place ring">
					<span class="prompt-symbol__icon" aria-hidden="true"></span>
					<small>Ring</small>
				</button>
				<button type="button" class="prompt-symbol prompt-symbol--ghost" data-inline-action="cancel-placement" aria-label="Cancel placement">
					<span class="prompt-symbol__icon" aria-hidden="true">✕</span>
					<small>Cancel</small>
				</button>
			</div>
		</article>
	`;
}

function renderMultiJumpChip(state, metadata) {
	const captures = Math.max(0, (metadata.jumpPath?.length ?? 1) - 1);
	const captureLabel = captures === 0 ? 'First capture logged' : `${captures} capture${captures === 1 ? '' : 's'} logged`;
	const playerLabel = capitalize(state.activePlayer ?? 'player');
	return `
		<article class="prompt-chip prompt-chip--multi" data-player="${state.activePlayer ?? ''}">
			<div class="prompt-chip__copy">
				<p class="prompt-chip__eyebrow">${playerLabel} multi-jump</p>
				<p class="prompt-chip__title">${captureLabel}</p>
			</div>
			<div class="prompt-chip__actions">
				<button type="button" class="prompt-symbol prompt-symbol--confirm" data-inline-action="end-multi-jump" aria-label="Finish multi-jump">
					<span class="prompt-symbol__icon" aria-hidden="true">✔</span>
					<small>Finish</small>
				</button>
				<button type="button" class="prompt-symbol prompt-symbol--ghost" data-inline-action="cancel-multi-jump" aria-label="Cancel multi-jump">
					<span class="prompt-symbol__icon" aria-hidden="true">↺</span>
					<small>Reset</small>
				</button>
			</div>
		</article>
	`;
}

function formatCoordinate(prompt) {
	const q = typeof prompt.q === 'number' ? prompt.q : '?';
	const r = typeof prompt.r === 'number' ? prompt.r : '?';
	return `(${q}, ${r})`;
}

function capitalize(value) {
	if (!value || typeof value !== 'string') {
		return '';
	}
	return value.charAt(0).toUpperCase() + value.slice(1);
}
