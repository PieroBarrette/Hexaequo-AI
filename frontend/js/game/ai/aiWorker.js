// aiWorker.js
// Web Worker for running AI computations in background thread
// Prevents UI blocking during AI calculations

importScripts('../ai/aiEngine.js');

self.addEventListener('message', function (e) {
	const { type, gameState, difficulty } = e.data;

	if (type === 'computeMove') {
		try {
			// Import is already done at top, use the exposed function
			// Note: In a real worker, we'd need to handle the module differently
			// For now, this structure matches hexaequo-v2 pattern
			
			const startTime = performance.now();
			
			// The aiEngine should expose computeBestMove globally when imported via importScripts
			const updatedState = self.computeBestMove(gameState, difficulty);
			
			const elapsed = performance.now() - startTime;

			self.postMessage({
				type: 'moveComputed',
				updatedState: updatedState,
				computeTime: elapsed
			});
		} catch (error) {
			self.postMessage({
				type: 'error',
				error: error.message,
				stack: error.stack
			});
		}
	} else if (type === 'ping') {
		self.postMessage({ type: 'pong' });
	}
});
