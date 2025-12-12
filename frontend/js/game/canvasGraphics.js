/**
 * Canvas Graphics - Hardware-accelerated rendering engine
 * 
 * Handles all canvas drawing operations for the hex board.
 */

/**
 * Canvas Graphics Class
 */
export class CanvasGraphics {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.animationQueue = [];
        this.isAnimating = false;

        // Colors (will be loaded from CSS custom properties)
        this.colors = {
            tileDark: '#1a1a2e',
            tileLight: '#f0e6d3',
            discDark: '#2d2d44',
            discLight: '#e8dcc8',
            ringDark: '#4a4a6a',
            ringLight: '#d4c4a8',
            outline: '#666',
            highlight: 'rgba(100, 200, 255, 0.4)',
            moveDot: 'rgba(100, 200, 100, 0.6)',
            capture: 'rgba(255, 100, 100, 0.6)'
        };

        this.setupCanvas();
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

        // Set canvas CSS size
        this.canvas.style.width = `${rect.width}px`;
        this.canvas.style.height = `${rect.height}px`;
    }

    /**
     * Clear the canvas
     */
    clear() {
        const rect = this.canvas.getBoundingClientRect();
        this.ctx.clearRect(0, 0, rect.width, rect.height);
    }

    /**
     * Render the game board
     */
    renderBoard(state, options) {
        const { hexSize, offsetX, offsetY } = options;

        // Draw tiles
        for (const [key, color] of Object.entries(state.tiles)) {
            const [q, r] = key.split(',').map(Number);
            this.drawHexTile(q, r, color, hexSize, offsetX, offsetY);
        }

        // Draw pieces
        for (const [key, piece] of Object.entries(state.pieces)) {
            const [q, r] = key.split(',').map(Number);
            this.drawPiece(q, r, piece, hexSize, offsetX, offsetY);
        }

        // Draw selection highlight
        if (state.metadata?.selection) {
            const { q, r } = state.metadata.selection;
            this.drawHighlight(q, r, this.colors.highlight, hexSize, offsetX, offsetY);
        }

        // Draw valid moves
        if (state.metadata?.validMoves) {
            for (const move of state.metadata.validMoves) {
                const color = move.isJump ? this.colors.capture : this.colors.moveDot;
                this.drawMoveDot(move.q, move.r, color, hexSize, offsetX, offsetY);
            }
        }

        // Draw drag preview
        if (state.metadata?.dragState) {
            const { piece, x, y } = state.metadata.dragState;
            this.drawPieceAt(x, y, piece, hexSize * 1.2);
        }
    }

    /**
     * Draw a hexagonal tile
     */
    drawHexTile(q, r, color, hexSize, offsetX, offsetY) {
        const { x, y } = this.hexToPixel(q, r, hexSize, offsetX, offsetY);
        const fillColor = color === 'black' ? this.colors.tileDark : this.colors.tileLight;

        this.ctx.beginPath();
        for (let i = 0; i < 6; i++) {
            const angle = (Math.PI / 3) * i - Math.PI / 6;
            const hx = x + hexSize * Math.cos(angle);
            const hy = y + hexSize * Math.sin(angle);
            if (i === 0) {
                this.ctx.moveTo(hx, hy);
            } else {
                this.ctx.lineTo(hx, hy);
            }
        }
        this.ctx.closePath();

        this.ctx.fillStyle = fillColor;
        this.ctx.fill();

        this.ctx.strokeStyle = this.colors.outline;
        this.ctx.lineWidth = 1;
        this.ctx.stroke();
    }

    /**
     * Draw a piece at hex position
     */
    drawPiece(q, r, piece, hexSize, offsetX, offsetY) {
        const { x, y } = this.hexToPixel(q, r, hexSize, offsetX, offsetY);
        this.drawPieceAt(x, y, piece, hexSize);
    }

    /**
     * Draw a piece at pixel position
     */
    drawPieceAt(x, y, piece, hexSize) {
        const radius = hexSize * 0.6;

        if (piece.type === 'disc') {
            // Draw disc
            this.ctx.beginPath();
            this.ctx.arc(x, y, radius, 0, Math.PI * 2);
            this.ctx.fillStyle = piece.color === 'black' ? this.colors.discDark : this.colors.discLight;
            this.ctx.fill();
            this.ctx.strokeStyle = this.colors.outline;
            this.ctx.lineWidth = 2;
            this.ctx.stroke();
        } else if (piece.type === 'ring') {
            // Draw ring
            this.ctx.beginPath();
            this.ctx.arc(x, y, radius, 0, Math.PI * 2);
            this.ctx.strokeStyle = piece.color === 'black' ? this.colors.ringDark : this.colors.ringLight;
            this.ctx.lineWidth = radius * 0.3;
            this.ctx.stroke();

            // Inner outline
            this.ctx.beginPath();
            this.ctx.arc(x, y, radius * 0.7, 0, Math.PI * 2);
            this.ctx.strokeStyle = this.colors.outline;
            this.ctx.lineWidth = 1;
            this.ctx.stroke();
        }
    }

    /**
     * Draw selection highlight
     */
    drawHighlight(q, r, color, hexSize, offsetX, offsetY) {
        const { x, y } = this.hexToPixel(q, r, hexSize, offsetX, offsetY);

        this.ctx.beginPath();
        for (let i = 0; i < 6; i++) {
            const angle = (Math.PI / 3) * i - Math.PI / 6;
            const hx = x + hexSize * Math.cos(angle);
            const hy = y + hexSize * Math.sin(angle);
            if (i === 0) {
                this.ctx.moveTo(hx, hy);
            } else {
                this.ctx.lineTo(hx, hy);
            }
        }
        this.ctx.closePath();

        this.ctx.fillStyle = color;
        this.ctx.fill();
    }

    /**
     * Draw valid move indicator
     */
    drawMoveDot(q, r, color, hexSize, offsetX, offsetY) {
        const { x, y } = this.hexToPixel(q, r, hexSize, offsetX, offsetY);

        this.ctx.beginPath();
        this.ctx.arc(x, y, hexSize * 0.2, 0, Math.PI * 2);
        this.ctx.fillStyle = color;
        this.ctx.fill();
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
