<script lang="ts">
	import { page } from '$app/state';
	import HandInstrument from '$lib/components/HandInstrument.svelte';
	import { coerceRenderModeId } from '$lib/sketch/renderers';

	const mode = $derived(coerceRenderModeId(page.params.mode));
</script>

<HandInstrument {mode} />
