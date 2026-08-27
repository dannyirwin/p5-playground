<script lang="ts">
	import { page } from '$app/state';
	import HandInstrument from '$lib/components/HandInstrument.svelte';
	import { coerceP5RenderModeId } from '$lib/instrument/modes/ids';

	const renderMode = $derived(coerceP5RenderModeId(page.params.mode));
</script>

<HandInstrument {renderMode} />
