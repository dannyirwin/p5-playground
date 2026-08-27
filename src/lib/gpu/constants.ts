/** Re-export population constants from the shared leaf module. */
export {
	DEFAULT_BOID_COUNT,
	DEFAULT_GPU_BOID_COUNT,
	MIN_BOID_COUNT,
	MAX_BOID_COUNT,
	clampBoidCount
} from '../boids/boidCount.ts';

/** Max grid cells (128px cells on up to ~4096 canvas). Re-exported from gpuGrid. */
export { GPU_MAX_GRID_CELLS } from './compute/gpuGrid.ts';
