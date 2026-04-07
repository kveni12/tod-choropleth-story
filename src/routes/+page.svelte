<script>
	import { onMount } from 'svelte';
	import { tractData, developments, loadAllData } from '$lib/stores/data.svelte.js';
	import { createPanelState } from '$lib/stores/panelState.svelte.js';
	import PocNhgisTractMap from '$lib/components/PocNhgisTractMap.svelte';
	import {
		DEFAULT_MAIN_POC_DEV_OPTS,
		DEFAULT_MAIN_POC_UNIVERSE,
		buildNhgisLikeRows,
		buildTractDevClassMap,
		filterDevelopmentsByYearRange,
		filterTractsForMainPoc,
		uniqueCounties
	} from '$lib/utils/mainPocTractModel.js';

	let loading = true;
	let error = '';
	let threshold = 0.5;

	const tractTimePeriod = '10_20';
	const tractSigDevMin = 2;
	const tractTodFractionCutoff = 0.5;
	const pocMapPanel = createPanelState('choropleth-story');

	function syncPanelDefaults() {
		pocMapPanel.transitDistanceMi = threshold;
		pocMapPanel.timePeriod = tractTimePeriod;
		pocMapPanel.minStops = DEFAULT_MAIN_POC_UNIVERSE.minStops;
		pocMapPanel.sigDevMinPctStockIncrease = tractSigDevMin;
		pocMapPanel.todFractionCutoff = tractTodFractionCutoff;
		pocMapPanel.huChangeSource = 'massbuilds';
		pocMapPanel.minPopulation = DEFAULT_MAIN_POC_UNIVERSE.minPopulation;
		pocMapPanel.minPopDensity = DEFAULT_MAIN_POC_UNIVERSE.minPopDensity;
		pocMapPanel.minUnitsPerProject = DEFAULT_MAIN_POC_DEV_OPTS.minUnitsPerProject;
		pocMapPanel.minDevMultifamilyRatioPct = DEFAULT_MAIN_POC_DEV_OPTS.minDevMultifamilyRatioPct;
		pocMapPanel.minDevAffordableRatioPct = DEFAULT_MAIN_POC_DEV_OPTS.minDevAffordableRatioPct;
		pocMapPanel.includeRedevelopment = DEFAULT_MAIN_POC_DEV_OPTS.includeRedevelopment;
	}

	$: syncPanelDefaults();

	$: tractDevOpts = {
		minUnitsPerProject: DEFAULT_MAIN_POC_DEV_OPTS.minUnitsPerProject,
		minDevMultifamilyRatioPct: DEFAULT_MAIN_POC_DEV_OPTS.minDevMultifamilyRatioPct,
		minDevAffordableRatioPct: DEFAULT_MAIN_POC_DEV_OPTS.minDevAffordableRatioPct,
		includeRedevelopment: DEFAULT_MAIN_POC_DEV_OPTS.includeRedevelopment
	};

	$: tractCounties = tractData.length ? new Set(uniqueCounties(tractData)) : new Set();

	$: tractListFiltered = tractData.length
		? filterTractsForMainPoc(tractData, tractCounties, '', {
				timePeriod: tractTimePeriod,
				minStops: DEFAULT_MAIN_POC_UNIVERSE.minStops,
				minPopulation: DEFAULT_MAIN_POC_UNIVERSE.minPopulation,
				minPopDensity: DEFAULT_MAIN_POC_UNIVERSE.minPopDensity
			})
		: [];

	$: tractWindowDevs = filterDevelopmentsByYearRange(developments, 1990, 2026, tractDevOpts);

	$: tractDevClassByGj = buildTractDevClassMap(
		tractListFiltered,
		tractWindowDevs,
		{
			timePeriod: tractTimePeriod,
			minStops: DEFAULT_MAIN_POC_UNIVERSE.minStops,
			minPopulation: DEFAULT_MAIN_POC_UNIVERSE.minPopulation,
			minPopDensity: DEFAULT_MAIN_POC_UNIVERSE.minPopDensity
		},
		threshold,
		tractDevOpts,
		tractSigDevMin,
		tractTodFractionCutoff
	);

	$: nhgisLikeRows = buildNhgisLikeRows(tractListFiltered, tractDevClassByGj);

	onMount(async () => {
		try {
			await loadAllData();
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
		} finally {
			loading = false;
		}
	});
</script>

<svelte:head>
	<title>TOD Choropleth Story</title>
	<meta
		name="description"
		content="A focused tract-level story about housing change, TOD-dominated tracts, and MassBuilds development in Massachusetts."
	/>
</svelte:head>

