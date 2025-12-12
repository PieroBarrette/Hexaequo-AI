/**
 * AI Client - Interface for AI computation
 * 
 * Uses Web Workers for non-blocking AI computation.
 */

/**
 * AI Client Class
 */
export class AIClient {
    constructor() {
        this.worker = null;
        this.pendingRequest = null;
        this.timeout = 30000; // 30 second timeout
    }

    /**
     * Initialize Web Worker
     */
    initWorker() {
        if (this.worker) return;

        try {
            this.worker = new Worker(new URL('./aiWorker.js', import.meta.url), {
                type: 'module'
            });

            this.worker.onmessage = (event) => {
                if (this.pendingRequest) {
                    const { resolve, timeoutId } = this.pendingRequest;
                    clearTimeout(timeoutId);
                    this.pendingRequest = null;

                    if (event.data.type === 'moveComputed') {
                        resolve({
                            gameState: event.data.updatedState,
                            computeTime: event.data.computeTime
                        });
                    } else if (event.data.type === 'error') {
                        resolve({ error: event.data.error });
                    }
                }
            };

            this.worker.onerror = (error) => {
                console.error('AI Worker error:', error);
                if (this.pendingRequest) {
                    const { reject, timeoutId } = this.pendingRequest;
                    clearTimeout(timeoutId);
                    this.pendingRequest = null;
                    reject(error);
                }
            };
        } catch (error) {
            console.warn('Web Worker not available, falling back to main thread');
            this.worker = null;
        }
    }

    /**
     * Compute AI move
     * @param {Object} gameState - Current game state
     * @param {number} difficulty - AI difficulty (2-4)
     * @returns {Promise<{gameState: Object, computeTime: number}>}
     */
    async computeMove(gameState, difficulty = 3) {
        // Try using Web Worker
        if (this.worker || typeof Worker !== 'undefined') {
            this.initWorker();

            if (this.worker) {
                return this.computeWithWorker(gameState, difficulty);
            }
        }

        // Fallback to main thread
        return this.computeOnMainThread(gameState, difficulty);
    }

    /**
     * Compute move using Web Worker
     */
    computeWithWorker(gameState, difficulty) {
        return new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                this.pendingRequest = null;
                this.terminateWorker();
                reject(new Error('AI computation timed out'));
            }, this.timeout);

            this.pendingRequest = { resolve, reject, timeoutId };

            this.worker.postMessage({
                type: 'computeMove',
                gameState,
                difficulty
            });
        });
    }

    /**
     * Compute move on main thread (fallback)
     */
    async computeOnMainThread(gameState, difficulty) {
        const startTime = performance.now();

        // Import AI module dynamically
        const { processGameState } = await import('./aiEngine.js');
        const updatedState = processGameState(gameState, difficulty);

        return {
            gameState: updatedState,
            computeTime: performance.now() - startTime
        };
    }

    /**
     * Terminate the worker
     */
    terminateWorker() {
        if (this.worker) {
            this.worker.terminate();
            this.worker = null;
        }
    }

    /**
     * Cleanup
     */
    destroy() {
        this.terminateWorker();
        this.pendingRequest = null;
    }
}

export default AIClient;
