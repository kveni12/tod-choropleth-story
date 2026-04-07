<script>
	import '../app.css';
	import { loadAllData } from '$lib/stores/data.svelte.js';
	import { page } from '$app/state';

	let { children } = $props();
	let error = $state(/** @type {string | null} */ (null));
	/** Tract/policy bundle successfully loaded at least once. */
	let tractDataReady = $state(false);

	function needsTractData(/** @type {string | null} */ routeId) {
		return routeId === '/tract' || routeId === '/policy';
	}

	$effect(() => {
		const id = page.route.id;
		if (!needsTractData(id)) return;
		if (tractDataReady) return;
		error = null;
		loadAllData()
			.then(() => {
				tractDataReady = true;
			})
			.catch((e) => {
				error = e instanceof Error ? e.message : String(e);
			});
	});
</script>

{#if needsTractData(page.route.id)}
	{#if error}
		<div class="error-screen">
			<h2>Failed to load data</h2>
			<p>{error}</p>
		</div>
	{:else if !tractDataReady}
		<div class="loading-screen">
			<div class="spinner"></div>
			<p>Loading dashboard data...</p>
		</div>
	{:else}
		{@render children()}
	{/if}
{:else}
	{@render children()}
{/if}

<style>
	.loading-screen, .error-screen {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		min-height: 100vh;
		gap: 16px;
	}
	.spinner {
		width: 40px;
		height: 40px;
		border: 3px solid var(--border);
		border-top-color: var(--accent);
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}
	@keyframes spin { to { transform: rotate(360deg); } }
	.error-screen h2 { color: var(--danger); }
</style>
