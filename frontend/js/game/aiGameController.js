// AI game controller - manages AI opponent moves
import { getGameState, subscribeToGameState } from '../store/gameStore.js';
import { getAppState, setAppState } from '../store/appStore.js';
import { createAIClient, AI_DIFFICULTY } from './ai/aiClient.js';
import { serializeState } from '../../../shared/game/gameState.js';

let aiClient = null;
let unsubscribe = null;
let isProcessingMove = false;

/**
 * Initialize AI game controller
 * Watches game state and triggers AI moves when appropriate
 */
export function initAIGameController() {
	if (!aiClient) {
		aiClient = createAIClient({
			useWorker: true,
			workerPath: '/frontend/js/game/ai/aiWorkerStandalone.js'
		});
		console.log('[AI Game Controller] Initialized');
	}

	if (unsubscribe) {
		console.warn('[AI Game Controller] Already initialized');
		return () => {};
	}

	unsubscribe = subscribeToGameState((gameState) => {
		handleGameStateChange(gameState);
	});

	return () => {
		if (unsubscribe) {
			unsubscribe();
			unsubscribe = null;
		}
	};
}

/**
 * Check if AI should make a move and trigger it
 */
async function handleGameStateChange(gameState) {
	const appState = getAppState();
	
	// Only process if in AI mode
	if (appState.gameMode !== 'ai') {
		return;
	}

	// Don't process if already computing or animations running
	if (isProcessingMove || appState.aiThinking) {
		return;
	}

	// Check if it's AI's turn (white)
	if (gameState.activePlayer !== 'white') {
		return;
	}

	// Check if game is over
	if (gameState.metadata?.gameOver) {
		return;
	}

	// Trigger AI move
	await computeAndApplyAIMove(gameState, appState.aiDifficulty);
}

/**
 * Compute AI move and apply it to game state
 */
async function computeAndApplyAIMove(gameState, difficulty) {
	isProcessingMove = true;
	setAppState({ aiThinking: true });

	try {
		// Serialize game state for AI
		const serializedState = serializeState(gameState);
		
		console.log('[AI Game Controller] Computing move at difficulty', difficulty);
		const startTime = performance.now();

		// Compute AI move
		const updatedState = await aiClient.computeMove(serializedState, difficulty);
		
		const elapsed = performance.now() - startTime;
		console.log(`[AI Game Controller] Move computed in ${elapsed.toFixed(0)}ms`);

		// Add a small delay for better UX (so user sees "thinking" indicator)
		const minThinkTime = 300;
		if (elapsed < minThinkTime) {
			await new Promise(resolve => setTimeout(resolve, minThinkTime - elapsed));
		}

		// Import and apply state update
		const { applySerializedState } = await import('../store/gameStore.js');
		applySerializedState(updatedState);

	} catch (error) {
		console.error('[AI Game Controller] Error computing move:', error);
		setAppState({ 
			lastError: 'AI computation failed. Please try again.',
			gameMode: 'local' // Fallback to local mode
		});
	} finally {
		isProcessingMove = false;
		setAppState({ aiThinking: false });
	}
}

/**
 * Terminate AI worker (cleanup)
 */
export function terminateAI() {
	if (aiClient && typeof aiClient.terminate === 'function') {
		aiClient.terminate();
		aiClient = null;
	}
	if (unsubscribe) {
		unsubscribe();
		unsubscribe = null;
	}
	console.log('[AI Game Controller] Terminated');
}
