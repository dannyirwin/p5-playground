export interface WebGpuCapabilities {
	adapter: unknown;
	device: unknown;
}

/** Returns a WebGPU device when the browser supports it. */
export async function detectWebGPU(): Promise<WebGpuCapabilities | null> {
	if (typeof navigator === 'undefined') return null;
	const gpu = (navigator as Navigator & { gpu?: { requestAdapter: (opts?: object) => Promise<unknown> } }).gpu;
	if (!gpu) return null;
	try {
		const adapter = (await gpu.requestAdapter({ powerPreference: 'high-performance' })) as {
			requestDevice: () => Promise<unknown>;
		} | null;
		if (!adapter) return null;
		const device = await adapter.requestDevice();
		return { adapter, device };
	} catch {
		return null;
	}
}

export function isWebGPUSupported(): boolean {
	return (
		typeof navigator !== 'undefined' &&
		Boolean((navigator as Navigator & { gpu?: unknown }).gpu)
	);
}
