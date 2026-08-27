import { snapCellSizeToCanvas } from '../../boids/neighborKernel.ts';

/** Max boids stored per spatial-hash cell on GPU. */
export const GPU_MAX_PER_CELL = 64;

/** Upper bound on grid cells (cellCounts / cellIndices buffer size). */
export const GPU_MAX_GRID_CELLS = 64 * 64;

export const GPU_MIN_CELL_SIZE = 24;
export const GPU_MAX_CELL_SIZE = 80;

/** Lower fill → finer cells → fewer overflow truncations (less square clumping). */
const TARGET_CELL_FILL = 0.38;

/**
 * Pick a cell size that keeps average occupancy under {@link GPU_MAX_PER_CELL}
 * and total cells within {@link GPU_MAX_GRID_CELLS}.
 */
export function computeGpuCellSize(
	width: number,
	height: number,
	boidCount: number,
	maxNeighborRadius: number
): number {
	const area = Math.max(1, width * height);
	const idealArea = area / Math.max(1, boidCount / (GPU_MAX_PER_CELL * TARGET_CELL_FILL));
	let cellSize = Math.floor(Math.sqrt(idealArea));
	cellSize = Math.min(maxNeighborRadius, Math.max(GPU_MIN_CELL_SIZE, cellSize));

	for (let attempt = 0; attempt < 32; attempt++) {
		const snapped = snapCellSizeToCanvas(
			cellSize,
			width,
			height,
			GPU_MIN_CELL_SIZE,
			Math.min(GPU_MAX_CELL_SIZE, maxNeighborRadius)
		);
		const cols = Math.max(1, Math.ceil(width / snapped));
		const rows = Math.max(1, Math.ceil(height / snapped));
		const cells = cols * rows;
		const avg = boidCount / cells;
		if (cells <= GPU_MAX_GRID_CELLS && avg <= GPU_MAX_PER_CELL * TARGET_CELL_FILL) {
			return snapped;
		}
		cellSize = Math.max(GPU_MIN_CELL_SIZE, cellSize - 3);
	}
	return snapCellSizeToCanvas(
		GPU_MIN_CELL_SIZE,
		width,
		height,
		GPU_MIN_CELL_SIZE,
		GPU_MAX_CELL_SIZE
	);
}

export function gpuGridDims(
	width: number,
	height: number,
	cellSize: number
): { cols: number; rows: number; cells: number } {
	const cols = Math.max(1, Math.ceil(width / cellSize));
	const rows = Math.max(1, Math.ceil(height / cellSize));
	return { cols, rows, cells: cols * rows };
}
