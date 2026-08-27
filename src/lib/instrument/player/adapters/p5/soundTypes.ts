import type p5 from 'p5';

export interface SoundConnectable {
	disconnect: () => void;
	connect: (unit: SoundConnectable) => void;
}

export interface SoundFilter extends SoundConnectable {
	freq: (value: number, rampTime?: number) => void;
	res: (value: number) => void;
}

export interface SoundOscillator {
	disconnect: () => void;
	connect: (unit: SoundConnectable) => void;
	freq: (value: number, rampTime?: number) => void;
	amp: (value: number, rampTime?: number, timeFromNow?: number) => void;
	start: () => void;
	stop: () => void;
}

export interface SoundDistortion extends SoundConnectable {
	set: (amount: number, oversample?: string) => void;
	amp: (value: number) => void;
}

export interface SoundReverb {
	process: (src: SoundConnectable, seconds?: number, decayRate?: number) => void;
	drywet: (value: number) => void;
	amp: (value: number) => void;
}

export interface P5SoundConstructors {
	Filter: new (type: string) => SoundFilter;
	Oscillator: new (type: string) => SoundOscillator;
	Reverb: new () => SoundReverb;
	Distortion?: new (amount?: number, oversample?: string) => SoundDistortion;
}

export type P5WithSound = p5 & {
	userStartAudio: () => Promise<void>;
	getAudioContext?: () => AudioContext;
};

/** p5.sound attaches Oscillator/Filter to the global p5 constructor (CDN addon). */
export function resolveP5SoundRoot(): P5SoundConstructors {
	if (typeof window === 'undefined') {
		throw new Error('p5.sound requires a browser');
	}
	const root = (window as unknown as { p5?: typeof p5 & Partial<P5SoundConstructors> }).p5;
	if (root?.Oscillator && root?.Filter && root?.Reverb) {
		return root as P5SoundConstructors;
	}
	throw new Error('p5.sound not loaded — call loadBrowserSketchDeps() first');
}

export function isP5SoundLoaded(): boolean {
	if (typeof window === 'undefined') return false;
	const root = (window as unknown as { p5?: Partial<P5SoundConstructors> }).p5;
	return Boolean(root?.Oscillator && root?.Filter && root?.Reverb);
}

export function soundCtors(_P5: typeof p5): P5SoundConstructors {
	return resolveP5SoundRoot();
}
