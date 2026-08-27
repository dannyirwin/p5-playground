import type { HandSnapshot } from '../hands.ts';
import { assignChordAndModHands } from '../input/handAssignment.ts';

/** ml5 / MediaPipe hand topology (21 landmarks). */
const HAND_CONNECTIONS: readonly (readonly [number, number])[] = [
	[0, 1],
	[1, 2],
	[2, 3],
	[3, 4],
	[0, 5],
	[5, 6],
	[6, 7],
	[7, 8],
	[0, 9],
	[9, 10],
	[10, 11],
	[11, 12],
	[0, 13],
	[13, 14],
	[14, 15],
	[15, 16],
	[0, 17],
	[17, 18],
	[18, 19],
	[19, 20],
	[5, 9],
	[9, 13],
	[13, 17]
];

type HandRole = 'chord' | 'mod' | 'other';

const ROLE_COLORS: Record<HandRole, readonly [number, number, number]> = {
	chord: [94, 230, 168],
	mod: [255, 196, 88],
	other: [120, 188, 210]
};

function lerp(a: number, b: number, t: number): number {
	return a + (b - a) * t;
}

function toCanvasX(x: number, width: number, captureWidth: number): number {
	return width - (x / captureWidth) * width;
}

function toCanvasY(y: number, height: number, captureHeight: number): number {
	return (y / captureHeight) * height;
}

function drawHandGlow(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	radius: number,
	cr: number,
	cg: number,
	cb: number,
	alpha: number
): void {
	const grad = ctx.createRadialGradient(x, y, 0, x, y, radius);
	const coreMix = 0.5;
	const hr = Math.round(cr + (255 - cr) * coreMix);
	const hg = Math.round(cg + (255 - cg) * coreMix);
	const hb = Math.round(cb + (255 - cb) * coreMix);
	grad.addColorStop(0, `rgba(${hr},${hg},${hb},${Math.min(1, alpha * 1.08)})`);
	grad.addColorStop(0.16, `rgba(${cr},${cg},${cb},${alpha * 0.88})`);
	grad.addColorStop(0.48, `rgba(${cr},${cg},${cb},${alpha * 0.3})`);
	grad.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
	ctx.fillStyle = grad;
	ctx.beginPath();
	ctx.arc(x, y, radius, 0, Math.PI * 2);
	ctx.fill();
}

function roleForHand(
	hand: HandSnapshot,
	chordHand: HandSnapshot | null,
	modHand: HandSnapshot | null
): HandRole {
	if (hand === chordHand) return 'chord';
	if (hand === modHand) return 'mod';
	return 'other';
}

/** Draw both tracked hands: skeleton lines + pulsing landmark glows, role-colored. */
export function drawHandKeypoints(
	ctx: CanvasRenderingContext2D,
	hands: readonly HandSnapshot[],
	width: number,
	height: number,
	captureWidth: number,
	captureHeight: number,
	millis: number,
	followerX: number,
	followerY: number
): void {
	if (hands.length === 0) return;

	const scaleX = (x: number) => (x / captureWidth) * width;
	const scaleY = (y: number) => (y / captureHeight) * height;
	const { chordHand, modHand } = assignChordAndModHands(
		hands,
		followerX,
		followerY,
		width,
		captureWidth,
		scaleX,
		scaleY
	);

	const t = millis * 0.001;

	for (let h = 0; h < hands.length; h++) {
		const hand = hands[h]!;
		const role = roleForHand(hand, chordHand, modHand);
		const [br, bg, bb] = ROLE_COLORS[role];
		const pulse = 0.5 + 0.5 * Math.sin(t * 1.15 + h * 1.7);
		const ease = pulse * pulse * (3 - 2 * pulse);
		const lineAlpha = 0.22 + 0.18 * ease;

		ctx.strokeStyle = `rgba(${br},${bg},${bb},${lineAlpha})`;
		ctx.lineWidth = role === 'other' ? 1.4 : 2;
		ctx.beginPath();
		for (const [a, b] of HAND_CONNECTIONS) {
			const ka = hand.keypoints[a];
			const kb = hand.keypoints[b];
			if (!ka || !kb) continue;
			const ax = toCanvasX(ka.x, width, captureWidth);
			const ay = toCanvasY(ka.y, height, captureHeight);
			const bx = toCanvasX(kb.x, width, captureWidth);
			const by = toCanvasY(kb.y, height, captureHeight);
			ctx.moveTo(ax, ay);
			ctx.lineTo(bx, by);
		}
		ctx.stroke();

		for (let i = 0; i < hand.keypoints.length; i++) {
			const kp = hand.keypoints[i]!;
			const x = toCanvasX(kp.x, width, captureWidth);
			const y = toCanvasY(kp.y, height, captureHeight);
			const kpPulse = 0.5 + 0.5 * Math.sin(t * 1.15 + h * 1.7 + i * 0.37);
			const kpEase = kpPulse * kpPulse * (3 - 2 * kpPulse);
			const cr = Math.round(lerp(br * 0.75, br, kpEase));
			const cg = Math.round(lerp(bg * 0.75, bg, kpEase));
			const cb = Math.round(lerp(bb * 0.75, bb, kpEase));
			const alpha = (role === 'other' ? 0.18 : 0.24) + 0.16 * kpEase;
			const radius = (role === 'mod' ? 14 : 16) + 4 * kpEase;
			drawHandGlow(ctx, x, y, radius, cr, cg, cb, alpha);
		}
	}
}

export function drawFollowerDot(
	ctx: CanvasRenderingContext2D,
	width: number,
	followerX: number,
	followerY: number
): void {
	ctx.fillStyle = 'rgba(94, 230, 168, 0.75)';
	ctx.beginPath();
	ctx.arc(width - followerX, followerY, 9, 0, Math.PI * 2);
	ctx.fill();
}
