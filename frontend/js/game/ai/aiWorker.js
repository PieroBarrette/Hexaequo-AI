/**
 * AI Worker - Web Worker for running AI computations in background
 * 
 * This runs in a separate thread to avoid blocking the UI during AI computation.
 */

// Import AI engine
import { processGameState } from './aiEngine.js';

// Listen for messages from main thread
self.addEventListener('message', async function(e) {
    const { type, gameState, difficulty } = e.data;
    
    if (type === 'computeMove') {
        const startTime = performance.now();
        
        try {
            // Convert game state to AI-compatible format
            const aiState = convertToAIFormat(gameState);
            
            // Process the game state and compute the best move
            const updatedAIState = processGameState(aiState, difficulty);
            
            // Convert back to app format
            const updatedState = convertFromAIFormat(updatedAIState, gameState);
            
            const computeTime = performance.now() - startTime;
            
            // Send the result back to the main thread
            self.postMessage({
                type: 'moveComputed',
                updatedState: updatedState,
                computeTime: computeTime
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

/**
 * Convert app game state to AI format
 * The AI uses a different structure with inventory/captured as objects
 */
function convertToAIFormat(state) {
    return {
        tiles: state.tiles,
        pieces: state.pieces,
        activePlayer: state.activePlayer,
        inventory: {
            black: {
                tiles: state.inventory?.black || 0,
                discs: state.discInventory?.black || 0,
                rings: state.ringInventory?.black || 0
            },
            white: {
                tiles: state.inventory?.white || 0,
                discs: state.discInventory?.white || 0,
                rings: state.ringInventory?.white || 0
            }
        },
        captured: {
            black_discs: state.captured?.black?.disc || 0,
            black_rings: state.captured?.black?.ring || 0,
            white_discs: state.captured?.white?.disc || 0,
            white_rings: state.captured?.white?.ring || 0
        }
    };
}

/**
 * Convert AI format back to app game state
 */
function convertFromAIFormat(aiState, originalState) {
    return {
        ...originalState,
        tiles: aiState.tiles,
        pieces: aiState.pieces,
        activePlayer: aiState.activePlayer,
        inventory: {
            black: aiState.inventory?.black?.tiles || 0,
            white: aiState.inventory?.white?.tiles || 0
        },
        discInventory: {
            black: aiState.inventory?.black?.discs || 0,
            white: aiState.inventory?.white?.discs || 0
        },
        ringInventory: {
            black: aiState.inventory?.black?.rings || 0,
            white: aiState.inventory?.white?.rings || 0
        },
        captured: {
            black: {
                disc: aiState.captured?.black_discs || 0,
                ring: aiState.captured?.black_rings || 0
            },
            white: {
                disc: aiState.captured?.white_discs || 0,
                ring: aiState.captured?.white_rings || 0
            }
        },
        metadata: {
            ...originalState.metadata,
            selection: null,
            multiJumping: false,
            multiJumpPos: null
        }
    };
}
