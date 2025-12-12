/**
 * Canvas Graphics - Hardware-accelerated rendering engine
 * 
 * Handles all canvas drawing operations for the hex board.
 * Ported from hexaequo-v2/graphics.js with ES module structure.
 */

// Color schemes
const COLOR_SCHEMES = {
    modern: {
        bg: '#121212',
        black: '#333333',
        white: '#cccccc',
        border: '#666666'
    },
    classic: {
        bg: '#d0c09bff',
        black: '#7a5230',
        white: '#f5e2b6',
        border: '#7a5230'
    }
};

/**
 * Canvas Graphics Class
 */
export class CanvasGraphics {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        
        // Layout parameters
        this.hexSize = 25;
        this.centerX = 0;
        this.centerY = 0;
        this.targetHexSize = 25;
        this.targetCenterX = 0;
        this.targetCenterY = 0;
        
        // Color scheme
        this.colorScheme = 'classic';
        
        // Animation system
        this.animationsEnabled = true;
        this.activeAnimations = [];
        this.animationCallbacks = [];
        this.animationDuration = 200;
        this.animationLoopStarted = false;
        
        // State callback
        this.getGameState = null;
        
        // Colors for highlights
        this.colors = {
            highlight: 'rgba(100, 200, 255, 0.4)',
            moveDot: 'rgba(100, 200, 100, 0.6)',
            jumpDot: 'rgba(255, 200, 100, 0.6)',
            capture: 'rgba(255, 100, 100, 0.6)',
            previousMove: 'rgba(255, 200, 0, 0.3)'
        };

