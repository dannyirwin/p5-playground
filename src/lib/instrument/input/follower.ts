export const FOLLOWER_ACCEL = 0.08;
export const FOLLOWER_DAMPING = 0.82;
export const FOLLOWER_MAX_SPEED = 72;

export interface FollowerState {
	x: number;
	y: number;
	velX: number;
	velY: number;
}

export function updateFollower(
	state: FollowerState,
	targetX: number,
	targetY: number
): FollowerState {
	const dx = targetX - state.x;
	const dy = targetY - state.y;

	let velX = (state.velX + dx * FOLLOWER_ACCEL) * FOLLOWER_DAMPING;
	let velY = (state.velY + dy * FOLLOWER_ACCEL) * FOLLOWER_DAMPING;

	const speed = Math.hypot(velX, velY);
	if (speed > FOLLOWER_MAX_SPEED) {
		const scale = FOLLOWER_MAX_SPEED / speed;
		velX *= scale;
		velY *= scale;
	}

	return {
		x: state.x + velX,
		y: state.y + velY,
		velX,
		velY
	};
}
