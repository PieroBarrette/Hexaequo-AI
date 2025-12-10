const SOUND_SPRITES = {
	tilePlacement: 'tile_placement.mp3',
	piecePlacement: 'piece_placement.mp3',
	capture: 'capture.mp3',
	move: 'move.mp3',
	gameEnd: 'game_end.mp3',
	buttonClick: 'button_click.mp3'
};

const EVENT_TO_SPRITE = {
	'tile-placement': 'tilePlacement',
	'piece-placement': 'piecePlacement',
	'move': 'move',
	'move-with-captures': 'move',
	'jump-sequence': 'move',
	'capture': 'capture'
};

const DEFAULT_BASE_PATH = './assets/sounds';

export class SoundManager {
	constructor(options = {}) {
		this.basePath = options.basePath ?? DEFAULT_BASE_PATH;
		this.uiEnabled = true;
		this.gameplayEnabled = true;
		this.volume = {
			ui: 0.35,
			gameplay: 0.65
		};
		this.buffers = new Map();
	}

	setUiEnabled(enabled) {
		this.uiEnabled = Boolean(enabled);
	}

	setGameplayEnabled(enabled) {
		this.gameplayEnabled = Boolean(enabled);
	}

	handleQueue(queueResult) {
		if (!this.gameplayEnabled || !queueResult) {
			return;
		}

		const events = Array.isArray(queueResult.events) ? queueResult.events : [];
		if (events.length > 0) {
			events.forEach((event, index) => {
				const spriteKey = EVENT_TO_SPRITE[event.type];
				if (!spriteKey) return;
				const delay = index > 0 ? index * 60 : 0;
				this.playSprite(spriteKey, { channel: 'gameplay', delay });
				if (event.type === 'move-with-captures') {
					const extraCaptures = event.captures?.length ?? 0;
					if (extraCaptures > 0) {
						this.playSprite('capture', { channel: 'gameplay', delay: delay + 120 });
					}
				}
			});
			return;
		}

		if (queueResult.diff) {
			this.playFromDiff(queueResult.diff);
		}
	}

	playFromDiff(diff) {
		if (!diff) return;
		if (Array.isArray(diff.tilePlacements) && diff.tilePlacements.length > 0) {
			this.playSprite('tilePlacement', { channel: 'gameplay' });
		}
		if (Array.isArray(diff.placements) && diff.placements.length > 0) {
			this.playSprite('piecePlacement', { channel: 'gameplay', delay: 50 });
		}
		if (diff.move || diff.loopMove) {
			this.playSprite('move', { channel: 'gameplay', delay: 80 });
		}
		if (Array.isArray(diff.captures) && diff.captures.length > 0) {
			this.playSprite('capture', { channel: 'gameplay', delay: 140 });
		}
	}

	playUiClick() {
		this.playSprite('buttonClick', { channel: 'ui' });
	}

	playGameEnd() {
		this.playSprite('gameEnd', { channel: 'gameplay' });
	}

	playSprite(spriteKey, options = {}) {
		const { channel = 'gameplay', delay = 0 } = options;
		if (channel === 'ui' && !this.uiEnabled) return;
		if (channel === 'gameplay' && !this.gameplayEnabled) return;

		const fileName = SOUND_SPRITES[spriteKey];
		if (!fileName) return;

		const play = () => {
			const template = this.loadBuffer(spriteKey, fileName);
			if (!template) return;
			const node = template.cloneNode(true);
			node.volume = this.volume[channel] ?? 0.5;
			node.play().catch(() => {});
		};

		if (delay > 0) {
			setTimeout(play, delay);
		} else {
			play();
		}
	}

	loadBuffer(spriteKey, fileName) {
		if (this.buffers.has(spriteKey)) {
			return this.buffers.get(spriteKey);
		}
		const audio = new Audio(`${this.basePath}/${fileName}`);
		audio.preload = 'auto';
		this.buffers.set(spriteKey, audio);
		return audio;
	}
}

export const soundManager = new SoundManager();
