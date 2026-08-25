import type p5 from 'p5';
import type { InstrumentFrame, Renderer } from '../types.ts';

interface Boid {
	x: number;
	y: number;
	vx: number;
	vy: number;
}

/**
 * Flocking weights and radii in canvas pixels. Speeds / forces are per
 * reference frame (see `FRAME_MS`), so the sim looks the same at any FPS.
 * Kept as one object so music hooks can later modulate it per frame.
 */
interface FlockParams {
	count: number;
	sep: number;
	ali: number;
	coh: number;
	sepRadius: number;
	aliRadius: number;
	cohRadius: number;
	maxSpeed: number;
	minSpeed: number;
	maxForce: number;
}

const FLOCK: FlockParams = {
	count: 150,
	sep: 1.6,
	ali: 1,
	coh: 0.85,
	sepRadius: 26,
	aliRadius: 58,
	cohRadius: 78,
	maxSpeed: 3.2,
	minSpeed: 1.1,
	maxForce: 0.11
};

/** Speeds / forces above are expressed per frame of this length. */
const FRAME_MS = 1000 / 60;
/** Tab-out and first-frame spikes would teleport boids across the canvas. */
const MAX_DELTA_MS = 50;
/** Triangle body: length along velocity, width across it. */
const BOID_LENGTH = 8;
const BOID_WIDTH = 5;

/** Shortest signed delta on a wrapped axis, so neighbours meet across edges. */
function wrapDelta(delta: number, size: number): number {
	const half = size / 2;
	if (delta > half) return delta - size;
	if (delta < -half) return delta + size;
	return delta;
}

function wrapPosition(value: number, size: number): number {
	if (size <= 0) return value;
	return ((value % size) + size) % size;
}

function limit(x: number, y: number, max: number): { x: number; y: number } {
	const mag = Math.hypot(x, y);
	if (mag <= max || mag === 0) return { x, y };
	const scale = max / mag;
	return { x: x * scale, y: y * scale };
}

/** Steer from a desired velocity toward the current one, force-limited. */
function steer(
	desiredX: number,
	desiredY: number,
	boid: Boid,
	weight: number
): { x: number; y: number } {
	const mag = Math.hypot(desiredX, desiredY);
	if (mag === 0) return { x: 0, y: 0 };
	const scale = FLOCK.maxSpeed / mag;
	const force = limit(
		desiredX * scale - boid.vx,
		desiredY * scale - boid.vy,
		FLOCK.maxForce
	);
	return { x: force.x * weight, y: force.y * weight };
}

