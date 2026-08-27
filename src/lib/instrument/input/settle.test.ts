import { describe, expect, it } from 'vitest';
import {
	requiredSettleMs,
	SETTLE_MS,
	settleKey,
	tickHarmonySettle
} from './settle.ts';

describe('settleKey', () => {
	it('uses degree and quality only', () => {
		expect(settleKey(3, 'major')).toBe('3|major');
	});
});

describe('requiredSettleMs', () => {
	it('uses release timing for fist', () => {
		expect(requiredSettleMs('0|major', '3|major')).toBe(SETTLE_MS.release);
	});

	it('uses chord timing when degree changes', () => {
		expect(requiredSettleMs('5|major', '3|major')).toBe(SETTLE_MS.chord);
	});

	it('uses quality timing when degree is unchanged', () => {
		expect(requiredSettleMs('3|minor7', '3|major')).toBe(SETTLE_MS.quality);
	});
});

describe('tickHarmonySettle', () => {
	it('commits after required ms on a stable key', () => {
		let state = { lastKey: '0|major', stableMs: 0 };
		let settled = false;
		for (let i = 0; i < 20 && !settled; i++) {
			const result = tickHarmonySettle('3|major', state, 16);
			state = result.state;
			settled = result.settled;
		}
		expect(settled).toBe(true);
	});

	it('resets progress when the key changes', () => {
		const holding = tickHarmonySettle('3|major', { lastKey: '3|major', stableMs: 48 }, 16);
		expect(holding.progress).toBeGreaterThan(0);

		const changed = tickHarmonySettle('5|major', holding.state, 16);
		expect(changed.progress).toBe(0);
		expect(changed.settled).toBe(false);
	});
});
