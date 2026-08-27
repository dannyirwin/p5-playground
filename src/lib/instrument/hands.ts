/** Hand tracking snapshots — coordinate space is defined by the capture adapter. */

export interface HandKeypoint {
	x: number;
	y: number;
}

export interface HandSnapshot {
	handedness: string;
	keypoints: HandKeypoint[];
}