/** Reynolds flocking on a torus: separation, alignment, cohesion. */
export function createBoidsRenderer(): Renderer {
	let boids: Boid[] = [];
	let accX: number[] = [];
	let accY: number[] = [];

	function seed(p: p5): void {
		boids = [];
		accX = [];
		accY = [];
		for (let i = 0; i < FLOCK.count; i++) {
			const angle = p.random(p.TWO_PI);
			const speed = p.random(FLOCK.minSpeed, FLOCK.maxSpeed);
			boids.push({
				x: p.random(p.width),
				y: p.random(p.height),
				vx: Math.cos(angle) * speed,
				vy: Math.sin(angle) * speed
			});
			accX.push(0);
			accY.push(0);
		}
	}

	function accumulateForces(width: number, height: number): void {
		const sepRadiusSq = FLOCK.sepRadius * FLOCK.sepRadius;
		const aliRadiusSq = FLOCK.aliRadius * FLOCK.aliRadius;
		const cohRadiusSq = FLOCK.cohRadius * FLOCK.cohRadius;

		for (let i = 0; i < boids.length; i++) {
			const boid = boids[i];
			let sepX = 0;
			let sepY = 0;
			let aliX = 0;
			let aliY = 0;
			let cohX = 0;
			let cohY = 0;
			let sepCount = 0;
			let aliCount = 0;
			let cohCount = 0;

			for (let j = 0; j < boids.length; j++) {
				if (j === i) continue;
				const other = boids[j];
				const dx = wrapDelta(other.x - boid.x, width);
				const dy = wrapDelta(other.y - boid.y, height);
				const distSq = dx * dx + dy * dy;
				if (distSq === 0) continue;

				if (distSq < sepRadiusSq) {
					// Push away harder the closer the neighbour is.
					sepX -= dx / distSq;
					sepY -= dy / distSq;
					sepCount++;
				}
				if (distSq < aliRadiusSq) {
					aliX += other.vx;
					aliY += other.vy;
					aliCount++;
				}
				if (distSq < cohRadiusSq) {
					cohX += dx;
					cohY += dy;
					cohCount++;
				}
			}

			let fx = 0;
			let fy = 0;
			if (sepCount > 0) {
				const force = steer(sepX, sepY, boid, FLOCK.sep);
				fx += force.x;
				fy += force.y;
			}
			if (aliCount > 0) {
				const force = steer(aliX, aliY, boid, FLOCK.ali);
				fx += force.x;
				fy += force.y;
			}
			if (cohCount > 0) {
				// Offsets are already relative to this boid, so their mean points
				// at the local centre of mass.
				const force = steer(cohX, cohY, boid, FLOCK.coh);
				fx += force.x;
				fy += force.y;
			}

			accX[i] = fx;
			accY[i] = fy;
		}
	}

	function integrate(width: number, height: number, steps: number): void {
		for (let i = 0; i < boids.length; i++) {
			const boid = boids[i];
			const velocity = limit(
				boid.vx + accX[i] * steps,
				boid.vy + accY[i] * steps,
				FLOCK.maxSpeed
			);
			boid.vx = velocity.x;
			boid.vy = velocity.y;

			// Keep the flock moving so it never settles into a static clump.
			const speed = Math.hypot(boid.vx, boid.vy);
			if (speed > 0 && speed < FLOCK.minSpeed) {
				const scale = FLOCK.minSpeed / speed;
				boid.vx *= scale;
				boid.vy *= scale;
			}

			boid.x = wrapPosition(boid.x + boid.vx * steps, width);
			boid.y = wrapPosition(boid.y + boid.vy * steps, height);
		}
	}

	function drawBoids(p: p5): void {
		p.noStroke();
		for (const boid of boids) {
			const speed = Math.hypot(boid.vx, boid.vy);
			// Faster boids read brighter, so flow through the flock is visible.
			const heat = p.constrain(speed / FLOCK.maxSpeed, 0, 1);
			p.fill(
				p.lerp(58, 108, heat),
				p.lerp(150, 226, heat),
				p.lerp(124, 176, heat),
				215
			);

			p.push();
			p.translate(boid.x, boid.y);
			p.rotate(Math.atan2(boid.vy, boid.vx));
			p.triangle(
				BOID_LENGTH,
				0,
				-BOID_LENGTH * 0.55,
				BOID_WIDTH * 0.5,
				-BOID_LENGTH * 0.55,
				-BOID_WIDTH * 0.5
			);
			p.pop();
		}
	}

	return {
		id: 'boids',
		label: 'Boids',

		setup(p) {
			seed(p);
		},

		resize(p) {
			// Keep headings and the flock's structure; just fold positions back in.
			for (const boid of boids) {
				boid.x = wrapPosition(boid.x, p.width);
				boid.y = wrapPosition(boid.y, p.height);
			}
		},

		draw(p, frame: InstrumentFrame) {
			// setup can run before the canvas has real dimensions.
			if (boids.length === 0) seed(p);

			const dt = p.constrain(frame.deltaTime, 0, MAX_DELTA_MS);
			const steps = dt / FRAME_MS;
			accumulateForces(frame.width, frame.height);
			integrate(frame.width, frame.height, steps);
			drawBoids(p);
		},

		destroy() {
			boids = [];
			accX = [];
			accY = [];
		}
	};
}