<div class="poc-root">
	<section class="hero-full card">
		<div class="eyebrow">Interactive Visualization Writeup</div>
		<h1>Tract categorizations and housing change in Massachusetts.</h1>
		<p class="subtitle">
			This proof of concept focuses on one interactive figure: a tract-level housing change map that progressively
			introduces TOD-dominated tracts, non-TOD-dominated tracts, and the MassBuilds developments behind those
			patterns. The goal is to make one spatial story legible, rather than splitting attention across many charts.
		</p>
	</section>

	<section class="story card full-width">
		<h2>What this map shows</h2>
		<p>
			Tracts are colored by <strong>census percent change in housing units (2010–20)</strong> and outlined by
			MassBuilds cohort: <strong>TOD-dominated</strong>, <strong>non-TOD-dominated</strong>, and
			<strong>minimal development</strong>. The scroll-driven steps built into the figure start with housing
			change alone, then add the tract categorization, and finally add the project points that produce those
			patterns.
		</p>
		<p>
			This framing helps answer a simple policy question: where is transit-oriented development actually
			concentrating, and how different do those tracts look from the statewide background?
		</p>
	</section>

	{#if loading}
		<div class="loading-status">
			<div class="spinner" aria-hidden="true"></div>
			<p>Loading tract data…</p>
		</div>
	{:else if error}
		<div class="loading-status loading-status--error">
			<h3>Failed to load tract data</h3>
			<p>{error}</p>
		</div>
	{:else}
		<section class="chart-card card full-width">
			<h3>Tract categorizations and housing change overview (tract, 2010–20 window)</h3>
			<p class="chart-note">
				Tracts are colored by <strong>census percent change in housing units (2010–20)</strong> and outlined by
				MassBuilds cohort (TOD-dominated vs non-TOD-dominated vs minimal development), matching the tract
				dashboard rules. Use the overlays to add MBTA lines and stops and MassBuilds projects (same encoding as
				the tract map).
			</p>
			<div class="chart-wrap chart-tall chart-wrap--poc-map">
				<PocNhgisTractMap
					panelState={pocMapPanel}
					tractList={tractListFiltered}
					nhgisRows={nhgisLikeRows}
					metricsDevelopments={tractWindowDevs}
				/>
			</div>
		</section>

		<section class="story card full-width">
			<h2>How to interpret it</h2>
			<p>
				The first map state shows where housing growth happened. The second adds the development categories so
				you can distinguish transit-oriented growth from other kinds of tract change. The third adds project
				points, which makes the tract-level pattern feel grounded in actual development activity rather than just
				abstract boundaries.
			</p>
			<p>
				That sequence is the core interaction technique in this proof of concept. It turns the map into a guided
				explanation rather than a static figure or an open-ended dashboard.
			</p>
		</section>

		<section class="story card full-width">
			<h2>Sources</h2>
			<ul class="story-list">
				<li><a href="https://www.nhgis.org/" target="_blank" rel="noreferrer">NHGIS tract-level census data</a></li>
				<li><a href="https://www.massbuilds.com/map" target="_blank" rel="noreferrer">MassBuilds housing development data</a></li>
				<li>MBTA stops and lines from the cleaned project pipeline used in the original tract dashboard</li>
			</ul>
		</section>
	{/if}
</div>

<style>
	.poc-root {
		max-width: var(--max-width);
		margin: 0 auto;
		padding: 2rem 1.25rem 4rem;
	}

	.card {
		background: var(--paper);
		border: 1px solid rgba(120, 114, 102, 0.18);
		border-radius: var(--radius-xl);
		box-shadow: var(--shadow);
	}

	.hero-full {
		padding: 1.75rem;
		margin-bottom: 1.25rem;
	}

	.eyebrow {
		display: inline-flex;
		margin-bottom: 0.9rem;
		padding: 0.45rem 0.72rem;
		border-radius: 999px;
		background: var(--accent-soft);
		color: var(--accent);
		font-size: 0.78rem;
		font-weight: 800;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}

	h1 {
		margin-bottom: 1rem;
		font-size: clamp(2.5rem, 5vw, 4.4rem);
		line-height: 0.98;
		letter-spacing: -0.05em;
	}

	.subtitle {
		color: var(--muted);
		line-height: 1.58;
		margin-bottom: 0;
	}

	.story {
		padding: 18px;
		margin-top: 1rem;
	}

	.story h2 {
		font-size: 1.2rem;
		margin-bottom: 10px;
	}

	.story p,
	.story li {
		color: var(--muted);
		line-height: 1.58;
	}

	.story-list {
		color: var(--muted);
		line-height: 1.58;
		padding-left: 22px;
		margin: 10px 0 0;
	}

	.chart-card {
		padding: 16px;
		margin-top: 1rem;
	}

	.chart-card h3 {
		font-size: 1.05rem;
		margin-bottom: 8px;
	}

	.chart-note {
		color: var(--muted);
		line-height: 1.55;
		font-size: 0.9rem;
		margin-bottom: 8px;
	}

	.chart-wrap {
		position: relative;
		min-height: 420px;
	}

	.chart-tall {
		min-height: 520px;
	}

	.chart-wrap--poc-map {
		width: 80%;
		max-width: 100%;
		margin-left: auto;
		margin-right: auto;
	}

	.full-width {
		width: 100%;
	}

	.loading-status {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 12px;
		min-height: 220px;
	}

	.loading-status--error h3 {
		color: #c0392b;
		font-size: 1.1rem;
		margin: 0;
	}

	.spinner {
		width: 32px;
		height: 32px;
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

	@media (max-width: 920px) {
		.chart-wrap--poc-map {
			width: 100%;
		}
	}

	@media (max-width: 720px) {
		.poc-root {
			padding-left: 0.9rem;
			padding-right: 0.9rem;
		}

		.hero-full,
		.story,
		.chart-card {
			padding: 1.1rem;
		}
	}
</style>
