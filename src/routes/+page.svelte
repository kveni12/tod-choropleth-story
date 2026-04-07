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
			Transit-oriented development is widely treated as a positive planning strategy, but this proof of concept
			zooms in on one narrower question: where does TOD actually concentrate, and how do those tracts compare with
			the statewide housing-change pattern? The graphic below keeps the original tract map structure and uses a
			scroll-guided sequence to introduce housing change, tract cohorts, and project locations one layer at a time.
		</p>
	</section>

	<section class="story card full-width">
		<h2>The question this graphic is trying to answer</h2>
		<p>
			This map asks where tract-level housing growth overlaps with <strong>TOD-dominated development</strong>.
			Instead of starting with demographic outcomes, it starts with the built landscape itself: which tracts added
			housing, which of those tracts were dominated by transit-oriented development, and where the underlying
			MassBuilds projects were actually built.
		</p>
		<p>
			That framing keeps the focus on a single spatial story before moving to any broader claims about equity,
			affordability, or neighborhood change.
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
		<section class="story card full-width">
			<h2>Methodology</h2>
			<p>
				Tracts are colored by <strong>census percent change in housing units (2010–20)</strong> and grouped into
				three MassBuilds development cohorts using the same rules as the original tract dashboard:
				<strong>TOD-dominated</strong>, <strong>non-TOD-dominated</strong>, and
				<strong>minimal development</strong>.
			</p>
			<p>
				A tract is treated as TOD-dominated when at least half of its observed new development falls within the
				project’s TOD definition. Minimal-development tracts are kept as a reference group so the reader can
				distinguish broad statewide background change from places with substantial recent production.
			</p>
		</section>

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
			<h2>How to read the map</h2>
			<p>
				Read the map in three passes. First, the choropleth shows where tract-level housing growth was strongest
				between 2010 and 2020. Second, the cohort outlines separate TOD-dominated tracts from non-TOD and
				minimal-development tracts. Third, the project points connect those tract-level patterns back to specific
				developments on the ground.
			</p>
			<p>
				The goal is not to make the reader hunt for hidden insight. It is to progressively clarify how the tract
				classification sits on top of the statewide housing-change pattern.
			</p>
		</section>

		<section class="story card full-width">
			<h2>How this fits the larger project</h2>
			<p>
				This figure is the spatial setup for the broader TOD story. It does not, by itself, show gentrification
				or prove any causal effect. Instead, it establishes where transit-oriented development is concentrated and
				which places should receive closer attention in the later affordability and demographic analysis.
			</p>
			<p>
				In that sense, the tract cohorts are best understood as a way to organize the map into meaningful groups,
				not as a final argument on their own.
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

	<!--
	Archived from the broader copied POC and intentionally not rendered here:

	- Municipal dashboard summary and filter controls
	- TOD status / affordability / concentration narrative sections
	- Income and education scatterplot sections
	- Affordability comparison and bottom-line summary cards
	- Interactive explorer gate and auxiliary routes (`/poc`, `/policy`, `/tract`, `/income-tod`)

	The goal of this standalone page is to keep only the tract housing-change overview map
	and the narrative that directly helps the reader interpret that one graphic.
	-->
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
