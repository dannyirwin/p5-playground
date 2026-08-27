/** Temporary dev control — keyboard scale-degree triggers (A=1 … H=8, also 1–8). */

const KEY_TO_DEGREE: Readonly<Record<string, number>> = (() => {
	const map: Record<string, number> = {};
	for (let d = 1; d <= 8; d++) {
		map[String(d)] = d;
		map[String.fromCharCode(96 + d)] = d; // a–h
	}
	return map;
})();

let heldDegree: number | null = null;
let heldKey: string | null = null;

export function getKeyboardChordDegree(): number | null {
	return heldDegree;
}

function shouldIgnoreKeyboard(event: KeyboardEvent): boolean {
	const target = event.target;
	if (!(target instanceof HTMLElement)) return false;
	const tag = target.tagName;
	return tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || target.isContentEditable;
}

function degreeForKey(key: string): number | undefined {
	return KEY_TO_DEGREE[key.toLowerCase()];
}

/** Attach window listeners; returns cleanup. Safe to call once from the instrument shell. */
export function attachKeyboardChordInput(target: Window = window): () => void {
	const onKeyDown = (event: KeyboardEvent): void => {
		if (event.repeat || shouldIgnoreKeyboard(event)) return;
		const degree = degreeForKey(event.key);
		if (degree === undefined) return;
		event.preventDefault();
		heldDegree = degree;
		heldKey = event.key.toLowerCase();
	};

	const onKeyUp = (event: KeyboardEvent): void => {
		if (heldKey !== null && event.key.toLowerCase() === heldKey) {
			heldDegree = null;
			heldKey = null;
		}
	};

	const clear = (): void => {
		heldDegree = null;
		heldKey = null;
	};

	target.addEventListener('keydown', onKeyDown);
	target.addEventListener('keyup', onKeyUp);
	target.addEventListener('blur', clear);

	return () => {
		target.removeEventListener('keydown', onKeyDown);
		target.removeEventListener('keyup', onKeyUp);
		target.removeEventListener('blur', clear);
		clear();
	};
}
