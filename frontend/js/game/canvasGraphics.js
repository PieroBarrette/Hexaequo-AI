import { axialToPixel } from './hexMath.js';
import { calculateAllValidMoves } from '../../../shared/game/moveValidator.js';

const DEFAULT_PALETTE = {
    tileDark: '#4b4f59',
    tileLight: '#b6bcc9',
    discDark: '#17191d',
    discLight: '#f6f7f8',
    ringDark: '#d4d7de',
    ringLight: '#3a3e46',
    outline: 'rgba(255, 255, 255, 0.18)',
    selection: 'rgba(255, 255, 255, 0.45)',
    validAdjacent: 'rgba(255, 255, 255, 0.28)',
    validJump: 'rgba(255, 255, 255, 0.4)',
    hintPiece: 'rgba(255, 255, 255, 0.4)',
    hintTile: 'rgba(255, 255, 255, 0.25)',
    hintPlacement: 'rgba(255, 255, 255, 0.35)',
    lastMove: 'rgba(255, 255, 255, 0.32)',
    capture: 'rgba(255, 255, 255, 0.65)'
};

function resolvePalette(custom) {
    if (!custom) {
        return { ...DEFAULT_PALETTE };
    }
    return { ...DEFAULT_PALETTE, ...custom };
}

export function createCanvasGraphics(canvas, options = {}) {
    if (!canvas) {
        throw new Error('createCanvasGraphics requires a canvas element');
    }

    const ctx = canvas.getContext('2d');
    const fallbackHexSize = options.hexSize ?? 36;
    const offsetY = options.offsetY ?? 0;
    const offsetX = options.offsetX ?? 0;
    const minHexSize = options.minHexSize ?? 28;
    const maxHexSize = options.maxHexSize ?? 72;
    const padding = options.padding ?? 48;
    const getPreferences = typeof options.getPreferences === 'function' ? options.getPreferences : null;
    const getPalette = typeof options.getPalette === 'function' ? options.getPalette : null;
    let lastState = null;
    let currentLayout = {
        hexSize: fallbackHexSize,
        translateX: canvas.width / 2 + offsetX,
        translateY: canvas.height / 2 + offsetY
    };
    const layoutSubscribers = new Set();

    // Animation system
    let activeAnimations = [];
    let animationCallbacks = [];
    let animationLoopRunning = false;
    const ANIMATION_DURATION = 350; // milliseconds

    function renderStatic(state) {
        if (!ctx || !state) return;
        lastState = state;
        updateLayout(state);
        const layout = currentLayout;
        const preferences = getPreferences ? getPreferences() : {};
        const palette = resolvePalette(getPalette ? getPalette() : null);
        const size = layout.hexSize;

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.save();
        ctx.translate(layout.translateX, layout.translateY);
        drawTiles(ctx, state.tiles, size, palette);
        
        // Filter out dragged piece if actively dragging
        const dragState = state.metadata?.dragState;
        const isDraggingPiece = dragState?.isDragging && dragState?.thresholdMet;
        let piecesToDraw = state.pieces;
        
        if (isDraggingPiece && state.metadata?.selection) {
            const dragKey = `${state.metadata.selection.q},${state.metadata.selection.r}`;
            piecesToDraw = { ...state.pieces };
            delete piecesToDraw[dragKey];
        }
        
        drawPieces(ctx, piecesToDraw, state.tiles, size, palette);
        drawGlobalMoveHints(ctx, state, size, preferences, palette);
        drawSelection(ctx, state.metadata, size, palette);
        drawValidMoves(ctx, state.metadata, size, palette);
        drawLastMoveHighlight(ctx, state.metadata, size, preferences, palette);
        ctx.restore();
        
        // Draw dragged piece at cursor position (outside transformed context)
        if (isDraggingPiece && dragState.piece && dragState.position) {
            drawDraggedPiece(ctx, dragState, size, palette, layout);
        }
    }
    
    function drawDraggedPiece(ctx, dragState, size, palette, layout) {
        const { piece, position } = dragState;
        const scaledX = position.x * (canvas.width / canvas.getBoundingClientRect().width);
        const scaledY = position.y * (canvas.height / canvas.getBoundingClientRect().height);
        
        ctx.save();
        ctx.translate(scaledX, scaledY);
        ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
        ctx.shadowBlur = size * 0.15;
        ctx.shadowOffsetY = size * 0.1;
        ctx.globalAlpha = 0.9;
        
        if (piece.type === 'ring') {
            const ringColor = piece.color === 'black' ? palette.ringDark : palette.ringLight;
            ctx.strokeStyle = ringColor;
            ctx.lineWidth = size * 0.12;
            ctx.beginPath();
            ctx.arc(0, 0, size * 0.42, 0, Math.PI * 2);
            ctx.stroke();
        } else {
            const discColor = piece.color === 'black' ? palette.discDark : palette.discLight;
            ctx.fillStyle = discColor;
            ctx.strokeStyle = palette.outline;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(0, 0, size * 0.34, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
        }
        ctx.restore();
    }

    const logEvent = (type, payload) => {
        if (options.verbose) {
            console.log(`[CanvasGraphics] ${type}`, payload);
        }
    };

    function startAnimationLoop() {
        if (animationLoopRunning) return;
        animationLoopRunning = true;
        
        function loop() {
            if (activeAnimations.length > 0 || animationCallbacks.length > 0) {
                updateAndRenderAnimations();
                requestAnimationFrame(loop);
            } else {
                animationLoopRunning = false;
            }
        }
        
        requestAnimationFrame(loop);
    }

    function updateAndRenderAnimations() {
        if (!lastState) return;
        
        const now = performance.now();
        const layout = currentLayout;
        const preferences = getPreferences ? getPreferences() : {};
        const palette = resolvePalette(getPalette ? getPalette() : null);
        const size = layout.hexSize;

        // Update animation progress
        for (let i = activeAnimations.length - 1; i >= 0; i--) {
            const anim = activeAnimations[i];
            const elapsed = now - anim.startTime;
            const progress = Math.min(elapsed / anim.duration, 1);
            anim.progress = easeInOutQuad(progress);

            if (progress >= 1) {
                activeAnimations.splice(i, 1);
                if (typeof anim.onComplete === 'function') {
                    anim.onComplete();
                }
            }
        }

        // Check if all animations completed
        if (activeAnimations.length === 0 && animationCallbacks.length > 0) {
            const callbacks = [...animationCallbacks];
            animationCallbacks = [];
            callbacks.forEach(cb => {
                try {
                    cb();
                } catch (err) {
                    console.error('[CanvasGraphics] Animation callback error:', err);
                }
            });
        }

        // Render
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.save();
        ctx.translate(layout.translateX, layout.translateY);
        
        // Collect positions that are being animated
        const animatedPiecePositions = new Set();
        const animatedTilePositions = new Set();
        activeAnimations.forEach(anim => {
            if (anim.type === 'move' || anim.type === 'jump') {
                animatedPiecePositions.add(`${anim.fromQ},${anim.fromR}`);
            }
            if (anim.type === 'capture' || anim.type === 'placement') {
                animatedPiecePositions.add(`${anim.q},${anim.r}`);
            }
            if (anim.type === 'tilePlacement') {
                animatedTilePositions.add(`${anim.q},${anim.r}`);
            }
        });
        
        // Draw static tiles (excluding those being animated)
        const visibleTiles = {};
        Object.entries(lastState.tiles || {}).forEach(([key, color]) => {
            if (!animatedTilePositions.has(key)) {
                visibleTiles[key] = color;
            }
        });
        drawTiles(ctx, visibleTiles, size, palette);
        
        // Draw pieces (excluding those being animated)
        const visiblePieces = {};
        Object.entries(lastState.pieces || {}).forEach(([key, piece]) => {
            if (!animatedPiecePositions.has(key)) {
                visiblePieces[key] = piece;
            }
        });
        drawPieces(ctx, visiblePieces, lastState.tiles, size, palette);
        
        // Draw animated elements
        activeAnimations.forEach(anim => {
            drawAnimation(ctx, anim, size, palette);
        });
        
        // Draw overlays
        drawGlobalMoveHints(ctx, lastState, size, preferences, palette);
        drawSelection(ctx, lastState.metadata, size, palette);
        drawValidMoves(ctx, lastState.metadata, size, palette);
        drawLastMoveHighlight(ctx, lastState.metadata, size, preferences, palette);
        
        ctx.restore();
    }

    function drawAnimation(ctx, anim, size, palette) {
        const { type, progress } = anim;

        if (type === 'move' || type === 'jump') {
            const from = axialToPixel(anim.fromQ, anim.fromR, size);
            const to = axialToPixel(anim.toQ, anim.toR, size);
            const x = from.x + (to.x - from.x) * progress;
            const y = from.y + (to.y - from.y) * progress;
            
            ctx.save();
            ctx.translate(x, y);
            ctx.shadowColor = 'rgba(0, 0, 0, 0.4)';
            ctx.shadowBlur = size * 0.08;
            
            if (anim.piece.type === 'ring') {
                const ringColor = anim.piece.color === 'black' ? palette.ringDark : palette.ringLight;
                ctx.strokeStyle = ringColor;
                ctx.lineWidth = size * 0.12;
                ctx.beginPath();
                ctx.arc(0, 0, size * 0.42, 0, Math.PI * 2);
                ctx.stroke();
            } else {
                const discColor = anim.piece.color === 'black' ? palette.discDark : palette.discLight;
                ctx.fillStyle = discColor;
                ctx.strokeStyle = palette.outline;
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.arc(0, 0, size * 0.34, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();
            }
            ctx.restore();
        } else if (type === 'capture') {
            const pos = axialToPixel(anim.q, anim.r, size);
            const opacity = 1 - progress;
            const scale = 1 - progress * 0.3;
            
            ctx.save();
            ctx.translate(pos.x, pos.y);
            ctx.globalAlpha = opacity;
            ctx.scale(scale, scale);
            ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
            ctx.shadowBlur = size * 0.06;
            
            if (anim.piece.type === 'ring') {
                const ringColor = anim.piece.color === 'black' ? palette.ringDark : palette.ringLight;
                ctx.strokeStyle = ringColor;
                ctx.lineWidth = size * 0.12;
                ctx.beginPath();
                ctx.arc(0, 0, size * 0.42, 0, Math.PI * 2);
                ctx.stroke();
            } else {
                const discColor = anim.piece.color === 'black' ? palette.discDark : palette.discLight;
                ctx.fillStyle = discColor;
                ctx.strokeStyle = palette.outline;
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.arc(0, 0, size * 0.34, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();
            }
            ctx.restore();
        } else if (type === 'placement') {
            const pos = axialToPixel(anim.q, anim.r, size);
            const scale = progress;
            const opacity = progress;
            
            ctx.save();
            ctx.translate(pos.x, pos.y);
            ctx.globalAlpha = opacity;
            ctx.scale(scale, scale);
            ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
            ctx.shadowBlur = size * 0.06;
            
            if (anim.piece.type === 'ring') {
                const ringColor = anim.piece.color === 'black' ? palette.ringDark : palette.ringLight;
                ctx.strokeStyle = ringColor;
                ctx.lineWidth = size * 0.12;
                ctx.beginPath();
                ctx.arc(0, 0, size * 0.42, 0, Math.PI * 2);
                ctx.stroke();
            } else {
                const discColor = anim.piece.color === 'black' ? palette.discDark : palette.discLight;
                ctx.fillStyle = discColor;
                ctx.strokeStyle = palette.outline;
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.arc(0, 0, size * 0.34, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();
            }
            ctx.restore();
        } else if (type === 'tilePlacement') {
            const pos = axialToPixel(anim.q, anim.r, size);
            const scale = 0.5 + progress * 0.5;
            const opacity = progress;
            
            ctx.save();
            ctx.translate(pos.x, pos.y);
            ctx.globalAlpha = opacity;
            ctx.scale(scale, scale);
            ctx.shadowColor = 'rgba(0, 0, 0, 0.25)';
            ctx.shadowBlur = size * 0.05;
            ctx.beginPath();
            hexPath(ctx, size);
            ctx.fillStyle = anim.color === 'black' ? palette.tileDark : palette.tileLight;
            ctx.strokeStyle = palette.outline;
            ctx.lineWidth = 2;
            ctx.fill();
            ctx.stroke();
            ctx.restore();
        }
    }

    function easeInOutQuad(t) {
        return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    }

    return {
        renderStatic,
        rerenderLastFrame() {
            if (lastState) {
                renderStatic(lastState);
            }
        },
        getLayout() {
            return { ...currentLayout };
        },
        subscribeLayout(listener) {
            if (typeof listener !== 'function') {
                return () => {};
            }
            layoutSubscribers.add(listener);
            listener({ ...currentLayout });
            return () => layoutSubscribers.delete(listener);
        },
        queueTilePlacementAnimation(q, r, color) {
            logEvent('tile-placement', { q, r, color });
            activeAnimations.push({
                type: 'tilePlacement',
                q,
                r,
                color,
                startTime: performance.now(),
                duration: ANIMATION_DURATION,
                progress: 0
            });
            startAnimationLoop();
        },
        queuePiecePlacementAnimation(q, r, piece) {
            logEvent('piece-placement', { q, r, piece });
            activeAnimations.push({
                type: 'placement',
                q,
                r,
                piece: { ...piece },
                startTime: performance.now(),
                duration: ANIMATION_DURATION,
                progress: 0
            });
            startAnimationLoop();
        },
        queueJumpSequenceWithCaptures(path, piece, captures = []) {
            logEvent('jump-sequence', { path, piece, captures });
            if (!Array.isArray(path) || path.length < 2) return;
            
            let segmentIndex = 0;
            
            function animateNextSegment() {
                if (segmentIndex >= path.length - 1) {
                    // All segments done, now animate captures
                    captures.forEach((cap, index) => {
                        setTimeout(() => {
                            activeAnimations.push({
                                type: 'capture',
                                q: cap.q,
                                r: cap.r,
                                piece: { ...cap.piece },
                                startTime: performance.now(),
                                duration: ANIMATION_DURATION * 0.6,
                                progress: 0
                            });
                            startAnimationLoop();
                        }, index * 50);
                    });
                    return;
                }
                
                const from = path[segmentIndex];
                const to = path[segmentIndex + 1];
                
                activeAnimations.push({
                    type: 'jump',
                    fromQ: from.q,
                    fromR: from.r,
                    toQ: to.q,
                    toR: to.r,
                    piece: { ...piece },
                    startTime: performance.now(),
                    duration: ANIMATION_DURATION,
                    progress: 0,
                    onComplete: () => {
                        segmentIndex++;
                        animateNextSegment();
                    }
                });
                startAnimationLoop();
            }
            
            animateNextSegment();
        },
        queueSingleMoveWithCapture(fromQ, fromR, toQ, toR, piece, captures = []) {
            logEvent('move-with-captures', { fromQ, fromR, toQ, toR, piece, captures });
            
            activeAnimations.push({
                type: 'move',
                fromQ,
                fromR,
                toQ,
                toR,
                piece: { ...piece },
                startTime: performance.now(),
                duration: ANIMATION_DURATION,
                progress: 0,
                onComplete: () => {
                    captures.forEach((cap, index) => {
                        setTimeout(() => {
                            activeAnimations.push({
                                type: 'capture',
                                q: cap.q,
                                r: cap.r,
                                piece: { ...cap.piece },
                                startTime: performance.now(),
                                duration: ANIMATION_DURATION * 0.6,
                                progress: 0
                            });
                            startAnimationLoop();
                        }, index * 50);
                    });
                }
            });
            startAnimationLoop();
        },
        queueMoveAnimation(fromQ, fromR, toQ, toR, piece) {
            logEvent('move', { fromQ, fromR, toQ, toR, piece });
            activeAnimations.push({
                type: 'move',
                fromQ,
                fromR,
                toQ,
                toR,
                piece: { ...piece },
                startTime: performance.now(),
                duration: ANIMATION_DURATION,
                progress: 0
            });
            startAnimationLoop();
        },
        queueCaptureAnimation(q, r, piece) {
            logEvent('capture', { q, r, piece });
            activeAnimations.push({
                type: 'capture',
                q,
                r,
                piece: { ...piece },
                startTime: performance.now(),
                duration: ANIMATION_DURATION * 0.6,
                progress: 0
            });
            startAnimationLoop();
        },
        onAllAnimationsComplete(callback) {
            if (typeof callback !== 'function') return;
            if (activeAnimations.length === 0) {
                callback();
            } else {
                animationCallbacks.push(callback);
            }
        },
        isAnimating() {
            return activeAnimations.length > 0;
        },
        clearAnimations() {
            activeAnimations = [];
            animationCallbacks = [];
        }
    };

    function updateLayout(state) {
        const next = computeResponsiveLayout(state, canvas, {
            fallbackHexSize,
            offsetX,
            offsetY,
            minHexSize,
            maxHexSize,
            padding
        });
        const changed =
            Math.abs(next.hexSize - currentLayout.hexSize) > 0.25 ||
            Math.abs(next.translateX - currentLayout.translateX) > 0.5 ||
            Math.abs(next.translateY - currentLayout.translateY) > 0.5;
        currentLayout = next;
        if (changed) {
            const snapshot = { ...currentLayout };
            layoutSubscribers.forEach((listener) => {
                try {
                    listener(snapshot);
                } catch (err) {
                    console.error('[CanvasGraphics] layout listener error', err);
                }
            });
        }
    }
}

function drawTiles(ctx, tiles = {}, size, palette) {
    for (const [key, color] of Object.entries(tiles)) {
        if (!color) continue;
        const [q, r] = parseKey(key);
        const { x, y } = axialToPixel(q, r, size);
        ctx.save();
        ctx.translate(x, y);
        ctx.shadowColor = 'rgba(0, 0, 0, 0.25)';
        ctx.shadowBlur = size * 0.05;
        ctx.beginPath();
        hexPath(ctx, size);
        ctx.fillStyle = color === 'black' ? palette.tileDark : palette.tileLight;
        ctx.strokeStyle = palette.outline;
        ctx.lineWidth = 2;
        ctx.fill();
        ctx.stroke();
        ctx.restore();
    }
}

function drawPieces(ctx, pieces = {}, tiles = {}, size, palette) {
    for (const [key, piece] of Object.entries(pieces)) {
        if (!piece || !tiles[key]) continue;
        const [q, r] = parseKey(key);
        const { x, y } = axialToPixel(q, r, size);
        ctx.save();
        ctx.translate(x, y);
        ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
        ctx.shadowBlur = size * 0.06;
        ctx.beginPath();
        if (piece.type === 'ring') {
            const ringColor = piece.color === 'black' ? palette.ringDark : palette.ringLight;
            ctx.strokeStyle = ringColor;
            ctx.lineWidth = size * 0.12;
            ctx.arc(0, 0, size * 0.42, 0, Math.PI * 2);
            ctx.stroke();
        } else {
            const discColor = piece.color === 'black' ? palette.discDark : palette.discLight;
            ctx.fillStyle = discColor;
            ctx.strokeStyle = palette.outline;
            ctx.lineWidth = 2;
            ctx.arc(0, 0, size * 0.34, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
        }
        ctx.restore();
    }
}

function hexPath(ctx, size) {
    for (let i = 0; i < 6; i++) {
        const angle = (Math.PI / 180) * (60 * i + 30);
        const x = size * Math.cos(angle);
        const y = size * Math.sin(angle);
        if (i === 0) {
            ctx.moveTo(x, y);
        } else {
            ctx.lineTo(x, y);
        }
    }
    ctx.closePath();
}

function parseKey(key) {
    const [q, r] = key.split(',').map(Number);
    return [q, r];
}

function drawSelection(ctx, metadata = {}, size, palette) {
    if (!metadata?.selection) return;
    const { q, r } = metadata.selection;
    const { x, y } = axialToPixel(q, r, size);
    ctx.save();
    ctx.translate(x, y);
    ctx.beginPath();
    ctx.arc(0, 0, size * 0.5, 0, Math.PI * 2);
    ctx.strokeStyle = palette.selection;
    ctx.lineWidth = 3;
    ctx.setLineDash([6, 4]);
    ctx.stroke();
    ctx.restore();
}

function drawValidMoves(ctx, metadata = {}, size, palette) {
    const moves = metadata?.validMoves;
    if (!Array.isArray(moves) || moves.length === 0) return;

    moves.forEach((move) => {
        const { x, y } = axialToPixel(move.q, move.r, size);
        ctx.save();
        ctx.translate(x, y);
        ctx.beginPath();
        ctx.arc(0, 0, size * 0.2, 0, Math.PI * 2);
        ctx.fillStyle = move.type === 'jump' ? palette.validJump : palette.validAdjacent;
        ctx.fill();
        ctx.restore();
    });
}

function drawGlobalMoveHints(ctx, state = {}, size, preferences = {}, palette) {
    if (!preferences?.showValidMoves) return;
    const highlights = calculateAllValidMoves(state, buildMoveContext(state));
    if (!Array.isArray(highlights) || highlights.length === 0) return;

    highlights.forEach((hint) => {
        if (!Number.isFinite(hint.q) || !Number.isFinite(hint.r)) return;
        if (hint.type === 'piece') {
            drawCircleOutline(ctx, hint.q, hint.r, size, palette.hintPiece, 0.5);
            return;
        }
        if (hint.type === 'tile') {
            drawHexOutline(ctx, hint.q, hint.r, size, palette.hintTile, 0.78);
            return;
        }
        drawPlacementDot(ctx, hint.q, hint.r, size, palette.hintPlacement);
    });
}

function drawLastMoveHighlight(ctx, metadata = {}, size, preferences = {}, palette) {
    if (!preferences?.showPreviousMove) return;
    const summary = metadata?.lastMoveHighlight;
    if (!summary) return;
    const highlightColor = palette.lastMove;

    switch (summary.kind) {
        case 'tile':
            drawHexOutline(ctx, summary.q, summary.r, size, highlightColor, 0.85);
            break;
        case 'piece':
            drawCircleOutline(ctx, summary.q, summary.r, size, highlightColor, 0.5);
            break;
        case 'move':
            drawMoveTrail(ctx, summary, size, highlightColor, palette);
            break;
        case 'capture':
            (summary.captures || []).forEach((pos) => drawCaptureMarker(ctx, pos.q, pos.r, size, palette));
            break;
        default:
            break;
    }
}

function drawMoveTrail(ctx, summary, size, color, palette) {
    const nodes = Array.isArray(summary?.path) && summary.path.length > 1
        ? summary.path
        : [summary?.from, summary?.to];
    const filteredNodes = nodes.filter((node) => Number.isFinite(node?.q) && Number.isFinite(node?.r));
    if (filteredNodes.length < 2) return;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    filteredNodes.forEach((node, index) => {
        const { x, y } = axialToPixel(node.q, node.r, size);
        if (index === 0) {
            ctx.moveTo(x, y);
        } else {
            ctx.lineTo(x, y);
        }
    });
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
    const destination = filteredNodes[filteredNodes.length - 1];
    drawCircleOutline(ctx, destination.q, destination.r, size, color, 0.52);
    (summary.captures || []).forEach((pos) => drawCaptureMarker(ctx, pos.q, pos.r, size, palette));
}

function drawPlacementDot(ctx, q, r, size, color) {
    if (!Number.isFinite(q) || !Number.isFinite(r)) return;
    const { x, y } = axialToPixel(q, r, size);
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, size * 0.18, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();
}

function drawCircleOutline(ctx, q, r, size, color, radiusFactor = 0.45) {
    if (!Number.isFinite(q) || !Number.isFinite(r)) return;
    const { x, y } = axialToPixel(q, r, size);
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, size * radiusFactor, 0, Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.setLineDash([6, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
}

function drawHexOutline(ctx, q, r, size, color, scale = 1) {
    if (!Number.isFinite(q) || !Number.isFinite(r)) return;
    const { x, y } = axialToPixel(q, r, size);
    ctx.save();
    ctx.translate(x, y);
    ctx.beginPath();
    hexPath(ctx, size * scale);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
}

function drawCaptureMarker(ctx, q, r, size, palette) {
    if (!Number.isFinite(q) || !Number.isFinite(r)) return;
    const { x, y } = axialToPixel(q, r, size);
    const arm = size * 0.22;
    ctx.save();
    ctx.strokeStyle = palette.capture;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x - arm, y - arm);
    ctx.lineTo(x + arm, y + arm);
    ctx.moveTo(x + arm, y - arm);
    ctx.lineTo(x - arm, y + arm);
    ctx.stroke();
    ctx.restore();
}

function buildMoveContext(state = {}) {
    const metadata = state.metadata ?? {};
    return {
        player: state.activePlayer,
        radius: state.radius,
        multiJumping: metadata.multiJumping,
        jumpHistory: metadata.jumpHistory,
        turnStartPiecePos: metadata.turnStartPiecePos,
        sequenceCapturedSnapshot: metadata.sequenceCapturedSnapshot
    };
}

const NEIGHBOR_DELTAS = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, -1],
    [-1, 1]
];

const SQRT3 = Math.sqrt(3);
const HEX_HALF_WIDTH = SQRT3 / 2;
const HEX_HALF_HEIGHT = 1; // since height = 2 * size when size = 1

function computeResponsiveLayout(state, canvas, options) {
    const fallback = {
        hexSize: options.fallbackHexSize,
        translateX: canvas.width / 2 + (options.offsetX ?? 0),
        translateY: canvas.height / 2 + (options.offsetY ?? 0)
    };

    const referenceKeys = collectLayoutReferenceKeys(state);
    if (referenceKeys.size === 0) {
        return fallback;
    }

    const coords = new Set();
    referenceKeys.forEach((key) => {
        coords.add(key);
        const [q, r] = parseKey(key);
        NEIGHBOR_DELTAS.forEach(([dq, dr]) => coords.add(`${q + dq},${r + dr}`));
    });

    if (coords.size === 0) {
        return fallback;
    }

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    coords.forEach((key) => {
        const [q, r] = parseKey(key);
        const { x, y } = axialToPixel(q, r, 1);
        minX = Math.min(minX, x - HEX_HALF_WIDTH);
        maxX = Math.max(maxX, x + HEX_HALF_WIDTH);
        minY = Math.min(minY, y - HEX_HALF_HEIGHT);
        maxY = Math.max(maxY, y + HEX_HALF_HEIGHT);
    });

    if (!isFinite(minX) || !isFinite(maxX) || !isFinite(minY) || !isFinite(maxY)) {
        return fallback;
    }

    const contentWidth = maxX - minX;
    const contentHeight = maxY - minY;
    const padding = options.padding ?? 48;
    const availableWidth = Math.max(10, canvas.width - padding * 2);
    const availableHeight = Math.max(10, canvas.height - padding * 2);
    const fallbackWidth = SQRT3;
    const fallbackHeight = 2;

    const scaleX = contentWidth > 0 ? availableWidth / contentWidth : availableWidth / fallbackWidth;
    const scaleY = contentHeight > 0 ? availableHeight / contentHeight : availableHeight / fallbackHeight;

    let hexSize = Math.min(scaleX, scaleY);
    const minSize = options.minHexSize ?? 24;
    const maxSize = options.maxHexSize ?? Math.min(canvas.width, canvas.height) / 3;
    hexSize = clamp(hexSize, minSize, maxSize);

    const centerUnitX = (minX + maxX) / 2;
    const centerUnitY = (minY + maxY) / 2;

    return {
        hexSize,
        translateX: canvas.width / 2 - centerUnitX * hexSize + (options.offsetX ?? 0),
        translateY: canvas.height / 2 - centerUnitY * hexSize + (options.offsetY ?? 0)
    };
}

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

function collectLayoutReferenceKeys(state) {
    const references = new Set();
    const tiles = state?.tiles ?? {};
    Object.entries(tiles).forEach(([key, owner]) => {
        if (owner) {
            references.add(key);
        }
    });

    if (!state) {
        return references;
    }

    const highlights = calculateAllValidMoves(state, buildMoveContext(state)) || [];
    highlights.forEach((hint) => {
        if (hint.type !== 'tile') {
            return;
        }
        if (!Number.isFinite(hint.q) || !Number.isFinite(hint.r)) {
            return;
        }
        references.add(`${hint.q},${hint.r}`);
    });

    return references;
}
