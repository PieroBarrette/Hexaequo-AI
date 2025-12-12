/**
 * Board Renderer - Bridges game state to graphics
 */

/**
 * Board Renderer Class
 */
export class BoardRenderer {
    constructor(canvasGraphics, gameStore) {
        this.graphics = canvasGraphics;
        this.gameStore = gameStore;
        this.hexSize = 40;
        this.offsetX = 0;
        this.offsetY = 0;
    }

    /**
     * Render the current game state
     */
    render(state) {
        if (!this.graphics) return;

        this.graphics.clear();
        this.graphics.renderBoard(state, {
            hexSize: this.hexSize,
            offsetX: this.offsetX,
            offsetY: this.offsetY
        });
    }

    /**
     * Convert pixel coordinates to hex coordinates
     */
    pixelToHex(x, y) {
        if (!this.graphics) return null;
        return this.graphics.pixelToHex(x, y, this.hexSize, this.offsetX, this.offsetY);
    }

    /**
     * Convert hex coordinates to pixel coordinates
     */
    hexToPixel(q, r) {
        if (!this.graphics) return null;
        return this.graphics.hexToPixel(q, r, this.hexSize, this.offsetX, this.offsetY);
    }

    /**
     * Update hex size and offsets
     */
    updateLayout(hexSize, offsetX, offsetY) {
        this.hexSize = hexSize;
        this.offsetX = offsetX;
        this.offsetY = offsetY;
    }

    /**
     * Queue animation
     */
    queueAnimation(animation) {
        if (this.graphics) {
            this.graphics.queueAnimation(animation);
        }
    }
}

export default BoardRenderer;
