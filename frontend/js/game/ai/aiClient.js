// aiClient.js
// Client interface for AI computations (with Web Worker support)

/**
 * AI difficulty levels
 */
export const AI_DIFFICULTY = {
	EASY: 2,
	MEDIUM: 3,
	HARD: 4
};

/**
 * Create an AI client that can compute moves
 * @param {Object} options - Configuration options
 * @param {boolean} options.useWorker - Whether to use Web Worker (default: true)
 * @param {string} options.workerPath - Path to worker file (default: '/frontend/js/game/ai/aiWorkerStandalone.js')
 * @returns {Object} AI client interface
 */
export function createAIClient(options = {}) {
	const useWorker = options.useWorker !== false;
	const workerPath = options.workerPath || '/frontend/js/game/ai/aiWorkerStandalone.js';
	
	let worker = null;
	let isComputing = false;
	let computePromise = null;

	// Initialize worker if requested
	if (useWorker && typeof Worker !== 'undefined') {
		try {
			worker = new Worker(workerPath);
			console.log('[AI Client] Web Worker initialized');
		} catch (error) {
			console.warn('[AI Client] Failed to create worker, falling back to main thread:', error);
			worker = null;
		}
	}

	/**
	 * Compute best move for AI
	 * @param {Object} gameState - Current game state
	 * @param {number} difficulty - AI difficulty level (2-4)
	 * @returns {Promise<Object>} Updated game state with AI's move
	 */
	async function computeMove(gameState, difficulty = AI_DIFFICULTY.MEDIUM) {
		if (isComputing) {
			console.warn('[AI Client] Already computing a move');
			return computePromise;
		}

		isComputing = true;

		if (worker) {
			// Use Web Worker
			computePromise = new Promise((resolve, reject) => {
				const timeout = setTimeout(() => {
					reject(new Error('AI computation timeout (30s)'));
				}, 30000);

				const handleMessage = (e) => {
					clearTimeout(timeout);
					worker.removeEventListener('message', handleMessage);
					isComputing = false;

					if (e.data.type === 'moveComputed') {
						console.log(`[AI Client] Move computed in ${e.data.computeTime?.toFixed(0) || '?'}ms`);
						resolve(e.data.updatedState);
					} else if (e.data.type === 'error') {
						reject(new Error(e.data.error));
					}
				};

				worker.addEventListener('message', handleMessage);
				worker.postMessage({
					type: 'computeMove',
					gameState,
					difficulty
				});
			});
		} else {
			// Fallback to main thread (import aiEngine dynamically)
			computePromise = import('./aiEngine.js').then(({ computeBestMove }) => {
				const start = performance.now();
				const result = computeBestMove(gameState, difficulty);
				const elapsed = performance.now() - start;
				console.log(`[AI Client] Move computed (main thread) in ${elapsed.toFixed(0)}ms`);
				isComputing = false;
				return result;
			}).catch(error => {
				isComputing = false;
				throw error;
			});
		}

		return computePromise;
	}

	/**
	 * Terminate the worker (cleanup)
	 */
	function dispose() {
		if (worker) {
			worker.terminate();
			worker = null;
			console.log('[AI Client] Worker terminated');
		}
	}

	/**
	 * Check if AI is currently computing
	 */
	function isActive() {
		return isComputing;
	}

	return {
		computeMove,
		dispose,
		isActive,
		usingWorker: !!worker
	};
}

/**
 * Singleton AI client instance (lazy loaded)
 */
let globalAIClient = null;

/**
 * Get or create the global AI client
 */
export function getAIClient(options) {
	if (!globalAIClient) {
		globalAIClient = createAIClient(options);
	}
	return globalAIClient;
}

/**
 * Dispose the global AI client
 */
export function disposeGlobalAIClient() {
	if (globalAIClient) {
		globalAIClient.dispose();
		globalAIClient = null;
	}
}
