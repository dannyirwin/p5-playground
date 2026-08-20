function loadScript(src: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
		if (existing) {
			if (existing.dataset.loaded === 'true') {
				resolve();
				return;
			}
			existing.addEventListener('load', () => resolve(), { once: true });
			existing.addEventListener(
				'error',
				() => reject(new Error(`Failed to load ${src}`)),
				{ once: true }
			);
			return;
		}

		const script = document.createElement('script');
		script.src = src;
		script.async = true;
		script.addEventListener(
			'load',
			() => {
				script.dataset.loaded = 'true';
				resolve();
			},
			{ once: true }
		);
		script.addEventListener(
			'error',
			() => reject(new Error(`Failed to load ${src}`)),
			{ once: true }
		);
		document.head.appendChild(script);
	});
}

let depsPromise: Promise<void> | undefined;

/** Load p5.sound and ml5 in the browser only (CDN scripts). Core p5 comes from npm. */
export function loadBrowserSketchDeps(): Promise<void> {
	if (typeof window === 'undefined') {
		return Promise.reject(new Error('Sketch deps require a browser'));
	}

	if (!depsPromise) {
		depsPromise = (async () => {
			const { default: P5 } = await import('p5');
			(window as unknown as { p5: typeof P5 }).p5 = P5;

			await loadScript(
				'https://cdn.jsdelivr.net/npm/p5@1.11.13/lib/addons/p5.sound.min.js'
			);
			await loadScript('https://unpkg.com/ml5@1/dist/ml5.js');
		})();
	}

	return depsPromise;
}
