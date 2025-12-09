const SQRT3 = Math.sqrt(3);

export function createCanvasGraphics(canvas, options = {}) {
    if (!canvas) {
        throw new Error('createCanvasGraphics requires a canvas element');
    }

    const ctx = canvas.getContext('2d');
    const hexSize = options.hexSize ?? 36;
    let lastState = null;

    function renderStatic(state) {
        if (!ctx || !state) return;
        lastState = state;

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.save();
        ctx.translate(canvas.width / 2, canvas.height / 2);
        drawTiles(ctx, state.tiles, hexSize);
        drawPieces(ctx, state.pieces, state.tiles, hexSize);
        ctx.restore();
    }

    const logEvent = (type, payload) => {
        if (options.verbose) {
            console.log(`[CanvasGraphics] ${type}`, payload);
        }
    };

    return {
        renderStatic,
        queueTilePlacementAnimation(q, r, color) {
            logEvent('tile-placement', { q, r, color });
        },
        queuePiecePlacementAnimation(q, r, piece) {
            logEvent('piece-placement', { q, r, piece });
        },
        queueJumpSequenceWithCaptures(path, piece, captures = []) {
            logEvent('jump-sequence', { path, piece, captures });
        },
        queueSingleMoveWithCapture(fromQ, fromR, toQ, toR, piece, captures = []) {
            logEvent('move-with-captures', { fromQ, fromR, toQ, toR, piece, captures });
        },
        queueMoveAnimation(fromQ, fromR, toQ, toR, piece) {
            logEvent('move', { fromQ, fromR, toQ, toR, piece });
        },
        queueCaptureAnimation(q, r, piece) {
            logEvent('capture', { q, r, piece });
        }
    };
}

function drawTiles(ctx, tiles = {}, size) {
    for (const [key, color] of Object.entries(tiles)) {
        if (!color) continue;
        const [q, r] = parseKey(key);
        const { x, y } = axialToPixel(q, r, size);
        ctx.save();
        ctx.translate(x, y);
        ctx.beginPath();
        hexPath(ctx, size);
        ctx.fillStyle = color === 'black' ? '#1f2937' : '#f9fafb';
        ctx.strokeStyle = '#6b7280';
        ctx.lineWidth = 1.5;
        ctx.fill();
        ctx.stroke();
        ctx.restore();
    }
}

function drawPieces(ctx, pieces = {}, tiles = {}, size) {
    for (const [key, piece] of Object.entries(pieces)) {
        if (!piece || !tiles[key]) continue;
        const [q, r] = parseKey(key);
        const { x, y } = axialToPixel(q, r, size);
        ctx.save();
        ctx.translate(x, y);
        ctx.beginPath();
        ctx.fillStyle = piece.color === 'black' ? '#111827' : '#fef3c7';
        ctx.strokeStyle = piece.type === 'ring' ? '#d97706' : '#f8fafc';
        ctx.lineWidth = piece.type === 'ring' ? 4 : 2;
        ctx.globalAlpha = piece.type === 'ring' ? 0.85 : 1;
        const radius = piece.type === 'ring' ? size * 0.45 : size * 0.35;
        ctx.arc(0, 0, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
    }
}

function axialToPixel(q, r, size) {
    return {
        x: size * (SQRT3 * q + (SQRT3 / 2) * r),
        y: size * (1.5 * r)
    };
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
