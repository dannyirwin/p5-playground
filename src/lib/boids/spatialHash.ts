import { cellMayIntersectDisc } from './neighborKernel.ts';

/**
 * Uniform grid spatial hash for O(n) neighbor queries on a wrapped canvas.
 * Queries wrap cell indices; no edge-ghost inserts (ghosts inflated edge cells
 * and caused square packing / GPU spill artifacts).
 */
export class BoidSpatialHash {
	private cellSize = 128;
	private cols = 1;
	private rows = 1;
	private width = 1;
	private height = 1;
	private cells: number[][] = [];

	rebuild(
		boids: readonly { x: number; y: number }[],
		width: number,
		height: number,
		cellSize: number,
		_neighborRadius = cellSize
	): void {
		this.width = width;
		this.height = height;
		this.cellSize = Math.max(8, cellSize);
		this.cols = Math.max(1, Math.ceil(width / this.cellSize));
		this.rows = Math.max(1, Math.ceil(height / this.cellSize));

		const cellCount = this.cols * this.rows;
		if (this.cells.length !== cellCount) {
			this.cells = Array.from({ length: cellCount }, () => []);
		} else {
			for (let c = 0; c < cellCount; c++) this.cells[c]!.length = 0;
		}

		for (let i = 0; i < boids.length; i++) {
			const boid = boids[i]!;
			this.insert(i, boid.x, boid.y);
		}
	}

	/** Collect boid indices in cells overlapping the query disc. */
	queryIndices(x: number, y: number, radius: number, out: number[]): void {
		out.length = 0;
		const cs = this.cellSize;
		const cx = Math.floor(x / cs);
		const cy = Math.floor(y / cs);
		const span = Math.ceil(radius / cs);

		for (let dy = -span; dy <= span; dy++) {
			for (let dx = -span; dx <= span; dx++) {
				if (
					!cellMayIntersectDisc(
						x,
						y,
						cx + dx,
						cy + dy,
						cs,
						radius,
						this.width,
						this.height
					)
				) {
					continue;
				}
				const bucket = this.cells[this.cellIndex(cx + dx, cy + dy)];
				if (!bucket) continue;
				for (let k = 0; k < bucket.length; k++) out.push(bucket[k]!);
			}
		}
	}

	private cellIndex(cx: number, cy: number): number {
		cx = ((cx % this.cols) + this.cols) % this.cols;
		cy = ((cy % this.rows) + this.rows) % this.rows;
		return cy * this.cols + cx;
	}

	private insert(i: number, x: number, y: number): void {
		const cs = this.cellSize;
		const cx = Math.floor(x / cs);
		const cy = Math.floor(y / cs);
		this.cells[this.cellIndex(cx, cy)]!.push(i);
	}
}
