<script>
	import { base } from '$app/paths';
	import * as d3 from 'd3';
	import { tractData, developments, tractGeo } from '$lib/stores/data.svelte.js';
	import {
		DEFAULT_MAIN_POC_DEV_OPTS,
		DEFAULT_MAIN_POC_UNIVERSE,
		buildNhgisLikeRows,
		buildProjectRowsWithGisjoin,
		buildTractDevClassMap,
		buildTractPocRows,
		filterDevelopmentsByYearRange,
		filterTractsForMainPoc,
		formatTractLabel,
		uniqueCounties
	} from '$lib/utils/mainPocTractModel.js';
	import { drawMainPocTractCharts } from '$lib/utils/mainPocTractCharts.js';
	import { createPanelState } from '$lib/stores/panelState.svelte.js';
	import PocNhgisTractMap from '$lib/components/PocNhgisTractMap.svelte';

	let yearStart = $state(1990);
	let yearEnd = $state(2026);
	/** Max distance to nearest MBTA stop for TOD unit classification (mi) — same as tract dashboard ``transitDistanceMi``. */
	let threshold = $state(0.5);
	let growthScale = $state(/** @type {'units' | 'share'} */ ('units'));
	let showTrendline = $state(false);
	let dominanceFilter = $state(/** @type {'all' | 'tod' | 'nonTod'} */ ('all'));
	let search = $state('');
	let mapMetric = $state(/** @type {'units' | 'affordableUnits' | 'under125' | 'high125' | 'affordableShare' | 'todShare'} */ ('units'));

	const mpcMapPanel = createPanelState('mpc-map');

	// --- Tract universe (``passesTractUniverse`` / same semantics as tract ``FilterPanel``) ---
	let timePeriod = $state(/** @type {'90_00' | '00_10' | '10_20' | '00_20' | '90_20'} */ ('10_20'));
	let minPopulation = $state(DEFAULT_MAIN_POC_UNIVERSE.minPopulation);
	let minPopDensity = $state(DEFAULT_MAIN_POC_UNIVERSE.minPopDensity);
	let minStops = $state(DEFAULT_MAIN_POC_UNIVERSE.minStops);

	// --- Development filters (same as tract ``FilterPanel`` development section) ---
	let minUnitsPerProject = $state(DEFAULT_MAIN_POC_DEV_OPTS.minUnitsPerProject);
	let minDevMfPct = $state(DEFAULT_MAIN_POC_DEV_OPTS.minDevMultifamilyRatioPct);
	let minDevAffPct = $state(DEFAULT_MAIN_POC_DEV_OPTS.minDevAffordableRatioPct);
	let includeRedevelopment = $state(DEFAULT_MAIN_POC_DEV_OPTS.includeRedevelopment);
	/** Min. % housing stock growth for “significant” development (MassBuilds / census HU) — matches tract TOD Analysis. */
	let sigDevMinPctStockIncrease = $state(2);
	/** TOD share of new units at/above this value → TOD-dominated tract. */
	let todFractionCutoff = $state(0.5);

	/** @type {Set<string>} */
	let counties = $state(new Set());
	let didInitCounties = $state(false);

	/** Selected tract GISJOINs */
	let selected = $state(/** @type {Set<string>} */ (new Set()));

	$effect(() => {
		if (!tractData.length || didInitCounties) return;
		counties = new Set(uniqueCounties(tractData));
		didInitCounties = true;
	});

	const searchLower = $derived(search.trim().toLowerCase());

	const universePanel = $derived({
		timePeriod,
		minStops,
		minPopulation,
		minPopDensity
	});

	const devOpts = $derived({
		minUnitsPerProject,
		minDevMultifamilyRatioPct: minDevMfPct,
		minDevAffordableRatioPct: minDevAffPct,
		includeRedevelopment
	});

	$effect(() => {
		if (!tractData.length) return;
		mpcMapPanel.transitDistanceMi = threshold;
		mpcMapPanel.timePeriod = timePeriod;
		mpcMapPanel.minStops = minStops;
		mpcMapPanel.sigDevMinPctStockIncrease = sigDevMinPctStockIncrease;
		mpcMapPanel.todFractionCutoff = todFractionCutoff;
		mpcMapPanel.huChangeSource = 'massbuilds';
		mpcMapPanel.minPopulation = minPopulation;
		mpcMapPanel.minPopDensity = minPopDensity;
		mpcMapPanel.minUnitsPerProject = minUnitsPerProject;
		mpcMapPanel.minDevMultifamilyRatioPct = minDevMfPct;
		mpcMapPanel.minDevAffordableRatioPct = minDevAffPct;
		mpcMapPanel.includeRedevelopment = includeRedevelopment;
	});

	const tractListFiltered = $derived.by(() => {
		if (!tractData.length) return [];
		return filterTractsForMainPoc(tractData, counties, searchLower, universePanel);
	});

	const fullWindowDevs = $derived.by(() =>
		filterDevelopmentsByYearRange(developments, 1990, 2026, devOpts)
	);
	const windowDevs = $derived.by(() =>
		filterDevelopmentsByYearRange(developments, yearStart, yearEnd, devOpts)
	);

	const domainRows = $derived.by(() =>
		buildTractPocRows(tractListFiltered, fullWindowDevs, threshold, minDevMfPct).filter((d) =>
			Number.isFinite(d.vulnerabilityPct)
		)
	);

	const allRows = $derived.by(() =>
		buildTractPocRows(tractListFiltered, windowDevs, threshold, minDevMfPct).filter((d) =>
			Number.isFinite(d.vulnerabilityPct)
		)
	);

	const visibleRows = $derived.by(() =>
		allRows.filter(
			(d) => dominanceFilter === 'all' || d.dominant === dominanceFilter
		)
	);

	const activeRows = $derived.by(() => {
		if (!selected.size) return visibleRows;
		return visibleRows.filter((d) => selected.has(d.gisjoin));
	});

	const projectRows = $derived.by(() =>
		buildProjectRowsWithGisjoin(developments, yearStart, yearEnd, threshold, devOpts)
	);

	const selectedProjectRows = $derived.by(() => {
		if (!selected.size) return projectRows;
		return projectRows.filter((d) => selected.has(d.gisjoin));
	});

	const devClassByGj = $derived.by(() =>
		buildTractDevClassMap(
			tractListFiltered,
			windowDevs,
			universePanel,
			threshold,
			devOpts,
			sigDevMinPctStockIncrease,
			todFractionCutoff
		)
	);

	const nhgisLikeRows = $derived.by(() => buildNhgisLikeRows(tractListFiltered, devClassByGj));

	const fmtInt = d3.format(',');
	const fmtPct1 = d3.format('.1%');

	function toggleCounty(c) {
		const next = new Set(counties);
		if (next.has(c)) next.delete(c);
		else next.add(c);
		counties = next;
	}

	function selectAllCounties() {
		counties = new Set(uniqueCounties(tractData));
	}

	function toggleSelect(gisjoin) {
		const next = new Set(selected);
		if (next.has(gisjoin)) next.delete(gisjoin);
		else next.add(gisjoin);
		selected = next;
	}

	function clearSelection() {
		selected = new Set();
	}

	function resetControls() {
		yearStart = 1990;
		yearEnd = 2026;
		threshold = 0.5;
		growthScale = 'units';
		showTrendline = false;
		dominanceFilter = 'all';
		search = '';
		mapMetric = 'units';
		selected = new Set();
		timePeriod = DEFAULT_MAIN_POC_UNIVERSE.timePeriod;
		minPopulation = DEFAULT_MAIN_POC_UNIVERSE.minPopulation;
		minPopDensity = DEFAULT_MAIN_POC_UNIVERSE.minPopDensity;
		minStops = DEFAULT_MAIN_POC_UNIVERSE.minStops;
		minUnitsPerProject = DEFAULT_MAIN_POC_DEV_OPTS.minUnitsPerProject;
		minDevMfPct = DEFAULT_MAIN_POC_DEV_OPTS.minDevMultifamilyRatioPct;
		minDevAffPct = DEFAULT_MAIN_POC_DEV_OPTS.minDevAffordableRatioPct;
		includeRedevelopment = DEFAULT_MAIN_POC_DEV_OPTS.includeRedevelopment;
		sigDevMinPctStockIncrease = 2;
		todFractionCutoff = 0.5;
		selectAllCounties();
	}

	const countyPresets = [
		{
			label: 'Suffolk / Middlesex / Norfolk',
			counties: ['Suffolk County', 'Middlesex County', 'Norfolk County']
		},
		{
			label: 'Berkshire / Franklin / Hampshire',
			counties: ['Berkshire County', 'Franklin County', 'Hampshire County']
		},
		{ label: 'Cape & Islands', counties: ['Barnstable County', 'Dukes County', 'Nantucket County'] }
	];

	function applyPreset(p) {
		counties = new Set(p.counties.filter((c) => uniqueCounties(tractData).includes(c)));
	}

	let elScatter,
		elChoro,
		elTimeline,
		elComposition,
		elRanked,
		elAffordMix,
		elGrowthCapture,
		elTractEdu,
		elMobility,
		elTakeaway;

	$effect(() => {
		if (!elScatter || !tractData.length || !developments.length) return;
		const units = d3.sum(projectRows, (d) => d.units);
		const affordableUnits = d3.sum(projectRows, (d) => d.affordableUnits);
		const todUnits = d3.sum(projectRows, (d) => d.todUnits);
		const sel = activeRows;
		const avgVuln = d3.mean(sel, (d) => d.vulnerabilityPct) || 0;
		const avgAff =
			d3.sum(sel, (d) => d.affordableUnits) / Math.max(1, d3.sum(sel, (d) => d.units));
		const todDom = sel.filter((d) => d.dominant === 'tod').length;

		drawMainPocTractCharts({
				elScatter,
				elChoro,
				elTimeline,
				elComposition,
				elRanked,
				elAffordMix,
				elGrowthCapture,
				elTractEdu,
				elMobility,
				elTakeaway,
				state: {
					yearStart,
					yearEnd,
					threshold,
					growthScale,
					showTrendline,
					dominanceFilter,
					search,
					selected,
					mapMetric
				},
				visibleRows,
				domainRows,
				projectRows,
				selectedProjectRows,
				nhgisLikeRows,
				tractGeo,
				toggleSelect,
				clearSelection
			});

		const summaryEl = document.getElementById('mpc-summary-copy');
		if (summaryEl) {
			summaryEl.innerHTML = `From <strong>${yearStart}</strong> through <strong>${yearEnd}</strong>, the visible tracts average <strong>${avgVuln.toFixed(1)}%</strong> poverty (ACS 2020). <strong>${todDom}</strong> of ${sel.length} selected-or-visible tracts are TOD-dominant by MF-based TOD units, and the weighted affordable share is <strong>${fmtPct1(avgAff || 0)}</strong>.`;
		}
		const sm = document.getElementById('mpc-stat-tracts');
		const su = document.getElementById('mpc-stat-units');
		const sa = document.getElementById('mpc-stat-aff');
		const st = document.getElementById('mpc-stat-tod');
		if (sm) sm.textContent = fmtInt(visibleRows.length);
		if (su) su.textContent = fmtInt(Math.round(units));
		if (sa) sa.textContent = units ? fmtPct1(affordableUnits / units) : '0.0%';
		if (st) st.textContent = units ? fmtPct1(todUnits / units) : '0.0%';
	});
