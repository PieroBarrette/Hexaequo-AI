// ai-worker.js
// Web Worker for running AI computations in the background

// Import the AI logic
importScripts('ai.js');

// Listen for messages from the main thread
self.addEventListener('message', function (e) {
    const { type, gameState, difficulty } = e.data;

    if (type === 'computeMove') {
        try {
            // Process the game state and compute the best move
            const updatedState = processGameState(gameState, difficulty);

            // Send the result back to the main thread
            self.postMessage({
                type: 'moveComputed',
                updatedState: updatedState
            });
        } catch (error) {
            // Send error back to main thread
            self.postMessage({
                type: 'error',
                error: error.message
            });
        }
    }
});

