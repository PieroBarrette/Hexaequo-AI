const SQRT3 = Math.sqrt(3);

export function axialToPixel(q, r, size) {
    return {
        x: size * (SQRT3 * q + (SQRT3 / 2) * r),
        y: size * (1.5 * r)
    };
}

export function pixelToAxial(x, y, size) {
    const q = ((SQRT3 / 3) * x - (1 / 3) * y) / size;
    const r = ((2 / 3) * y) / size;
    return hexRound(q, r);
}

function hexRound(q, r) {
    let s = -q - r;

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