</script>

<div class="mpc-root">
	<section class="mpc-hero mpc-card">
		<div class="mpc-eyebrow">Census tract view</div>
		<h1 class="mpc-h1">Same questions as the municipal dashboard — by census tract.</h1>
		<p class="mpc-sub">
			Development metrics use <strong>MassBuilds JSON</strong> with the same TOD and project filters as the
			<a href="{base}/tract">tract dashboard</a> (<code>classifyDevTodUnits</code>, tract universe, dev filters).
			Scatter X is <strong>poverty rate (ACS 2020)</strong> as the tract-level analog to municipal “under $125k”
			share.
		</p>
	</section>

	<section class="mpc-dashboard">
		<aside class="mpc-controls mpc-card">
			<h2 class="mpc-h2">Controls</h2>
			<p class="mpc-note">
				County + search narrow the list. <strong>Analysis filters</strong> (below) match the tract page
				universe and MassBuilds rules.
			</p>

			<div class="mpc-block">
				<span class="mpc-label">Completion year range (MassBuilds)</span>
				<div class="mpc-range-row">
					<input type="number" min="1990" max="2026" bind:value={yearStart} />
					<input type="number" min="1990" max="2026" bind:value={yearEnd} />
				</div>
			</div>

			<details class="mpc-details" open>
				<summary class="mpc-details-summary">Census tract universe</summary>
				<p class="mpc-hint">
					Which tracts appear in every chart (population / density / stops use the selected census period).
				</p>
				<label class="mpc-field">
					<span class="mpc-field-label">Census period (for universe)</span>
				<select bind:value={timePeriod}>
					<option value="90_00">1990–2000</option>
					<option value="00_10">2000–2010</option>
					<option value="10_20">2010–2020</option>
					<option value="00_20">2000–2020</option>
					<option value="90_20">1990–2020</option>
				</select>
				</label>
				<label class="mpc-field">
					<span class="mpc-field-label">Min. population (period start)</span>
					<input type="number" min="0" step="100" bind:value={minPopulation} />
				</label>
				<label class="mpc-field">
					<span class="mpc-field-label">Min. pop. density (per mi²)</span>
					<input type="number" min="0" step="100" bind:value={minPopDensity} />
				</label>
				<label class="mpc-field">
					<span class="mpc-field-label">Min. MBTA stops (tract + buffer)</span>
					<input type="number" min="0" step="1" bind:value={minStops} />
				</label>
			</details>

			<details class="mpc-details" open>
				<summary class="mpc-details-summary">MassBuilds project filters</summary>
				<p class="mpc-hint">Which projects count toward tract totals (same logic as tract dashboard).</p>
				<label class="mpc-field">
					<span class="mpc-field-label">Min. units / project</span>
					<input type="number" min="0" step="1" bind:value={minUnitsPerProject} />
				</label>
				<label class="mpc-field">
					<span class="mpc-field-label">Min. multifamily ratio (%)</span>
					<input type="number" min="0" max="100" step="1" bind:value={minDevMfPct} />
				</label>
				<label class="mpc-field">
					<span class="mpc-field-label">Min. affordable ratio (%)</span>
					<input type="number" min="0" max="100" step="1" bind:value={minDevAffPct} />
				</label>
				<label class="mpc-check mpc-field">
					<input type="checkbox" bind:checked={includeRedevelopment} />
					<span>Include redevelopment</span>
				</label>
				<label class="mpc-field">
					<span class="mpc-field-label">Sig. dev % (min. stock growth)</span>
					<input type="number" min="0" max="20" step="0.5" bind:value={sigDevMinPctStockIncrease} />
				</label>
				<label class="mpc-field">
					<span class="mpc-field-label">TOD-dom. cut (TOD share of units)</span>
					<input type="number" min="0" max="1" step="0.05" bind:value={todFractionCutoff} />
				</label>
				<p class="mpc-hint">
					Minimal development vs TOD vs non-TOD cohorts on NHGIS charts use the same rules as the
					<a href="{base}/tract">tract dashboard</a> TOD Analysis (stock growth + TOD share).
				</p>
			</details>

			<div class="mpc-block">
				<label class="mpc-label" for="mpc-threshold"
					>Transit distance (TOD): {threshold.toFixed(2)} mi</label
				>
				<input id="mpc-threshold" type="range" min="0.1" max="1" step="0.05" bind:value={threshold} />
				<p class="mpc-hint">Nearest MBTA stop within this distance → multifamily units count as TOD (same as tract page).</p>
			</div>

			<div class="mpc-block">
				<label class="mpc-label" for="mpc-growth">Growth scale</label>
				<select id="mpc-growth" bind:value={growthScale}>
					<option value="units">Raw units</option>
					<option value="share">Share of visible-window growth</option>
				</select>
			</div>

			<div class="mpc-block">
				<label class="mpc-check">
					<input type="checkbox" bind:checked={showTrendline} />
					<span>Show trendline on main scatter</span>
				</label>
			</div>

			<div class="mpc-block">
				<label class="mpc-label" for="mpc-dom">Show tracts</label>
				<select id="mpc-dom" bind:value={dominanceFilter}>
					<option value="all">All</option>
					<option value="tod">TOD-dominant only</option>
					<option value="nonTod">Non-TOD-dominant only</option>
				</select>
			</div>

			<div class="mpc-block">
				<span class="mpc-label">Counties</span>
				<div class="mpc-county-grid">
					{#each uniqueCounties(tractData) as c (c)}
						<label class="mpc-check mpc-check-tight">
							<input
								type="checkbox"
								checked={counties.has(c)}
								onchange={() => toggleCounty(c)}
							/>
							<span>{c.replace(' County', '')}</span>
						</label>
					{/each}
				</div>
			</div>

			<div class="mpc-block">
				<label class="mpc-label" for="mpc-search">Tract search</label>
				<input
					id="mpc-search"
					type="search"
					placeholder="GISJOIN, GEOID, or label…"
					bind:value={search}
				/>
			</div>

			<div class="mpc-block mpc-row-btns">
				<button type="button" class="mpc-btn-sec" onclick={() => (selected = new Set())}>Clear selection</button>
				<button type="button" class="mpc-btn-sec" onclick={resetControls}>Reset filters</button>
			</div>

			<div class="mpc-block">
				<span class="mpc-label">Quick county presets</span>
				<div class="mpc-presets">
					{#each countyPresets as p}
						<button type="button" class="mpc-btn-sec" onclick={() => applyPreset(p)}>{p.label}</button>
					{/each}
				</div>
			</div>
		</aside>

		<div class="mpc-content">
			<section class="mpc-card mpc-summary">
				<h2 class="mpc-h2">How to read the evidence</h2>
				<p id="mpc-summary-copy" class="mpc-note">Loading…</p>
				<div class="mpc-summary-grid">
					<div class="mpc-stat">
						<div class="mpc-k">Tracts shown</div>
						<div class="mpc-v" id="mpc-stat-tracts">-</div>
					</div>
					<div class="mpc-stat">
						<div class="mpc-k">Units in window</div>
						<div class="mpc-v" id="mpc-stat-units">-</div>
					</div>
					<div class="mpc-stat">
						<div class="mpc-k">Affordable share</div>
						<div class="mpc-v" id="mpc-stat-aff">-</div>
					</div>
					<div class="mpc-stat">
						<div class="mpc-k">TOD share (MF units)</div>
						<div class="mpc-v" id="mpc-stat-tod">-</div>
					</div>
				</div>
				<div class="mpc-chips">
					{#if selected.size === 0}
						<span class="mpc-chip">All visible tracts</span>
					{:else}
						{#each [...selected].slice(0, 12) as gj}
							<span class="mpc-chip">{formatTractLabel(tractData.find((t) => t.gisjoin === gj) ?? { gisjoin: gj })}</span>
						{/each}
						{#if selected.size > 12}
							<span class="mpc-chip">+{selected.size - 12} more</span>
						{/if}
					{/if}
				</div>
			</section>

			<section class="mpc-card mpc-chart-card">
				<h2 class="mpc-h2">Growth vs poverty exposure</h2>
				<p class="mpc-note">
					Each point is a tract. <strong>X</strong> = poverty rate (%) · <strong>Y</strong> = new development
					· <strong>Size</strong> = affordable units · <strong>Fill</strong> = affordable share ·
					<strong>Stroke</strong> = TOD-dominant (MF TOD vs non-TOD units).
				</p>
				<div class="mpc-chart-wrap" bind:this={elScatter}></div>
			</section>

			<section class="mpc-card mpc-chart-card">
				<h2 class="mpc-h2">Choropleth — tract metrics</h2>
				<div class="mpc-toolbar">
					<label for="mpc-map-m">Map metric</label>
					<select id="mpc-map-m" bind:value={mapMetric}>
						<option value="units">New units in current window</option>
						<option value="affordableUnits">Affordable units in current window</option>
						<option value="under125">Poverty rate (ACS 2020)</option>
						<option value="high125">Low poverty proxy (100 − poverty %)</option>
						<option value="affordableShare">Affordable share</option>
						<option value="todShare">TOD share of units (MF-based)</option>
					</select>
				</div>
				<div class="mpc-chart-wrap mpc-chart-tall" bind:this={elChoro}></div>
			</section>

			<div class="mpc-small-grid">
				<section class="mpc-card mpc-chart-card">
					<h3 class="mpc-h3">Production & affordable share over time</h3>
					<div class="mpc-chart-wrap mpc-chart-sm" bind:this={elTimeline}></div>
				</section>
				<section class="mpc-card mpc-chart-card">
					<h3 class="mpc-h3">TOD vs non-TOD mix by year</h3>
					<div class="mpc-chart-wrap mpc-chart-sm" bind:this={elComposition}></div>
				</section>
			</div>

			<div class="mpc-small-grid">
				<section class="mpc-card mpc-chart-card">
					<h3 class="mpc-h3">Top tracts by new units</h3>
					<p class="mpc-note">Showing up to 16 tracts; labels shortened for readability.</p>
					<div class="mpc-chart-wrap mpc-chart-sm" bind:this={elRanked}></div>
				</section>
				<section class="mpc-card mpc-chart-card">
					<h3 class="mpc-h3">Affordable vs market-rate (by year)</h3>
					<div class="mpc-chart-wrap mpc-chart-sm" bind:this={elAffordMix}></div>
				</section>
			</div>

			<section class="mpc-card mpc-chart-card">
				<h3 class="mpc-h3">Where yearly growth lands (poverty median split)</h3>
				<div class="mpc-chart-wrap mpc-chart-sm" bind:this={elGrowthCapture}></div>
			</section>

			<section class="mpc-card mpc-chart-card">
				<h3 class="mpc-h3">Housing change & cohorts (tract, 2010–20 window)</h3>
				<p class="mpc-note">
					Census percent change in housing units (choropleth); MassBuilds cohort outlines; optional MBTA and
					developments match the <a href="{base}/tract">tract map</a>.
				</p>
				<div class="mpc-chart-wrap mpc-chart-tall mpc-chart-wrap--poc-map">
					<PocNhgisTractMap
						panelState={mpcMapPanel}
						tractList={tractListFiltered}
						nhgisRows={nhgisLikeRows}
						metricsDevelopments={fullWindowDevs}
					/>
				</div>
			</section>

			<div class="mpc-small-grid">
				<section class="mpc-card mpc-chart-card">
					<h3 class="mpc-h3">Income & education — TOD-dominated vs non-TOD vs minimal development</h3>
					<p class="mpc-note">
						Population-weighted means (MassBuilds cohort tiers); p-values for TOD-dominated vs non-TOD-dominated
						only.
					</p>
					<div class="mpc-chart-wrap mpc-chart-sm mpc-chart-tract-edu" bind:this={elTractEdu}></div>
				</section>
				<section class="mpc-card mpc-chart-card">
					<h3 class="mpc-h3">Travel time change</h3>
					<div class="mpc-chart-wrap mpc-chart-sm" bind:this={elMobility}></div>
				</section>
			</div>

			<section class="mpc-card mpc-summary">
				<h3 class="mpc-h3">Bottom line (cohorts, population-weighted)</h3>
				<div class="mpc-takeaway-grid" bind:this={elTakeaway}></div>
			</section>
		</div>
	</section>
</div>

<style>
	.mpc-root {
		--mpc-ink: #1f2430;
		--mpc-muted: #5e6573;
		--mpc-line: #d8d2c7;
		--mpc-paper: #fffdf8;
		--mpc-bg: #f5f2eb;
		--mpc-accent: #00843d;
		--mpc-accent-soft: #d8efe2;
		--mpc-warning: #ed8b00;
		--mpc-blue5: #003da5;
		font-family: var(--font-body);
		color: var(--mpc-ink);
		background: var(--mpc-bg);
		padding: 16px;
		border-radius: 12px;
		flex: 1;
		min-height: 0;
		overflow: auto;
	}

	.mpc-h1 {
		font-size: clamp(1.35rem, 3vw, 2rem);
		margin: 0 0 10px;
		line-height: 1.15;
	}

	.mpc-h2 {
		font-size: 1.15rem;
		margin: 0 0 8px;
	}

	.mpc-h3 {
		font-size: 1.05rem;
		margin: 0 0 8px;
	}

	.mpc-hero {
		padding: 20px 22px;
		margin-bottom: 16px;
	}

	.mpc-eyebrow {
		display: inline-block;
		margin-bottom: 8px;
		padding: 4px 10px;
		border-radius: 999px;
		background: var(--mpc-accent-soft);
		color: #0b5e2c;
		font-weight: 700;
		font-size: 0.72rem;
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}

	.mpc-sub,
	.mpc-note {
		color: var(--mpc-muted);
		line-height: 1.55;
		margin: 0;
		font-size: 0.92rem;
	}

	.mpc-dashboard {
		display: grid;
		grid-template-columns: minmax(260px, 300px) 1fr;
		gap: 16px;
		align-items: start;
	}

	@media (max-width: 1060px) {
		.mpc-dashboard {
			grid-template-columns: 1fr;
		}
	}

	.mpc-card {
		background: var(--mpc-paper);
		border: 1px solid rgba(120, 114, 102, 0.18);
		border-radius: 16px;
		box-shadow: 0 14px 34px rgba(31, 36, 48, 0.08);
		padding: 16px 18px;
	}

	.mpc-controls {
		position: sticky;
		top: 8px;
	}

	.mpc-block {
		margin-top: 14px;
		padding-top: 14px;
		border-top: 1px solid var(--mpc-line);
	}

	.mpc-block:first-of-type {
		border-top: 0;
		padding-top: 0;
	}

	.mpc-details {
		margin-top: 12px;
		padding: 10px 0 4px;
		border-top: 1px solid var(--mpc-line);
	}

	.mpc-details-summary {
		font-weight: 700;
		font-size: 0.92rem;
		cursor: pointer;
		color: var(--mpc-ink);
	}

	.mpc-hint {
		font-size: 0.8rem;
		color: var(--mpc-muted);
		margin: 6px 0 10px;
		line-height: 1.45;
	}

	.mpc-field {
		display: block;
		margin-bottom: 10px;
	}

	.mpc-field-label {
		display: block;
		font-size: 0.8rem;
		font-weight: 600;
		margin-bottom: 4px;
		color: var(--mpc-muted);
	}

	.mpc-field select,
	.mpc-field input[type='number'] {
		width: 100%;
		padding: 8px 10px;
		border: 1px solid #c9c1b4;
		border-radius: 8px;
		font: inherit;
		background: #fff;
	}

	.mpc-label {
		display: block;
		font-weight: 700;
		font-size: 0.88rem;
		margin-bottom: 8px;
	}

	.mpc-range-row {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 8px;
	}

	.mpc-range-row input,
	.mpc-controls select,
	.mpc-controls input[type='search'] {
		width: 100%;
		padding: 8px 10px;
		border: 1px solid #c9c1b4;
		border-radius: 8px;
		font: inherit;
		background: #fff;
	}

	.mpc-controls input[type='range'] {
		width: 100%;
	}

	.mpc-check {
		display: flex;
		align-items: flex-start;
		gap: 8px;
		font-size: 0.88rem;
		cursor: pointer;
	}

	.mpc-check-tight {
		margin-bottom: 4px;
	}

	.mpc-county-grid {
		max-height: 200px;
		overflow: auto;
		padding: 4px 0;
	}

	.mpc-row-btns {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}

	.mpc-btn-sec {
		font: inherit;
		font-size: 0.85rem;
		padding: 7px 12px;
		border-radius: 999px;
		border: 1px solid var(--mpc-line);
		background: #fff;
		cursor: pointer;
		color: var(--mpc-ink);
	}

	.mpc-btn-sec:hover {
		background: #faf7f0;
	}

	.mpc-presets {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}

	.mpc-content {
		display: flex;
		flex-direction: column;
		gap: 14px;
		min-width: 0;
	}

	.mpc-summary-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
		gap: 10px;
		margin-top: 10px;
	}

	.mpc-stat {
		padding: 10px 12px;
		border-radius: 10px;
		background: #faf7f0;
		border: 1px solid var(--mpc-line);
	}

	.mpc-k {
		font-size: 0.78rem;
		color: var(--mpc-muted);
	}

	.mpc-v {
		font-size: 1.25rem;
		font-weight: 700;
	}

	.mpc-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin-top: 10px;
	}

	.mpc-chip {
		font-size: 0.78rem;
		padding: 4px 8px;
		border-radius: 999px;
		background: #eef2ff;
		border: 1px solid #c7d2fe;
	}

	.mpc-chart-card {
		padding: 14px 16px;
	}

	.mpc-chart-wrap {
		min-height: 200px;
		width: 100%;
	}

	.mpc-chart-tall {
		min-height: 480px;
	}

	.mpc-chart-sm {
		min-height: 260px;
	}

	.mpc-chart-tract-edu {
		min-height: 0;
		max-height: min(78vh, 620px);
		overflow: auto;
	}

	.mpc-small-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
		gap: 14px;
	}

	.mpc-toolbar {
		display: flex;
		align-items: center;
		gap: 10px;
		margin-bottom: 8px;
		flex-wrap: wrap;
	}

	.mpc-toolbar select {
		font: inherit;
		padding: 6px 10px;
		border-radius: 8px;
		border: 1px solid #c9c1b4;
	}

	.mpc-takeaway-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
		gap: 10px;
		margin-top: 8px;
	}

	:global(.mpc-root .mpc-empty) {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 160px;
		color: var(--mpc-muted);
		border: 1px dashed var(--mpc-line);
		border-radius: 12px;
		background: #faf7f1;
		padding: 16px;
		text-align: center;
	}

	:global(.mpc-root .mpc-tooltip) {
		position: absolute;
		pointer-events: none;
		background: rgba(17, 24, 39, 0.94);
		color: #fff;
		padding: 8px 10px;
		border-radius: 8px;
		font-size: 12px;
		line-height: 1.45;
		opacity: 0;
		z-index: 20;
		max-width: 280px;
	}

	:global(.mpc-root .mpc-map-zoom-hint) {
		font-size: 0.78rem;
		color: var(--mpc-muted);
		margin: 8px 0 0;
		line-height: 1.45;
	}

	:global(.mpc-root .mpc-tract-edu-legend) {
		display: flex;
		flex-wrap: wrap;
		gap: 10px 20px;
		align-items: center;
		margin-bottom: 6px;
		font-size: 0.82rem;
		color: var(--mpc-muted);
	}

	:global(.mpc-root .mpc-tract-edu-legend-item) {
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}

	:global(.mpc-root .mpc-tract-edu-swatch) {
		width: 11px;
		height: 11px;
		border-radius: 2px;
		flex-shrink: 0;
		box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.08);
	}

	:global(.mpc-root .mpc-chart-note) {
		font-size: 0.85rem;
		color: var(--mpc-muted);
		margin: 0 0 8px;
	}

	:global(.mpc-root .mpc-legend) {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 10px 14px;
		font-size: 0.82rem;
		color: var(--mpc-muted);
	}

	:global(.mpc-root .mpc-legend-item) {
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}

	:global(.mpc-root .mpc-swatch) {
		width: 12px;
		height: 12px;
		border-radius: 3px;
		display: inline-block;
	}

	:global(.mpc-root .mpc-legend-scale) {
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}

	:global(.mpc-root .mpc-legend-ramp span) {
		display: inline-block;
		width: 18px;
		height: 10px;
	}

	:global(.mpc-root .mpc-summary-stat) {
		padding: 12px;
		border-radius: 10px;
		background: #faf7f0;
		border: 1px solid var(--mpc-line);
	}

	:global(.mpc-root .mpc-k) {
		font-size: 0.78rem;
		color: var(--mpc-muted);
	}

	:global(.mpc-root .mpc-v) {
		font-size: 1.1rem;
		font-weight: 700;
	}
</style>