        this.setupCanvas();
    }

    /**
     * Initialize with state callback
     */
    init(getStateFn) {
        this.getGameState = getStateFn;
        this.centerX = this.canvas.width / 2;
        this.centerY = this.canvas.height / 2;
        this.targetCenterX = this.centerX;
        this.targetCenterY = this.centerY;
        
        if (!this.animationLoopStarted) {
            this.animationLoopStarted = true;
            this.startAnimationLoop();
        }
    }

    /**
     * Setup canvas for high DPI displays
     */
    setupCanvas() {
        const dpr = window.devicePixelRatio || 1;
        const rect = this.canvas.getBoundingClientRect();

        this.canvas.width = rect.width * dpr;
        this.canvas.height = rect.height * dpr;
        this.ctx.scale(dpr, dpr);

        this.canvas.style.width = `${rect.width}px`;
        this.canvas.style.height = `${rect.height}px`;
        
        this.centerX = rect.width / 2;
        this.centerY = rect.height / 2;
        this.targetCenterX = this.centerX;
        this.targetCenterY = this.centerY;
    }

    /**
     * Resize canvas (call on window resize)
     */
    resize() {
        this.setupCanvas();
        this.updateDynamicLayout();
    }

    /**
     * Set color scheme
     */
    setColorScheme(scheme) {
        if (COLOR_SCHEMES[scheme]) {
            this.colorScheme = scheme;
        }
    }

    /**
     * Set animations enabled
     */
    setAnimationsEnabled(enabled) {
        this.animationsEnabled = enabled;
    }

    /**
     * Set animation duration
     */
    setAnimationDuration(ms) {
        this.animationDuration = ms;
    }

    // ==================== Coordinate Utilities ====================

    /**
     * Convert axial coordinates (q, r) to pixel coordinates
     */
    hexToPixel(q, r) {
        const x = this.hexSize * Math.sqrt(3) * (q + r / 2);
        const y = this.hexSize * 3 / 2 * r;
        return { x: this.centerX + x, y: this.centerY + y };
    }

    /**
     * Convert pixel coordinates to axial (q, r)
     */
    pixelToHex(px, py) {
        const x = px - this.centerX;
        const y = py - this.centerY;
        const q = (Math.sqrt(3) / 3 * x - 1 / 3 * y) / this.hexSize;
        const r = (2 / 3 * y) / this.hexSize;
        
        // Round to nearest hex using cube coordinates
        let rq = Math.round(q);
        let rr = Math.round(r);
        let rs = Math.round(-q - r);
        
        const q_diff = Math.abs(rq - q);
        const r_diff = Math.abs(rr - r);
        const s_diff = Math.abs(rs - (-q - r));
        
        if (q_diff > r_diff && q_diff > s_diff) {
            rq = -rr - rs;
        } else if (r_diff > s_diff) {
            rr = -rq - rs;
        }
        
        return { q: rq, r: rr };
    }

    /**
     * Get neighbors of a hex
     */
    getNeighbors(q, r) {
        return [
            [q + 1, r], [q - 1, r], [q, r + 1], 
            [q, r - 1], [q + 1, r - 1], [q - 1, r + 1]
        ];
    }

    // ==================== Layout ====================

    /**
     * Update hex size and center dynamically based on tiles
     */
    updateDynamicLayout() {
        if (!this.getGameState) return;
        
        const state = this.getGameState();
        const tiles = state.tiles || {};
        const tileKeys = Object.keys(tiles);

        if (tileKeys.length === 0) {
            const rect = this.canvas.getBoundingClientRect();
            this.targetCenterX = rect.width / 2;
            this.targetCenterY = rect.height / 2;
            this.targetHexSize = Math.min(rect.width, rect.height) / 10;
            return;
        }

        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;

        const tempSize = 1;
        const hexesToInclude = new Set(tileKeys);

        // Include neighboring hexes for padding
        tileKeys.forEach(key => {
            const [q, r] = key.split(',').map(Number);
            this.getNeighbors(q, r).forEach(([nq, nr]) => {
                hexesToInclude.add(`${nq},${nr}`);
            });
        });

        hexesToInclude.forEach(key => {
            const [q, r] = key.split(',').map(Number);
            const x = tempSize * Math.sqrt(3) * (q + r / 2);
            const y = tempSize * 3 / 2 * r;
            const hWidth = Math.sqrt(3) * tempSize;
            const hHeight = 2 * tempSize;

            minX = Math.min(minX, x - hWidth / 2);
            maxX = Math.max(maxX, x + hWidth / 2);
            minY = Math.min(minY, y - hHeight / 2);
            maxY = Math.max(maxY, y + hHeight / 2);
        });

        const contentWidth = maxX - minX;
        const contentHeight = maxY - minY;

        const rect = this.canvas.getBoundingClientRect();
        const padding = 60;
        const availWidth = rect.width - padding * 2;
        const availHeight = rect.height - padding * 2;

        const scaleX = contentWidth > 0 ? availWidth / contentWidth : availWidth / Math.sqrt(3);
        const scaleY = contentHeight > 0 ? availHeight / contentHeight : availHeight / 2;

        let newHexSize = Math.min(scaleX, scaleY);
        const maxHexSize = Math.min(rect.width, rect.height) / 4;
        const minHexSize = 15;
        newHexSize = Math.min(Math.max(newHexSize, minHexSize), maxHexSize);

        this.targetHexSize = newHexSize;

        const contentCenterX = (minX + maxX) / 2 * this.targetHexSize;
        const contentCenterY = (minY + maxY) / 2 * this.targetHexSize;

        this.targetCenterX = (rect.width / 2) - contentCenterX;
        this.targetCenterY = (rect.height / 2) - contentCenterY;
    }

    // ==================== Animation System ====================

    /**
     * Easing function - ease out cubic
     */
    easeOutCubic(t) {
        return 1 - Math.pow(1 - t, 3);
    }

    /**
     * Linear interpolation
     */
    lerp(start, end, t) {
        return start + (end - start) * t;
    }

    /**
     * Start animation loop
     */
    startAnimationLoop() {
        const animate = () => {
            this.processViewAnimation();
            this.processAnimations();
            requestAnimationFrame(animate);
        };
        requestAnimationFrame(animate);
    }

    /**
     * Process view pan/zoom animation
     */
    processViewAnimation() {
        const ease = 0.1;
        const epsilon = 0.1;
        let changed = false;

        if (Math.abs(this.targetHexSize - this.hexSize) > epsilon) {
            this.hexSize += (this.targetHexSize - this.hexSize) * ease;
            changed = true;
        } else {
            this.hexSize = this.targetHexSize;
        }

        if (Math.abs(this.targetCenterX - this.centerX) > epsilon) {
            this.centerX += (this.targetCenterX - this.centerX) * ease;
            changed = true;
        } else {
            this.centerX = this.targetCenterX;
        }

        if (Math.abs(this.targetCenterY - this.centerY) > epsilon) {
            this.centerY += (this.targetCenterY - this.centerY) * ease;
            changed = true;
        } else {
            this.centerY = this.targetCenterY;
        }

        if (changed || this.activeAnimations.length > 0) {
            this.render();
        }
    }

    /**
     * Process active animations
     */
    processAnimations() {
        if (this.activeAnimations.length === 0) return;

        const now = performance.now();
        const completedAnimations = [];

        for (let i = this.activeAnimations.length - 1; i >= 0; i--) {
            const anim = this.activeAnimations[i];
            const elapsed = now - anim.startTime;
            const progress = Math.min(elapsed / anim.duration, 1);
            anim.progress = this.easeOutCubic(progress);

            if (progress >= 1) {
                completedAnimations.push(anim);
                this.activeAnimations.splice(i, 1);
            }
        }

        completedAnimations.forEach(anim => {
            if (anim.onComplete) anim.onComplete();
        });

        if (this.activeAnimations.length === 0 && this.animationCallbacks.length > 0) {
            const callbacks = [...this.animationCallbacks];
            this.animationCallbacks = [];
            callbacks.forEach(cb => cb());
        }
    }

    /**
     * Queue a move animation
     */
    queueMoveAnimation(fromQ, fromR, toQ, toR, piece, onComplete) {
        if (!this.animationsEnabled) {
            if (onComplete) onComplete();
            return;
        }

        this.activeAnimations.push({
            type: 'move',
            fromQ, fromR, toQ, toR,
            piece: { ...piece },
            startTime: performance.now(),
            duration: this.animationDuration,
            progress: 0,
            onComplete
        });
    }

    /**
     * Queue a capture (fade-out) animation
     */
    queueCaptureAnimation(q, r, piece, onComplete) {
        if (!this.animationsEnabled) {
            if (onComplete) onComplete();
            return;
        }

        this.activeAnimations.push({
            type: 'capture',
            q, r,
            piece: { ...piece },
            startTime: performance.now(),
            duration: this.animationDuration,
            progress: 0,
            onComplete
        });
    }

    /**
     * Queue tile placement animation
     */
    queueTilePlacementAnimation(q, r, color, onComplete) {
        if (!this.animationsEnabled) {
            if (onComplete) onComplete();
            return;
        }

        this.activeAnimations.push({
            type: 'tilePlacement',
            q, r, color,
            startTime: performance.now(),
            duration: this.animationDuration,
            progress: 0,
            onComplete
        });
    }

    /**
     * Queue piece placement animation
     */
    queuePiecePlacementAnimation(q, r, piece, onComplete) {
        if (!this.animationsEnabled) {
            if (onComplete) onComplete();
            return;
        }

        this.activeAnimations.push({
            type: 'piecePlacement',
            q, r,
            piece: { ...piece },
            startTime: performance.now(),
            duration: this.animationDuration,
            progress: 0,
            onComplete
        });
    }

    /**
     * Check if animations are playing
     */
    isAnimating() {
        return this.activeAnimations.length > 0;
    }

    /**
     * Clear all animations
     */
    clearAnimations() {
        this.activeAnimations = [];
        this.animationCallbacks = [];
    }

    /**
     * Add callback for when all animations complete
     */
    onAllAnimationsComplete(callback) {
        if (this.activeAnimations.length === 0) {
            callback();
        } else {
            this.animationCallbacks.push(callback);
        }
    }

    // ==================== Drawing Functions ====================

    /**
     * Clear the canvas
     */
    clear() {
        const rect = this.canvas.getBoundingClientRect();
        this.ctx.clearRect(0, 0, rect.width, rect.height);
    }

    /**
     * Main render function
     */
    render() {
        if (!this.getGameState) return;
        
        const state = this.getGameState();
        this.clear();
        this.drawBoard(state);
    }

    /**
     * Draw the complete board
     */
    drawBoard(state) {
        const scheme = COLOR_SCHEMES[this.colorScheme];
        
        // Draw tiles
        for (const [key, color] of Object.entries(state.tiles || {})) {
            const [q, r] = key.split(',').map(Number);
            
            // Check if this tile is being animated
            const tilePlacementAnim = this.activeAnimations.find(
                a => a.type === 'tilePlacement' && a.q === q && a.r === r
            );
            
            if (tilePlacementAnim) {
                const scale = tilePlacementAnim.progress;
                this.drawTile(q, r, color, scale);
            } else {
                this.drawTile(q, r, color, 1);
            }
        }

        // Draw previous move highlight
        if (state.lastMove && state.metadata?.showPreviousMove !== false) {
            this.drawPreviousMoveHighlight(state.lastMove);
        }

        // Draw selection highlight
        if (state.metadata?.selection) {
            const { q, r } = state.metadata.selection;
            this.drawHighlight(q, r, this.colors.highlight);
        }

        // Draw valid moves
        if (state.metadata?.validMoves && state.metadata?.showValidMoves !== false) {
            for (const move of state.metadata.validMoves) {
                const color = move.isCapture ? this.colors.capture : this.colors.moveDot;
                this.drawMoveDot(move.q, move.r, color);
            }
        }

        // Draw pieces (excluding animated ones)
        const animatingPieceKeys = new Set();
        this.activeAnimations.forEach(anim => {
            if (anim.type === 'move') {
                animatingPieceKeys.add(`${anim.fromQ},${anim.fromR}`);
            }
            if (anim.type === 'capture' || anim.type === 'piecePlacement') {
                animatingPieceKeys.add(`${anim.q},${anim.r}`);
            }
        });

        for (const [key, piece] of Object.entries(state.pieces || {})) {
            if (animatingPieceKeys.has(key)) continue;
            
            const [q, r] = key.split(',').map(Number);
            this.drawPiece(q, r, piece, 1);
        }

        // Draw animations
        this.drawAnimations();

        // Draw dragged piece
        if (state.metadata?.dragState) {
            const { piece, x, y } = state.metadata.dragState;
            this.drawPieceAt(x, y, piece, 1.1, 0.8);
        }

        // Draw multi-jump indicator (end turn button area)
        if (state.metadata?.multiJumping) {
            this.drawMultiJumpIndicator(state.metadata.multiJumpPos);
        }
    }

    /**
     * Draw animations
     */
    drawAnimations() {
        for (const anim of this.activeAnimations) {
            if (anim.type === 'move') {
                const fromPos = this.hexToPixel(anim.fromQ, anim.fromR);
                const toPos = this.hexToPixel(anim.toQ, anim.toR);
                const x = this.lerp(fromPos.x, toPos.x, anim.progress);
                const y = this.lerp(fromPos.y, toPos.y, anim.progress);
                this.drawPieceAt(x, y, anim.piece, 1, 1);
            } else if (anim.type === 'capture') {
                const opacity = 1 - anim.progress;
                const scale = 1 - anim.progress * 0.3;
                const { x, y } = this.hexToPixel(anim.q, anim.r);
                this.drawPieceAt(x, y, anim.piece, scale, opacity);
            } else if (anim.type === 'piecePlacement') {
                const scale = anim.progress;
                const { x, y } = this.hexToPixel(anim.q, anim.r);
                this.drawPieceAt(x, y, anim.piece, scale, 1);
            }
        }
    }

    /**
     * Draw a filled tile
     */
    drawTile(q, r, color, scale = 1) {
        const { x, y } = this.hexToPixel(q, r);
        const scheme = COLOR_SCHEMES[this.colorScheme];
        const size = this.hexSize * scale;

        this.ctx.save();
        this.ctx.beginPath();
        for (let i = 0; i < 6; i++) {
            const angle = Math.PI / 3 * i + Math.PI / 6;
            const hx = x + size * Math.cos(angle);
            const hy = y + size * Math.sin(angle);
            if (i === 0) this.ctx.moveTo(hx, hy);
            else this.ctx.lineTo(hx, hy);
        }
        this.ctx.closePath();
        
        this.ctx.fillStyle = scheme[color];
        this.ctx.shadowColor = 'rgba(0,0,0,0.3)';
        this.ctx.shadowBlur = 6;
        this.ctx.fill();
        
        this.ctx.lineWidth = 3;
        this.ctx.strokeStyle = this.colorScheme === 'classic' ? '#b08b4f' : '#888';
        this.ctx.stroke();
        this.ctx.restore();
    }

    /**
     * Draw a piece at hex position
     */
    drawPiece(q, r, piece, scale = 1, opacity = 1) {
        const { x, y } = this.hexToPixel(q, r);
        this.drawPieceAt(x, y, piece, scale, opacity);
    }

    /**
     * Draw a piece at pixel position
     */
    drawPieceAt(x, y, piece, scale = 1, opacity = 1) {
        const radius = this.hexSize * 0.45 * scale;
        
        this.ctx.save();
        this.ctx.globalAlpha = opacity;

        if (piece.type === 'disc') {
            this.ctx.beginPath();
            this.ctx.arc(x, y, radius, 0, 2 * Math.PI);
            this.ctx.fillStyle = piece.color === 'black' 
                ? (this.colorScheme === 'classic' ? '#222' : '#000')
                : (this.colorScheme === 'classic' ? '#fafafa' : '#fff');
            this.ctx.shadowColor = 'rgba(0,0,0,0.4)';
            this.ctx.shadowBlur = 4;
            this.ctx.fill();
            this.ctx.lineWidth = 2;
            this.ctx.strokeStyle = piece.color === 'black' ? '#888' : '#bbb';
            this.ctx.stroke();
        } else if (piece.type === 'ring') {
            this.ctx.beginPath();
            this.ctx.arc(x, y, radius, 0, 2 * Math.PI);
            this.ctx.lineWidth = 7 * scale;
            this.ctx.strokeStyle = piece.color === 'black'
                ? (this.colorScheme === 'classic' ? '#222' : '#000')
                : (this.colorScheme === 'classic' ? '#fafafa' : '#fff');
            this.ctx.shadowColor = 'rgba(0,0,0,0.4)';
            this.ctx.shadowBlur = 4;
            this.ctx.stroke();

            // Inner ring
            this.ctx.beginPath();
            this.ctx.arc(x, y, radius * 0.7, 0, 2 * Math.PI);
            this.ctx.lineWidth = 1.5;
            this.ctx.strokeStyle = '#bbb';
            this.ctx.shadowBlur = 0;
            this.ctx.stroke();

            // Outer ring
            this.ctx.beginPath();
            this.ctx.arc(x, y, radius * 1.3, 0, 2 * Math.PI);
            this.ctx.stroke();
        }

        this.ctx.restore();
    }

    /**
     * Draw selection highlight
     */
    drawHighlight(q, r, color) {
        const { x, y } = this.hexToPixel(q, r);

        this.ctx.beginPath();
        for (let i = 0; i < 6; i++) {
            const angle = Math.PI / 3 * i + Math.PI / 6;
            const hx = x + this.hexSize * Math.cos(angle);
            const hy = y + this.hexSize * Math.sin(angle);
            if (i === 0) this.ctx.moveTo(hx, hy);
            else this.ctx.lineTo(hx, hy);
        }
        this.ctx.closePath();
        this.ctx.fillStyle = color;
        this.ctx.fill();
    }

    /**
     * Draw valid move dot
     */
    drawMoveDot(q, r, color) {
        const { x, y } = this.hexToPixel(q, r);
        this.ctx.beginPath();
        this.ctx.arc(x, y, this.hexSize * 0.2, 0, Math.PI * 2);
        this.ctx.fillStyle = color;
        this.ctx.fill();
    }

    /**
     * Draw previous move highlight
     */
    drawPreviousMoveHighlight(lastMove) {
        if (lastMove.from) {
            this.drawHighlight(lastMove.from.q, lastMove.from.r, this.colors.previousMove);
        }
        if (lastMove.to) {
            this.drawHighlight(lastMove.to.q, lastMove.to.r, this.colors.previousMove);
        }
        // Jump path
        if (lastMove.jumpPath) {
            for (const pos of lastMove.jumpPath) {
                this.drawHighlight(pos.q, pos.r, 'rgba(255, 200, 0, 0.15)');
            }
        }
    }

    /**
     * Draw multi-jump indicator
     */
    drawMultiJumpIndicator(pos) {
        if (!pos) return;
        
        const { x, y } = this.hexToPixel(pos.q, pos.r);
        
        // Pulsing glow effect
        this.ctx.save();
        this.ctx.beginPath();
        this.ctx.arc(x, y, this.hexSize * 0.8, 0, Math.PI * 2);
        this.ctx.strokeStyle = 'rgba(100, 255, 100, 0.6)';
        this.ctx.lineWidth = 3;
        this.ctx.stroke();
        this.ctx.restore();
    }

    /**
     * Convert hex coordinates to pixel coordinates
     */
    hexToPixel(q, r, hexSize, offsetX, offsetY) {
        const x = hexSize * (Math.sqrt(3) * q + Math.sqrt(3) / 2 * r) + offsetX;
        const y = hexSize * (3 / 2 * r) + offsetY;
        return { x, y };
    }

    /**
     * Convert pixel coordinates to hex coordinates
     */
    pixelToHex(x, y, hexSize, offsetX, offsetY) {
        const px = x - offsetX;
        const py = y - offsetY;

        const q = (Math.sqrt(3) / 3 * px - 1 / 3 * py) / hexSize;
        const r = (2 / 3 * py) / hexSize;

        // Round to nearest hex
        return this.roundHex(q, r);
    }

    /**
     * Round floating point hex coordinates to nearest integer hex
     */
    roundHex(q, r) {
        const s = -q - r;

        let rq = Math.round(q);
        let rr = Math.round(r);
        let rs = Math.round(s);

        const qDiff = Math.abs(rq - q);
        const rDiff = Math.abs(rr - r);
        const sDiff = Math.abs(rs - s);

        if (qDiff > rDiff && qDiff > sDiff) {
            rq = -rr - rs;
        } else if (rDiff > sDiff) {
            rr = -rq - rs;
        }

        return { q: rq, r: rr };
    }

    /**
     * Queue an animation
     */
    queueAnimation(animation) {
        this.animationQueue.push(animation);
        if (!this.isAnimating) {
            this.playNextAnimation();
        }
    }

    /**
     * Play next animation in queue
     */
    playNextAnimation() {
        if (this.animationQueue.length === 0) {
            this.isAnimating = false;
            return;
        }

        this.isAnimating = true;
        const animation = this.animationQueue.shift();
        
        // Execute animation (implementation depends on animation type)
        setTimeout(() => {
            this.playNextAnimation();
        }, animation.duration || 250);
    }
}

export default CanvasGraphics;
