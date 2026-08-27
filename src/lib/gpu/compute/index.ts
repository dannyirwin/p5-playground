import type { BoidsParams } from '../../sketch/renderers/boidsParams.ts';
import { createGpuBoidsRenderer, type GpuBoidsRenderer } from '../renderers/gpuBoids.ts';

export type GpuSimBackend = 'cpu' | 'webgpu';

/** GPU boids renderer — auto-selects WebGPU compute when available. */
export function createGpuBoidsRendererWithBackend(
	initialParams?: BoidsParams,
	_preferred: GpuSimBackend = 'webgpu'
): GpuBoidsRenderer {
	return createGpuBoidsRenderer(initialParams);
}

export { isWebGPUSupported, detectWebGPU } from './detectWebGPU.ts';
