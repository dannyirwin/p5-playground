import type p5 from 'p5';
import { createP5DronePlayer } from './dronePlayer.ts';
import type { InstrumentPlayer } from '../../types.ts';

export function createStringsPlayer(p: p5): InstrumentPlayer {
	return createP5DronePlayer(p, {
		id: 'strings',
		softOnset: true,
		quickRelease: false,
		simDrivenIntensity: false,
		conversionPings: false
	});
}

export function createBoidsPlayer(p: p5): InstrumentPlayer {
	return createP5DronePlayer(p, {
		id: 'boids',
		softOnset: true,
		quickRelease: true,
		simDrivenIntensity: true,
		conversionPings: true
	});
}

export type { P5DronePlayer } from './dronePlayer.ts';
