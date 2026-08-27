/** Toroidal shortest delta on a wrapped axis. */
export function wrapDelta(delta: number, size: number): number {
	const half = size / 2;
	if (delta > half) return delta - size;
	if (delta < -half) return delta + size;
	return delta;
}

/** Map a coordinate onto [0, size). */
export function wrapPosition(value: number, size: number): number {
	if (size <= 0) return value;
	return ((value % size) + size) % size;
}

/** Shortest vector from (ax,ay) → (bx,by) on a torus. */
export function wrapOffset(
	ax: number,
	ay: number,
	bx: number,
	by: number,
	width: number,
	height: number
): { x: number; y: number } {
	return {
		x: wrapDelta(bx - ax, width),
		y: wrapDelta(by - ay, height)
	};
}

/** Toroidal distance between two points. */
export function wrapDist(
	ax: number,
	ay: number,
	bx: number,
	by: number,
	width: number,
	height: number
): number {
	const o = wrapOffset(ax, ay, bx, by, width, height);
	return Math.hypot(o.x, o.y);
}

/** Target average boids per cell on CPU spatial hash (finer grid → less square clumping). */
export function computeSpatialCellSize(
	width: number,
	height: number,
	boidCount: number,
	maxNeighborRadius: number
): number {
	const targetPerCell = 8;
	const area = Math.max(1, width * height);
	const ideal = Math.sqrt(area / Math.max(1, boidCount / targetPerCell));
	let cellSize = Math.max(32, Math.min(maxNeighborRadius, Math.floor(ideal)));
	// Prefer a size that tiles the canvas so the last row/col isn't a skinny remnant.
	return snapCellSizeToCanvas(cellSize, width, height, 32, maxNeighborRadius);
}

/** Nudge cell size toward a near-divisor of both axes (reduces edge strip artifacts). */
export function snapCellSizeToCanvas(
	ideal: number,
	width: number,
	height: number,
	minSize: number,
	maxSize: number
): number {
	const lo = Math.max(minSize, Math.floor(ideal * 0.82));
	const hi = Math.min(maxSize, Math.ceil(ideal * 1.18));
	let best = Math.max(minSize, Math.min(maxSize, Math.floor(ideal)));
	let bestScore = Number.POSITIVE_INFINITY;
	for (let cs = lo; cs <= hi; cs++) {
		const remW = width % cs;
		const remH = height % cs;
		// Prefer exact tiling; otherwise minimize leftover strip size.
		const score =
			(remW === 0 ? 0 : cs - remW) +
			(remH === 0 ? 0 : cs - remH) +
			Math.abs(cs - ideal) * 0.15;
		if (score < bestScore) {
			bestScore = score;
			best = cs;
		}
	}
	return best;
}

/** 1 at center → 0 at radius (smoothstep — circular-ish influence edge). */
export function radialFalloff(distSq: number, radiusSq: number): number {
	if (distSq >= radiusSq || radiusSq <= 0) return 0;
	const u = 1 - distSq / radiusSq;
	return u * u * (3 - 2 * u);
}

const CELL_HALF_DIAG = 0.7071067811865476;

/**
 * Broad-phase: skip grid cells whose toroidal AABB cannot intersect the query disc.
 * Uses *unwrapped* lattice coordinates so wrapDelta sees the correct periodic image
 * (wrapping cell indices before centering breaks when the grid does not tile evenly).
 */
export function cellMayIntersectDisc(
	queryX: number,
	queryY: number,
	cellCx: number,
	cellCy: number,
	cellSize: number,
	radius: number,
	width: number,
	height: number
): boolean {
	const centerX = (cellCx + 0.5) * cellSize;
	const centerY = (cellCy + 0.5) * cellSize;
	const dx = wrapDelta(centerX - queryX, width);
	const dy = wrapDelta(centerY - queryY, height);
	const reach = radius + cellSize * CELL_HALF_DIAG;
	return dx * dx + dy * dy <= reach * reach;
}
