<script>
	import { base } from '$app/paths';
	import MainPocTractDashboard from '$lib/components/MainPocTractDashboard.svelte';
	import { loadAllData } from '$lib/stores/data.svelte.js';

	/**
	 * ``municipal`` — teammate static POC (``static/municipal/index.html``): MassBuilds CSV,
	 * haversine to stations in miles, TOD = all project units when distance ≤ slider (POC semantics).
	 *
	 * ``tract`` — same tract dashboard as ``/tract``: ``developments.json``, ``nearest_stop_dist_m`` in m,
	 * ``classifyDevTodUnits`` / ``developmentAffordableUnitsCapped`` / ``filterDevelopments`` via
	 * ``DualPanel`` (aligned with ``/policy``).
	 */
	let geoMode = $state(/** @type {'municipal' | 'tract'} */ ('municipal'));

	let tractError = $state(/** @type {string | null} */ (null));
	let tractLoading = $state(false);

	$effect(() => {
		if (geoMode !== 'tract') return;
		tractError = null;
		tractLoading = true;
		loadAllData()
			.then(() => {
				tractError = null;
			})
			.catch((e) => {
				tractError = e instanceof Error ? e.message : String(e);
			})
			.finally(() => {
				tractLoading = false;
			});
	});
</script>

<div class="home-wrap">
	<div class="geo-toggle" role="group" aria-label="Geography mode">
		<button
			type="button"
			class="geo-toggle__btn"
			class:geo-toggle__btn--active={geoMode === 'municipal'}
			onclick={() => (geoMode = 'municipal')}
		>
			Municipalities
		</button>
		<button
			type="button"
			class="geo-toggle__btn"
			class:geo-toggle__btn--active={geoMode === 'tract'}
			onclick={() => (geoMode = 'tract')}
		>
			Census tracts
		</button>
	</div>

	{#if geoMode === 'municipal'}
		<!-- Teammate MVP: self-contained static page (light theme + D3 CDN). -->
		<div class="municipal-root">
			<iframe
				class="municipal-frame"
				title="Income, TOD, and affordability — municipal dashboard"
				src="{base}/municipal/index.html"
			></iframe>
		</div>
	{:else if tractLoading}
		<div class="tract-status">
			<div class="spinner" aria-hidden="true"></div>
			<p>Loading tract dashboard data…</p>
		</div>
	{:else if tractError}
		<div class="tract-status tract-status--error">
			<h2>Failed to load data</h2>
			<p>{tractError}</p>
		</div>
	{:else}
		<div class="tract-root">
			<MainPocTractDashboard />
		</div>
	{/if}
</div>

<style>
	.home-wrap {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-height: 0;
		gap: 12px;
	}

	.geo-toggle {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
		padding: 0 4px;
		flex-shrink: 0;
	}

	.geo-toggle__btn {
		font: inherit;
		font-size: 0.9375rem;
		padding: 8px 16px;
		border-radius: var(--radius-sm);
		border: 1px solid var(--border);
		background: var(--bg-card);
		color: var(--text-muted);
		cursor: pointer;
		transition:
			background 0.15s ease,
			color 0.15s ease,
			border-color 0.15s ease;
	}

	.geo-toggle__btn:hover {
		color: var(--text);
		background: var(--bg-hover);
	}

	.geo-toggle__btn--active {
		color: var(--accent);
		border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
		background: color-mix(in srgb, var(--accent) 12%, transparent);
	}

	.municipal-root {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-height: 0;
	}

	.municipal-frame {
		display: block;
		width: 100%;
		flex: 1;
		min-height: min(85vh, calc(100vh - 120px));
		border: 0;
		background: var(--bg-panel);
	}

	.tract-root {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
	}

	.tract-status {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 16px;
		min-height: min(50vh, 400px);
		color: var(--text-muted);
	}

	.tract-status--error h2 {
		color: var(--danger);
		font-size: 1.1rem;
		margin: 0;
	}

	.tract-status--error p {
		margin: 0;
		max-width: 40rem;
		text-align: center;
	}

	.spinner {
		width: 40px;
		height: 40px;
		border: 3px solid var(--border);
		border-top-color: var(--accent);
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
