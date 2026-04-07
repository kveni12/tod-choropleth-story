<script>
	import { base } from '$app/paths';
	import { onDestroy } from 'svelte';
	import * as d3 from 'd3';
	import {
		loadMunicipalData,
		filterMunicipalProjects,
		buildMunicipalityRows,
		activeRows as getActiveRows
	} from '$lib/utils/municipalModel.js';
	import {
		renderMuniScatter,
		renderMuniChoropleth,
		renderMuniTimeline,
		renderMuniComposition,
		renderMuniRankedGrowth,
		renderMuniAffordabilityComposition,
		renderMuniGrowthCapture,
		computeMuniSummary
	} from '$lib/utils/municipalCharts.js';
	import { tractData, developments, tractGeo, meta, mbtaStops } from '$lib/stores/data.svelte.js';
	import { loadAllData } from '$lib/stores/data.svelte.js';
	import {
		DEFAULT_MAIN_POC_DEV_OPTS,
		DEFAULT_MAIN_POC_UNIVERSE,
		buildNhgisLikeRows,
		buildTractDevClassMap,
		buildTractPocRows,
		buildProjectRowsWithGisjoin,
		filterDevelopmentsByYearRange,
		filterTractsForMainPoc,
		uniqueCounties
	} from '$lib/utils/mainPocTractModel.js';
	import { drawMainPocTractCharts } from '$lib/utils/mainPocTractCharts.js';
	import { createPanelState } from '$lib/stores/panelState.svelte.js';
	import PocNhgisTractMap from '$lib/components/PocNhgisTractMap.svelte';
	import {
		filterTractsByTract,
		buildCohortDevelopmentSplit,
		cohortYMeansForYKey,
		getTodTracts,
		getNonTodTracts,
		aggregateDevsByTract,
		filterDevelopments,
		computeGroupMean,
		popWeightKey,
		yMetricDisplayKind,
		formatYMetricSummary
	} from '$lib/utils/derived.js';
	import { periodCensusBounds } from '$lib/utils/periods.js';
	import TodIntensityScatter from '$lib/components/TodIntensityScatter.svelte';

	const fmtInt = d3.format(',');
	const fmtPct1 = d3.format('.1%');

	/* ═══════════════════════════════════════════════════════
	   MUNICIPAL STATE (Part 1)
	   ═══════════════════════════════════════════════════════ */
	let muniLoaded = $state(false);
	let muniData = $state(/** @type {any} */ (null));

	let yearStart = $state(1990);
	let yearEnd = $state(2026);
	let threshold = $state(0.5);
	let growthScale = $state(/** @type {'units' | 'share'} */ ('units'));
	let showTrendline = $state(false);
	let dominanceFilter = $state(/** @type {'all' | 'tod' | 'nonTod'} */ ('all'));
	let zoning = $state(/** @type {Set<string>} */ (new Set()));
	let search = $state('');
	let selected = $state(/** @type {Set<string>} */ (new Set()));
	let mapMetric = $state(/** @type {string} */ ('units'));

	const presets = [
		{ label: 'Boston / Cambridge / Somerville', munis: ['Boston', 'Cambridge', 'Somerville'] },
		{ label: 'Newton / Brookline / Wellesley', munis: ['Newton', 'Brookline', 'Wellesley'] },
		{ label: 'Quincy / Malden / Revere', munis: ['Quincy', 'Malden', 'Revere'] }
	];

	/* ── Play-years animation ─────────────────────────── */
	let playTimer = $state(/** @type {ReturnType<typeof setInterval> | null} */ (null));
	let playPending = $state(false);

	function stopPlayback() {
		if (playTimer) {
			clearInterval(playTimer);
			playTimer = null;
		}
	}

	function togglePlayback() {
		if (playTimer) {
			stopPlayback();
			return;
		}
		if (yearEnd >= 2026) yearEnd = yearStart;
		playTimer = setInterval(() => {
			if (yearEnd >= 2026) {
				stopPlayback();
				return;
			}
			yearEnd += 1;
		}, 700);
	}

	onDestroy(() => stopPlayback());

	/* ── Derived municipal data ───────────────────────── */
	const muniState = $derived({
		yearStart,
		yearEnd,
		threshold,
		growthScale,
		showTrendline,
		dominanceFilter,
		zoning,
		search,
		selected,
		mapMetric
	});

	const projectRows = $derived.by(() => {
		if (!muniData) return [];
		return filterMunicipalProjects(muniData.projects, muniState);
	});

	const allProjectRows = $derived.by(() => {
		if (!muniData) return [];
		return filterMunicipalProjects(muniData.projects, muniState, false);
	});

	const visibleRows = $derived.by(() => {
		if (!muniData) return [];
		const rows = buildMunicipalityRows(
			projectRows,
			muniData.municipalityList,
			muniData.incomeByNorm,
			muniData.storyByNorm,
			muniData.householdByNorm,
			threshold,
			muniState
		);
		if (dominanceFilter === 'all') return rows;
		return rows.filter(
			(d) => dominanceFilter === 'tod' ? d.dominant === 'tod' : d.dominant !== 'tod'
		);
	});

	const domainRows = $derived.by(() => {
		if (!muniData) return [];
		return buildMunicipalityRows(
			allProjectRows,
			muniData.municipalityList,
			muniData.incomeByNorm,
			muniData.storyByNorm,
			muniData.householdByNorm,
			threshold,
			{ ...muniState, yearStart: 1990, yearEnd: 2026 },
			false
		);
	});

	const muniActive = $derived(getActiveRows(visibleRows, selected));

	const summary = $derived.by(() =>
		computeMuniSummary(visibleRows, muniActive, projectRows, muniState)
	);

	/* ── Element refs (municipal) ─────────────────────── */
	let elScatter = $state(/** @type {HTMLElement | undefined} */ (undefined));
	let elChoro = $state(/** @type {HTMLElement | undefined} */ (undefined));
	let elTimeline = $state(/** @type {HTMLElement | undefined} */ (undefined));
	let elComposition = $state(/** @type {HTMLElement | undefined} */ (undefined));
	let elRanked = $state(/** @type {HTMLElement | undefined} */ (undefined));
	let elAffordMix = $state(/** @type {HTMLElement | undefined} */ (undefined));
	let elGrowthCapture = $state(/** @type {HTMLElement | undefined} */ (undefined));

	function draw() {
		if (!muniData || !elScatter) return;
		const cb = { onSelectionChange: () => { selected = new Set(selected); } };
		renderMuniScatter(elScatter, visibleRows, domainRows, muniState, cb);
		renderMuniChoropleth(elChoro, visibleRows, domainRows, muniData.muniGeo, muniState, cb);
		renderMuniTimeline(elTimeline, projectRows, muniState);
		renderMuniComposition(elComposition, projectRows, muniState);
		renderMuniRankedGrowth(elRanked, visibleRows);
		renderMuniAffordabilityComposition(elAffordMix, projectRows, muniState);
		renderMuniGrowthCapture(elGrowthCapture, projectRows, domainRows, muniState);
	}

	// Debounce draw during playback via rAF
	let rafId = 0;
	$effect(() => {
		void visibleRows;
		void domainRows;
		void projectRows;
		void muniActive;
		void mapMetric;
		cancelAnimationFrame(rafId);
		rafId = requestAnimationFrame(() => draw());
	});

	/* ── Load municipal data on mount ─────────────────── */
	$effect(() => {
		loadMunicipalData(base).then((data) => {
			muniData = data;
			zoning = new Set(data.zoningOptions);
			muniLoaded = true;
		});
	});

	function resetMuniControls() {
		stopPlayback();
		yearStart = 1990;
		yearEnd = 2026;
		threshold = 0.5;
		growthScale = 'units';
		showTrendline = false;
		dominanceFilter = 'all';
		search = '';
		selected = new Set();
		mapMetric = 'units';
		if (muniData) zoning = new Set(muniData.zoningOptions);
	}

	/* ═══════════════════════════════════════════════════════
	   TRACT STATE (Part 2)
	   ═══════════════════════════════════════════════════════ */
	let tractLoading = $state(true);
	let tractError = $state(/** @type {string | null} */ (null));
	let tractReady = $state(false);

	// Tract analysis defaults (sensible, no user controls)
	const tractTimePeriod = '10_20';
	const tractSigDevMin = 2;
	const tractTodFractionCutoff = 0.5;

	const pocMapPanel = createPanelState('poc-alt');

	$effect(() => {
		if (!tractReady) return;
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
	});

	$effect(() => {
		loadAllData()
			.then(() => {
				tractReady = true;
				tractError = null;
			})
			.catch((e) => {
				tractError = e instanceof Error ? e.message : String(e);
			})
			.finally(() => {
				tractLoading = false;
			});
	});

	// Shared TOD threshold from Part 1
	const tractPanelConfig = $derived({
		timePeriod: tractTimePeriod,
		minStops: DEFAULT_MAIN_POC_UNIVERSE.minStops,
		transitDistanceMi: threshold,
		sigDevMinPctStockIncrease: tractSigDevMin,
		todFractionCutoff: tractTodFractionCutoff,
		huChangeSource: 'massbuilds',
		minPopulation: DEFAULT_MAIN_POC_UNIVERSE.minPopulation,
		minPopDensity: DEFAULT_MAIN_POC_UNIVERSE.minPopDensity,
		minUnitsPerProject: DEFAULT_MAIN_POC_DEV_OPTS.minUnitsPerProject,
		minDevMultifamilyRatioPct: DEFAULT_MAIN_POC_DEV_OPTS.minDevMultifamilyRatioPct,
		minDevAffordableRatioPct: DEFAULT_MAIN_POC_DEV_OPTS.minDevAffordableRatioPct,
		includeRedevelopment: DEFAULT_MAIN_POC_DEV_OPTS.includeRedevelopment
	});

	const tractDevOpts = $derived({
		minUnitsPerProject: DEFAULT_MAIN_POC_DEV_OPTS.minUnitsPerProject,
		minDevMultifamilyRatioPct: DEFAULT_MAIN_POC_DEV_OPTS.minDevMultifamilyRatioPct,
		minDevAffordableRatioPct: DEFAULT_MAIN_POC_DEV_OPTS.minDevAffordableRatioPct,
		includeRedevelopment: DEFAULT_MAIN_POC_DEV_OPTS.includeRedevelopment
	});

	const tractCounties = $derived.by(() => {
		if (!tractData.length) return new Set();
		return new Set(uniqueCounties(tractData));
	});

	const tractListFiltered = $derived.by(() => {
		if (!tractData.length) return [];
		return filterTractsForMainPoc(tractData, tractCounties, '', {
			timePeriod: tractTimePeriod,
			minStops: DEFAULT_MAIN_POC_UNIVERSE.minStops,
			minPopulation: DEFAULT_MAIN_POC_UNIVERSE.minPopulation,
			minPopDensity: DEFAULT_MAIN_POC_UNIVERSE.minPopDensity
		});
	});

	const tractWindowDevs = $derived.by(() =>
		filterDevelopmentsByYearRange(developments, 1990, 2026, tractDevOpts)
	);

	const tractDevClassByGj = $derived.by(() =>
		buildTractDevClassMap(
			tractListFiltered,
			tractWindowDevs,
			{ timePeriod: tractTimePeriod, minStops: DEFAULT_MAIN_POC_UNIVERSE.minStops, minPopulation: DEFAULT_MAIN_POC_UNIVERSE.minPopulation, minPopDensity: DEFAULT_MAIN_POC_UNIVERSE.minPopDensity },
			threshold,
			tractDevOpts,
			tractSigDevMin,
			tractTodFractionCutoff
		)
	);

	const nhgisLikeRows = $derived.by(() => buildNhgisLikeRows(tractListFiltered, tractDevClassByGj));

	// Cohort dev split for affordability analysis
	const cohortDevSplit = $derived.by(() => {
		if (!tractData.length || !developments.length) return { tod: [], nonTod: [], minimal: [] };
		return buildCohortDevelopmentSplit(tractData, tractPanelConfig, developments);
	});

	const cohortRowsByY = $derived.by(() => {
		if (!meta.yVariables?.length) return [];
		const tp = tractTimePeriod;
		const weightKey = popWeightKey(tp);
		const rows = [];
		for (const v of meta.yVariables) {
			const yKey = `${v.key}_${tp}`;
			const raw = cohortYMeansForYKey(cohortDevSplit, yKey, weightKey);
			const kind = yMetricDisplayKind(v);
			rows.push({
				key: v.key,
				label: v.label ?? v.key,
				catLabel: v.catLabel ?? 'Outcomes',
				fmtTod: formatYMetricSummary(raw.meanTod, kind),
				fmtCtrl: formatYMetricSummary(raw.meanNonTod, kind),
				fmtMinimal: formatYMetricSummary(raw.meanMinimal, kind),
				rawTod: raw.meanTod,
				rawCtrl: raw.meanNonTod,
				rawMinimal: raw.meanMinimal,
				nTod: raw.nTod,
				nNonTod: raw.nNonTod,
				nMinimal: raw.nMinimal
			});
		}
		return rows;
	});

	// Income and education row references for inline numbers
	const incomeRow = $derived(cohortRowsByY.find((r) => r.key === 'median_income_change_pct'));
	const eduRow = $derived(cohortRowsByY.find((r) => r.key === 'bachelors_pct_change'));

	// Affordability split: among TOD tracts, high vs low affordable share
	const todRows = $derived.by(() => {
		if (!tractData.length || !developments.length) return [];
		return getTodTracts(tractData, tractPanelConfig, developments);
	});

	const nonTodRows = $derived.by(() => {
		if (!tractData.length || !developments.length) return [];
		return getNonTodTracts(tractData, tractPanelConfig, developments);
	});

	const affShareMap = $derived.by(() => {
		const tractMap = new Map();
		for (const t of tractData) if (t.gisjoin) tractMap.set(t.gisjoin, t);
		const filteredDevs = filterDevelopments(developments, tractPanelConfig);
		return aggregateDevsByTract(filteredDevs, tractMap, tractTimePeriod, tractPanelConfig);
	});

	/** High vs low affordable TOD tracts: ≥50% affordable share vs &lt;50% (not a median split). */
	const AFF_SPLIT_THRESHOLD = 0.5;

	const affSplitCohorts = $derived.by(() => {
		const tod = todRows;
		const todAff = tod.filter((t) => {
			const agg = affShareMap.get(t.gisjoin);
			return agg && Number.isFinite(agg.affordable_share);
		});
		const getAffShare = (t) => affShareMap.get(t.gisjoin)?.affordable_share ?? NaN;
		const hiAff = todAff.filter((t) => getAffShare(t) >= AFF_SPLIT_THRESHOLD);
		const loAff = todAff.filter((t) => getAffShare(t) < AFF_SPLIT_THRESHOLD);
		return { todAff, hiAff, loAff, affSplitThreshold: AFF_SPLIT_THRESHOLD };
	});

	const affSplitRowsByY = $derived.by(() => {
		if (!meta.yVariables?.length) return [];
		const { hiAff, loAff } = affSplitCohorts;
		if (!hiAff.length || !loAff.length) return [];
		const tp = tractTimePeriod;
		const weightKey = popWeightKey(tp);
		const rows = [];
		for (const v of meta.yVariables) {
			const yKey = `${v.key}_${tp}`;
			const meanHi = computeGroupMean(hiAff, yKey, weightKey);
			const meanLo = computeGroupMean(loAff, yKey, weightKey);
			const kind = yMetricDisplayKind(v);
			rows.push({
				key: v.key,
				label: v.label ?? v.key,
				catLabel: v.catLabel ?? 'Outcomes',
				fmtHi: formatYMetricSummary(meanHi, kind),
				fmtLo: formatYMetricSummary(meanLo, kind),
				rawHi: meanHi,
				rawLo: meanLo,
				nHi: hiAff.length,
				nLo: loAff.length
			});
		}
		return rows;
	});

	const affIncomeRow = $derived(affSplitRowsByY.find((r) => r.key === 'median_income_change_pct'));
	const affEduRow = $derived(affSplitRowsByY.find((r) => r.key === 'bachelors_pct_change'));

	/** Panel state for the TodIntensityScatter — shared config + a yVar override. */
	function makeTodScatterPanelState(yVar) {
		return {
			timePeriod: tractTimePeriod,
			yVar,
			transitDistanceMi: threshold,
			sigDevMinPctStockIncrease: tractSigDevMin,
			todFractionCutoff: tractTodFractionCutoff,
			huChangeSource: 'massbuilds',
			minPopulation: DEFAULT_MAIN_POC_UNIVERSE.minPopulation,
			minPopDensity: DEFAULT_MAIN_POC_UNIVERSE.minPopDensity,
			minStops: DEFAULT_MAIN_POC_UNIVERSE.minStops,
			minUnitsPerProject: DEFAULT_MAIN_POC_DEV_OPTS.minUnitsPerProject,
			minDevMultifamilyRatioPct: DEFAULT_MAIN_POC_DEV_OPTS.minDevMultifamilyRatioPct,
			minDevAffordableRatioPct: DEFAULT_MAIN_POC_DEV_OPTS.minDevAffordableRatioPct,
			includeRedevelopment: DEFAULT_MAIN_POC_DEV_OPTS.includeRedevelopment,
			trimOutliers: true,
			hoveredTract: null,
			selectedTracts: new Set(),
			/** @param {string | null} gisjoin */
			setHovered(gisjoin) {
				this.hoveredTract = gisjoin;
			},
			/** @param {string} gisjoin */
			toggleTract(gisjoin) {
				const next = new Set(this.selectedTracts);
				if (next.has(gisjoin)) next.delete(gisjoin);
				else next.add(gisjoin);
				this.selectedTracts = next;
			}
		};
	}

	/** $state so hover/selection updates rerun TodIntensityScatter effects (plain $derived objects are not deeply reactive). */
	let incomePanelState = $state(makeTodScatterPanelState('median_income_change_pct'));
	let eduPanelState = $state(makeTodScatterPanelState('bachelors_pct_change'));

	$effect(() => {
		void threshold;
		incomePanelState = makeTodScatterPanelState('median_income_change_pct');
		eduPanelState = makeTodScatterPanelState('bachelors_pct_change');
	});

	/* ── Tract chart element refs ─────────────────────── */
	let elTractEdu = $state(/** @type {HTMLElement | undefined} */ (undefined));
	let elTakeaway = $state(/** @type {HTMLElement | undefined} */ (undefined));

	$effect(() => {
		if (!tractReady || !tractData.length || !developments.length) return;
		const devOpts2 = tractDevOpts;
		const windowDevs = filterDevelopmentsByYearRange(developments, 1990, 2026, devOpts2);

		const pocRows = buildTractPocRows(tractListFiltered, windowDevs, threshold, 0).filter(
			(d) => Number.isFinite(d.vulnerabilityPct)
		);
		const projRows = buildProjectRowsWithGisjoin(developments, 1990, 2026, threshold, devOpts2);

		drawMainPocTractCharts({
			elScatter: null,
			elChoro: null,
			elTimeline: null,
			elComposition: null,
			elRanked: null,
			elAffordMix: null,
			elGrowthCapture: null,
			elTractEdu,
			elMobility: null,
			elTakeaway,
			state: {
				yearStart: 1990,
				yearEnd: 2026,
				threshold,
				growthScale: 'units',
				showTrendline: false,
				dominanceFilter: 'all',
				search: '',
				selected: new Set(),
				mapMetric: 'units'
			},
			visibleRows: pocRows,
			domainRows: pocRows,
			projectRows: projRows,
			selectedProjectRows: projRows,
			nhgisLikeRows,
			tractGeo
		});
	});
</script>

<div class="poc-root">
	<!-- ═══════════════════════════════════════════════════════
	     HERO / THESIS
	     ═══════════════════════════════════════════════════════ -->
	<section class="hero-full card">
		<div class="eyebrow">Proof of Concept</div>
		<h1>TOD's link with gentrification: how affordability helps.</h1>
		<p class="subtitle">
			As Massachusetts works to encourage transit-oriented development, policymakers should be aware
			that this development can cause displacement, gentrification, and other demographic changes.
			The "transit premium" shifts the demographic profile of neighborhoods — as high-density,
			mixed-use developments are built around stations, they attract high-income professionals who
			value commute efficiency. This naturally creates a polarized economic landscape near public transit.
			In order to minimize these effects, <strong>TOD projects must include a substantial number
			of affordable housing units</strong>.
		</p>
	</section>

	{#if !muniLoaded}
		<div class="loading-status">
			<div class="spinner" aria-hidden="true"></div>
			<p>Loading municipal data…</p>
		</div>
	{:else}

	<!-- ═══════════════════════════════════════════════════════
	     PART 1 — MUNICIPAL DASHBOARD
	     ═══════════════════════════════════════════════════════ -->
	<section class="dashboard">
		<aside class="controls card">
			<div class="controls-inner">
			<h2>Controls</h2>
			<p class="controls-note">Primary controls: adjust the time window, the TOD distance definition, and the municipality scope.</p>

			<div class="control-block">
				<label class="label">Completion year range</label>
				<div class="range-row">
					<input type="number" min="1990" max="2026" bind:value={yearStart} onchange={() => { stopPlayback(); if (yearStart > yearEnd) yearStart = yearEnd; }} />
					<input type="number" min="1990" max="2026" bind:value={yearEnd} onchange={() => { stopPlayback(); if (yearEnd < yearStart) yearEnd = yearStart; }} />
				</div>
				<div class="play-row">
					<button class="secondary" type="button" onclick={togglePlayback}>
						{playTimer ? 'Pause' : 'Play years'}
					</button>
					<div class="play-slider-wrap">
						<input type="range" min="1990" max="2026" bind:value={yearEnd} oninput={() => stopPlayback()} />
						<div class="play-caption">Showing cumulative development from {yearStart} through {yearEnd}.</div>
					</div>
				</div>
			</div>

			<div class="control-block">
				<label class="label">TOD threshold: {threshold.toFixed(2)} miles</label>
				<input type="range" min="0.2" max="1.5" step="0.05" bind:value={threshold} />
			</div>

			<div class="control-block">
				<label class="label" for="poc-growth-scale">Growth scale</label>
				<select id="poc-growth-scale" bind:value={growthScale}>
					<option value="units">Raw units</option>
					<option value="share">Share of visible-window growth</option>
				</select>
			</div>

			<div class="control-block">
				<label class="check-item">
					<input type="checkbox" bind:checked={showTrendline} />
					<span>Show trendline on main scatter</span>
				</label>
			</div>

			<div class="control-block">
				<label class="label" for="poc-dom-filter">Show municipalities</label>
				<select id="poc-dom-filter" bind:value={dominanceFilter}>
					<option value="all">All municipalities</option>
					<option value="tod">TOD-dominant only</option>
					<option value="nonTod">Non-TOD-dominant only</option>
				</select>
			</div>

			<div class="control-block">
				<label class="label">Zoning profile</label>
				<div class="check-grid">
					{#if muniData}
						{#each muniData.zoningOptions as z (z)}
							<label class="check-item">
								<input type="checkbox" checked={zoning.has(z)} onchange={() => {
									const next = new Set(zoning);
									if (next.has(z)) next.delete(z); else next.add(z);
									zoning = next;
								}} />
								<span>{z}</span>
							</label>
						{/each}
					{/if}
				</div>
			</div>

			<div class="control-block">
				<label class="label" for="poc-search">Municipality search</label>
				<input id="poc-search" type="search" placeholder="Search municipality..." bind:value={search} />
			</div>

			<div class="control-block">
				<div class="button-row">
					<button class="secondary" type="button" onclick={() => { selected = new Set(); }}>Clear selection</button>
					<button class="secondary" type="button" onclick={resetMuniControls}>Reset filters</button>
				</div>
			</div>

			<div class="control-block">
				<label class="label">Quick compare presets</label>
				<div class="preset-row">
					{#each presets as p}
						<button class="secondary" type="button" onclick={() => {
							selected = new Set(p.munis.filter((m) => muniData.allMunicipalities.includes(m)));
						}}>{p.label}</button>
					{/each}
				</div>
			</div>
			</div>
		</aside>

		<div class="content">
			<!-- ── Summary stats ─────────────────────────── -->
			<section class="summary card">
				<h2>Summary of Selected Data</h2>
				<p class="chart-note">
					From <strong>{yearStart}</strong> through <strong>{yearEnd}</strong>, the visible municipalities
					average <strong>{summary.avgIncome.toFixed(1)}%</strong> of households under $125k.
					<strong>{summary.todDominantCount}</strong> of the {summary.selectionCount} selected-or-visible
					municipalities are currently TOD-dominant by unit count.
					<!-- , and the weighted affordable share is
					<strong>{fmtPct1(summary.avgAffordable || 0)}</strong>. -->
				</p>
				<div class="summary-grid">
					<div class="summary-stat"><div class="k">Municipalities shown</div><div class="v">{fmtInt(summary.muniCount)}</div></div>
					<div class="summary-stat"><div class="k">Units in window</div><div class="v">{fmtInt(summary.totalUnits)}</div></div>
					<div class="summary-stat"><div class="k">Affordable share</div><div class="v">{fmtPct1(summary.affordableShare)}</div></div>
					<div class="summary-stat"><div class="k">TOD share of units</div><div class="v">{fmtPct1(summary.todShare)}</div></div>
				</div>
				<div class="selection-chips">
					{#if selected.size === 0}
						<span class="chip">All visible municipalities</span>
					{:else}
						{#each [...selected].sort() as name}
							<span class="chip">{name}</span>
						{/each}
					{/if}
				</div>
			</section>

			<!-- ── 2. How much TOD? ─────────────────────── -->
			<section class="story card">
				<h2>How much TOD is actually being built?</h2>
				<p>
					Despite policy efforts, most new housing being built consists of non-TOD units. However, total development has increased over time,
					so the volume of TOD units has also been increasing. This pattern may change as the incentives of the MBTA Communities Act begin to take effect.
				</p>
			</section>

			<div class="small-grid">
				<section class="chart-card card">
					<h3>TOD vs non-TOD mix by year</h3>
					<div class="chart-wrap small-chart" bind:this={elComposition}></div>
				</section>
				<section class="chart-card card">
					<h3>When production rises, affordability often lags</h3>
					<p class="chart-note">
						In recent years, despite increasing total production, the share of affordable newly-constructed units has decreased significantly.
					</p>
					<div class="chart-wrap small-chart" bind:this={elTimeline}></div>
				</section>
			</div>

			<!-- ── 3. Where is it happening? ────────────── -->
			<section class="story card">
				<h2>Where is TOD taking place?</h2>
				<p>
					Development is not distributed evenly across Massachusetts, and transit-oriented development is specifically concentrated in lower-income municipalities.
				</p>
			</section>

			<section class="chart-card card">
				<h2>Lower-income municipalities see the most TOD</h2>
				<div class="chart-wrap" bind:this={elScatter}></div>
			</section>

			<div class="small-grid">
				<section class="chart-card card">
					<h3>New development is concentrated in a small set of municipalities</h3>
					<!-- <p class="chart-note">
						Darker fill means more affordability inside that growth. Large growth with low affordability
						is the clearest gentrification-warning pattern.
					</p> -->
					<div class="chart-wrap small-chart" bind:this={elRanked}></div>
				</section>
				<section class="chart-card card">
					<h3>The map shows where vulnerability and growth overlap</h3>
					<div class="chart-toolbar">
						<label class="label" for="poc-map-metric" style="margin:0">Map metric</label>
						<select id="poc-map-metric" bind:value={mapMetric}>
							<option value="units">New units in current window</option>
							<option value="affordableUnits">Affordable units</option>
							<option value="under125">Households under $125k</option>
							<option value="high125">Households $125k+</option>
							<option value="affordableShare">Affordable share</option>
							<option value="todShare">TOD share of units</option>
						</select>
					</div>
					<div class="chart-wrap small-chart" bind:this={elChoro}></div>
				</section>
			</div>

			<!-- ── 4. Most not affordable (single card: narrative + chart) ───────────────── -->
			<section class="card story-chart-panel">
				<div class="story-chart-panel__grid">
					<div class="story-chart-panel__text">
						<h2>The issue of affordability</h2>
						<p>
							A primary concern for many residents is the gap between housing supply and genuine affordability.
							Although TOD projects often increase the total number of housing units, a greater proportion
							are market-rate and therefore unprotected. For low-to-moderate income households, the benefit
							of reduced transportation costs is then negated by the sharp rise in rent — and as a result,
							<strong>lower-income residents are pushed further to the periphery</strong>.
						</p>
					</div>
					<div class="story-chart-panel__chart">
						<h3>Most new housing is still market-rate</h3>
						<p class="chart-note">
							The percentage of new development that is affordable has decreased significantly in recent years,
							which likely indicates that lower-income residents are benefitting much less from the new development.
						</p>
						<div class="chart-wrap small-chart compact-side-chart" bind:this={elAffordMix}></div>
					</div>
				</div>
			</section>

			<!-- ── 5. Displacement explanation ──────────── -->
			<section class="story card">
				<h2>The relationship between new development and gentrification</h2>
				<p>
					There are many indicators that new development is associated with gentrification, including:
				</p>
				<ul class="story-list">
					<li>Sharp increase in median income, often serving as a <strong>lead indicator for rising housing costs</strong></li>
					<li>Rapid increase in the percentage of residents with bachelor's degrees or higher</li>
					<li>A shift from owner-occupied housing to high-turnover rental units</li>
					<li>Replacement of "legacy" small businesses with high-end retail and services tailored to a wealthier demographic</li>
				</ul>
				<p>
					With the transit premium shifting the demographic profile of neighborhoods, high-income
					professionals attracted by commute efficiency change the economic landscape. Areas
					near public transit see rising property values, and without affordability protections, this
					process accelerates displacement of vulnerable populations.
				</p>
			</section>

			<!-- ── 6. Higher-vulnerability areas (single card: narrative + chart) ─────────── -->
			<section class="card story-chart-panel">
				<div class="story-chart-panel__grid">
					<div class="story-chart-panel__text">
						<h2>The communities most at risk of gentrification are seeing the most development</h2>
						<p>
							Municipalities with more households whose incomes are below $125k are seeing greater new development.
							These areas are both the most vulnerable, and the most likely to be affected.
						</p>
					</div>
					<div class="story-chart-panel__chart">
						<h3>Development in above-median vulnerability municipalities vs below-median vulnerability municipalities</h3>
						<div class="chart-wrap small-chart compact-side-chart" bind:this={elGrowthCapture}></div>
					</div>
				</div>
			</section>
		</div>
	</section>

	<!-- ═══════════════════════════════════════════════════════
	     PART 2 — TRACT ANALYSIS
	     ═══════════════════════════════════════════════════════ -->
	<section class="tract-section">
		<!-- ── 7. Transition to tract analysis ──────────── -->
		<section class="story card full-width">
			<h2>How does this TOD affect specific demographics?</h2>
			<p>
				The impact of gentrification can be investigated by looking at how specific demographics change
				as new development occurs.
			</p>
			<h4>Data analysis methodology</h4>
			<p>
				Development, transit-oriented or otherwise, often results in demographic change. In order to
				isolate the influence of TOD from the influence of development generally, we filter out all
				census tracts with <strong>minimal development</strong> (less than 2% increase in housing
				stock), since these are likely to show different demographic changes than high-development
				tracts. Among high-development tracts, we compare primarily <strong>TOD-dominated tracts</strong>
				(where TOD units make up at least 50% of new development)
				with primarily <strong>non-TOD-dominated tracts</strong>
				(where TOD units make up less than 50% of new development).
			</p>
			<p>
				The TOD distance threshold of <strong>{threshold.toFixed(2)} miles</strong> from Part 1
				carries through to the tract analysis below — adjust the slider above to see how it affects
				the demographic patterns.
			</p>
		</section>

		{#if tractLoading}
			<div class="loading-status">
				<div class="spinner" aria-hidden="true"></div>
				<p>Loading tract data…</p>
			</div>
		{:else if tractError}
			<div class="loading-status loading-status--error">
				<h3>Failed to load tract data</h3>
				<p>{tractError}</p>
			</div>
		{:else}
			<!-- Tract cohort map -->
			<section class="chart-card card full-width">
				<h3>Tract categorizations and housing change overview (tract, 2010–20 window)</h3>
				<p class="chart-note">
					Tracts are colored by <strong>census percent change in housing units (2010–20)</strong> and outlined by
					MassBuilds cohort (TOD-dominated vs non-TOD-dominated vs minimal development). Use the overlays for
					MBTA lines, stops, and MassBuilds projects (same encoding as the
					<a href="{base}/tract">tract map</a>).
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

			<!-- ── 8. Income analysis ──────────────────── -->
			<div class="story-chart-row story-chart-row--tract full-width">
				<section class="story card story-chart-text">
					<h2>Income analysis</h2>
					<p>
						We can get a sense of the socioeconomic distribution of people by looking at the median income
						of a neighborhood.
						{#if incomeRow}
							In census tracts dominated by TOD, the median income changes by
							<strong>{incomeRow.fmtTod}</strong>, while in non-TOD dominated tracts it changes by
							<strong>{incomeRow.fmtCtrl}</strong>, and in minimal development tracts by
							<strong>{incomeRow.fmtMinimal}</strong>.
						{/if}
						This likely indicates that areas with significant TOD see a larger influx of higher-income
						residents, which is usually tied to gentrification.
					</p>
					<p>
						With the transit premium shifting demographic profiles, high-density mixed-use developments
						around stations attract high-income professionals who value commute efficiency. This naturally
						creates a polarized economic landscape near public transit.
					</p>
				</section>

				<section class="chart-card card story-chart-plot">
					<h3>TOD intensity vs median income change</h3>
					<p class="chart-note">
						This plot shows that not only does TOD correspond to greater income jumps than non-TOD,
						but <em>more</em> TOD development pushes incomes up faster than <em>more</em> non-TOD development.
						Each point is a tract; color = TOD share of new units; size = population.
					</p>
					<div class="scatter-container scatter-container--compact">
						<TodIntensityScatter panelState={incomePanelState} wideLayout />
					</div>
				</section>
			</div>

			<!-- ── 9. Education analysis ───────────────── -->
			<div class="story-chart-row story-chart-row--tract full-width">
				<section class="story card story-chart-text">
					<h2>Education analysis</h2>
					<p>
						Another indicator of socioeconomic change is the percentage of people who are college-educated.
						{#if eduRow}
							In TOD-dominated tracts, the bachelor's degree share changes by
							<strong>{eduRow.fmtTod}</strong>, compared to
							<strong>{eduRow.fmtCtrl}</strong> in non-TOD dominated tracts and
							<strong>{eduRow.fmtMinimal}</strong> in minimal development tracts.
						{/if}
						Since education is uncommon later in life, changes in education levels are usually the result
						of new residents moving in, and often correspond wealthier residents and rising housing costs.
					</p>
				</section>

				<section class="chart-card card story-chart-plot">
					<h3>TOD intensity vs bachelor's degree share change</h3>
					<p class="chart-note">
						The same pattern holds for education: tracts with more TOD see larger increases in the share
						of residents with bachelor's degrees or higher — a lead indicator of gentrification pressure.
					</p>
					<div class="scatter-container scatter-container--compact">
						<TodIntensityScatter panelState={eduPanelState} wideLayout />
					</div>
				</section>
			</div>

			<section class="chart-card card full-width">
				<h3>Income & education — TOD-dominated vs non-TOD vs minimal development</h3>
				<p class="chart-note">
					Population-weighted means (MassBuilds cohort tiers); bars compare TOD-dominated,
					non-TOD-dominated significant development, and minimal development tracts.
					TOD-dominated tracts see greater income and education increases than both non-TOD
					dominated and minimal development tracts.
				</p>
				<div class="chart-wrap chart-wrap--tract-edu" bind:this={elTractEdu}></div>
			</section>

			<!-- ── 10. How affordability helps ──────────── -->
			<section class="story card full-width">
				<h2>How increased affordability can mitigate these effects</h2>
				<p>
					Among TOD-dominated tracts, we compare those where <strong>at least half</strong> of new
					development is affordable (≥{(affSplitCohorts.affSplitThreshold * 100).toFixed(0)}% affordable share)
					to those where <strong>less than half</strong> is affordable.
					Comparing these two groups reveals whether affordability moderates
					the demographic changes associated with TOD.
				</p>
				{#if affIncomeRow && affEduRow}
					<p>
						In TOD tracts with a higher affordable share, median income changes by
						<strong>{affIncomeRow.fmtHi}</strong> (vs. <strong>{affIncomeRow.fmtLo}</strong> in
						low-affordable TOD tracts). For education, the bachelor's share changes by
						<strong>{affEduRow.fmtHi}</strong> vs. <strong>{affEduRow.fmtLo}</strong>.
						This indicates that <strong>median incomes and education levels go up less in more affordable
						tracts</strong> — the demographic disruption is moderated.
					</p>
				{/if}
				<!-- <p>
					The benefit of reduced transportation costs is negated by the sharp rise in rent when
					affordability protections are absent. When affordable units are included, the displacement
					pressure is reduced.
				</p> -->
			</section>

			<!-- ── 11. Bottom line ──────────────────────── -->
			<section class="summary card full-width">
				<h2>Bottom line</h2>
				<p class="chart-note">
					The tract-level evidence sharpens the same takeaway as the municipal dashboard:
					TOD is only anti-gentrification policy when affordability grows with it.
				</p>

				<h3>TOD-dominated vs non-TOD-dominated</h3>
				{#if cohortRowsByY.length}
					<div class="takeaway-grid">
						{#each cohortRowsByY.filter((r) => r.key === 'median_income_change_pct' || r.key === 'bachelors_pct_change') as row (row.key)}
							<div class="takeaway-card">
								<div class="takeaway-label">{row.label}</div>
								<div class="takeaway-row">
									<span class="takeaway-tag tod">TOD</span>
									<span class="takeaway-value">{row.fmtTod}</span>
								</div>
								<div class="takeaway-row">
									<span class="takeaway-tag ctrl">non-TOD</span>
									<span class="takeaway-value">{row.fmtCtrl}</span>
								</div>
								<div class="takeaway-row">
									<span class="takeaway-tag minimal">minimal development</span>
									<span class="takeaway-value">{row.fmtMinimal}</span>
								</div>
							</div>
						{/each}
					</div>
				{/if}

				<h3 style="margin-top: 18px;">High-affordable vs low-affordable TOD tracts</h3>
				{#if affSplitRowsByY.length}
					<div class="takeaway-grid">
						{#each affSplitRowsByY.filter((r) => r.key === 'median_income_change_pct' || r.key === 'bachelors_pct_change') as row (row.key)}
							<div class="takeaway-card">
								<div class="takeaway-label">{row.label}</div>
								<div class="takeaway-row">
									<span class="takeaway-tag hi-aff">High aff.</span>
									<span class="takeaway-value">{row.fmtHi}</span>
								</div>
								<div class="takeaway-row">
									<span class="takeaway-tag lo-aff">Low aff.</span>
									<span class="takeaway-value">{row.fmtLo}</span>
								</div>
							</div>
						{/each}
					</div>
				{:else}
					<p class="chart-note">No affordable-share data available to compare.</p>
				{/if}

				<div class="chart-wrap" style="margin-top: 16px;" bind:this={elTakeaway}></div>
			</section>

			<!-- ── 12. Conclusion ──────────────────────── -->
			<section class="story card full-width conclusion">
				<h2>Conclusion</h2>
				<p>
					TOD is associated with gentrification, but these effects can be mitigated by increasing the
					share of TOD units that are affordable. 
					<!-- This narrative highlights that <strong>inclusionary
					zoning</strong>, <strong>rent stabilization</strong>, and <strong>subsidized transit passes</strong>
					are key to preventing housing exclusivity. -->
				</p>
				<p>
					Without affordable housing controls, TOD naturally moves towards exclusionary policy. 
					When considering housing, transit accessibility
					is simultaneously a public good and a risk -- <strong>without necessary guardrails, TOD may
					inadvertently displace vulnerable populations.</strong>
				</p>
				<p>
					The policy answer is not less TOD. It is <strong>more affordability inside TOD</strong>.
				</p>
			</section>
		{/if}
	</section>

	{/if}
</div>

<style>
	/* ── Warm editorial theme (matches static/municipal/index.html) ── */
	.poc-root {
		--bg: #f5f2eb;
		--paper: #fffdf8;
		--ink: #1f2430;
		--muted: #5e6573;
		--line: #d8d2c7;
		--accent: #00843d;
		--accent-soft: #d8efe2;
		--warning: #ed8b00;
		--warning-soft: #fbe6cc;
		--blue-1: #edf4ff;
		--blue-2: #bfd6f6;
		--blue-3: #6fa8dc;
		--blue-4: #2f6ea6;
		--blue-5: #003da5;
		--shadow: 0 14px 34px rgba(31, 36, 48, 0.08);
		--radius: 18px;

		/* Light-mode tokens for embedded charts (TodIntensityScatter, D3) — darker than app :root dark theme */
		--text: #1f2430;
		--text-muted: #3d4a5c;
		--border: #b8b0a3;
		--bg-hover: #e8e0d4;
		--bg-card: #fffdf8;
		--cat-a: #006b32;
		--radius-sm: 6px;
		--shadow-sm: 0 4px 14px rgba(31, 36, 48, 0.12);

		/* mainPocTractCharts.js — same as MainPocTractDashboard warm theme */
		--mpc-ink: #1f2430;
		--mpc-muted: #454d5c;
		--mpc-line: #d8d2c7;
		--mpc-paper: #fffdf8;
		--mpc-bg: #f5f2eb;
		--mpc-accent: #00843d;
		--mpc-accent-soft: #d8efe2;
		--mpc-warning: #ed8b00;
		--mpc-blue5: #003da5;

		font-family: var(--font-body);
		color: var(--ink);
		background:
			radial-gradient(circle at top left, rgba(0, 132, 61, 0.08), transparent 28%),
			radial-gradient(circle at top right, rgba(0, 61, 165, 0.09), transparent 24%),
			var(--bg);
		max-width: 1240px;
		margin: 0 auto;
		padding: 28px 20px 44px;
	}

	* { box-sizing: border-box; }

	h1, h2, h3, p { margin-top: 0; }

	h1 {
		margin-bottom: 14px;
		font-size: clamp(2rem, 4vw, 3.4rem);
		line-height: 1.02;
		letter-spacing: -0.03em;
	}

	.card {
		background: var(--paper);
		border: 1px solid rgba(120, 114, 102, 0.18);
		border-radius: var(--radius);
		box-shadow: var(--shadow);
	}

	/* ── Hero ─────────────────────────────────────────── */
	.hero-full {
		padding: 28px;
		margin-bottom: 20px;
	}

	.eyebrow {
		display: inline-block;
		margin-bottom: 10px;
		padding: 6px 10px;
		border-radius: 999px;
		background: var(--accent-soft);
		color: #0b5e2c;
		font-weight: 700;
		font-size: 0.78rem;
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}

	.subtitle { color: var(--muted); line-height: 1.58; margin-bottom: 0; }

	/* ── Dashboard layout ─────────────────────────────── */
	.dashboard {
		display: grid;
		grid-template-columns: 300px 1fr;
		gap: 18px;
		align-items: start;
	}

	.controls {
		position: sticky;
		top: 16px;
		align-self: start;
		padding: 0;
		/* Main column sits below the 56px nav; cap height so the sticky panel stays in view. */
		max-height: calc(100dvh - 56px - 32px);
		display: flex;
		flex-direction: column;
		min-height: 0;
	}

	.controls-inner {
		padding: 20px;
		overflow-y: auto;
		-webkit-overflow-scrolling: touch;
		min-height: 0;
	}

	.controls h2 { margin-bottom: 10px; font-size: 1.1rem; }
	.controls-note { color: var(--muted); line-height: 1.58; font-size: 0.9rem; }

	.control-block + .control-block {
		margin-top: 18px;
		padding-top: 18px;
		border-top: 1px solid var(--line);
	}

	.label {
		display: block;
		margin-bottom: 8px;
		font-weight: 700;
		font-size: 0.9rem;
	}

	.range-row {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 10px;
	}

	.play-row {
		display: flex;
		gap: 10px;
		align-items: center;
		margin-top: 10px;
	}

	.play-row button { flex: 0 0 auto; min-width: 92px; }

	.play-slider-wrap { flex: 1 1 auto; }
	.play-caption { margin-top: 6px; font-size: 0.84rem; color: var(--muted); }

	input[type="number"], select, input[type="search"] {
		width: 100%;
		padding: 10px 12px;
		border: 1px solid #c9c1b4;
		border-radius: 10px;
		background: #fff;
		color: var(--ink);
		font: inherit;
	}

	input[type="range"] { width: 100%; }

	.check-grid {
		display: grid;
		gap: 8px;
		max-height: 200px;
		overflow: auto;
		padding-right: 4px;
	}

	.check-item {
		display: flex;
		gap: 8px;
		align-items: start;
		font-size: 0.92rem;
		color: var(--muted);
		cursor: pointer;
	}

	.button-row, .preset-row {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}

	button {
		font: inherit;
		border: 0;
		border-radius: 999px;
		padding: 9px 14px;
		background: var(--ink);
		color: #fff;
		cursor: pointer;
		transition: transform 120ms ease, opacity 120ms ease;
	}

	button.secondary {
		background: #ece6db;
		color: var(--ink);
	}

	button:hover {
		opacity: 0.92;
		transform: translateY(-1px);
	}

	/* ── Content area ─────────────────────────────────── */
	.content {
		display: grid;
		gap: 18px;
	}

	.summary { padding: 20px; }

	.summary-grid {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 12px;
		margin: 14px 0;
	}

	.summary-stat {
		padding: 14px;
		border-radius: 14px;
		background: #faf7f0;
		border: 1px solid var(--line);
	}

	.summary-stat .k {
		color: var(--muted);
		font-size: 0.78rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		font-weight: 700;
	}

	.summary-stat .v {
		margin-top: 6px;
		font-size: 1.7rem;
		font-weight: 800;
		letter-spacing: -0.03em;
	}

	.selection-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		margin-top: 10px;
	}

	.chip {
		padding: 6px 10px;
		border-radius: 999px;
		background: #efe9dc;
		color: #433d34;
		font-size: 0.85rem;
		font-weight: 600;
	}

	/* ── Story / narrative cards ──────────────────────── */
	.story {
		padding: 22px 24px;
	}

	.story h2 { font-size: 1.2rem; margin-bottom: 10px; }
	.story p { color: var(--muted); line-height: 1.58; margin-bottom: 12px; }
	.story p:last-child { margin-bottom: 0; }

	.story-list {
		color: var(--muted);
		line-height: 1.58;
		padding-left: 22px;
		margin: 10px 0;
	}

	.story-list li { margin-bottom: 6px; }

	/* ── Chart cards ──────────────────────────────────── */
	.chart-card { padding: 20px; }

	.chart-card h2 { font-size: 1.15rem; margin-bottom: 8px; }
	.chart-card h3 { font-size: 1.05rem; margin-bottom: 8px; }

	.chart-note {
		color: var(--muted);
		line-height: 1.55;
		font-size: 0.9rem;
		margin-bottom: 8px;
	}

	.chart-toolbar {
		display: flex;
		gap: 10px;
		align-items: center;
		flex-wrap: wrap;
		margin-bottom: 8px;
	}

	.chart-toolbar select { width: auto; min-width: 210px; }

	.chart-wrap {
		position: relative;
		min-height: 420px;
	}

	.small-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 18px;
	}

	.small-chart { min-height: 320px; }
	.chart-tall { min-height: 520px; }

	.chart-wrap--tract-edu {
		min-height: 0;
		max-height: min(78vh, 620px);
		overflow: auto;
	}

	.scatter-container {
		display: flex;
		justify-content: center;
		overflow-x: auto;
	}

	.scatter-container--compact {
		justify-content: flex-start;
		max-width: 100%;
	}

	/* Story + chart side-by-side */
	.story-chart-row {
		display: grid;
		gap: 18px;
		align-items: start;
	}

	/* Narrative + chart in one white card (municipal affordability & vulnerability) */
	.story-chart-panel {
		padding: 22px 24px;
	}

	.story-chart-panel__grid {
		display: grid;
		gap: 18px;
		align-items: start;
		grid-template-columns: minmax(0, 1fr) minmax(300px, 1.05fr);
	}

	.story-chart-panel__text h2 {
		font-size: 1.2rem;
		margin-bottom: 10px;
	}

	.story-chart-panel__text p {
		color: var(--muted);
		line-height: 1.58;
		margin-bottom: 0;
	}

	.story-chart-panel__chart {
		width: 100%;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}

	.story-chart-panel__chart h3 {
		font-size: 1rem;
		margin-bottom: 8px;
	}

	.story-chart-panel__chart .chart-wrap.small-chart.compact-side-chart {
		flex: 0 0 auto;
		min-height: 0;
		height: auto;
		width: 100%;
	}

	.story-chart-panel .compact-side-chart :global(svg) {
		display: block;
		width: 100%;
		height: auto;
	}

	/* Tract TOD scatters: wider copy column, plot slightly narrower than before */
	.story-chart-row--tract {
		grid-template-columns: minmax(0, 0.36fr) minmax(0, 0.64fr);
		align-items: start;
		gap: 18px;
	}

	.story-chart-row--tract .story-chart-text {
		max-width: 40em;
	}

	.story-chart-row--tract .story-chart-plot {
		max-width: 100%;
		width: 100%;
	}

	.story-chart-text {
		margin: 0;
		max-width: 34em;
	}

	.story-chart-plot {
		min-width: 0;
	}

	.story-chart-plot h3 {
		font-size: 1rem;
	}

	.story-chart-row--tract .scatter-container--compact {
		width: 100%;
	}

	@media (max-width: 920px) {
		.story-chart-panel__grid,
		.story-chart-row--tract {
			grid-template-columns: 1fr;
		}

		.story-chart-panel .compact-side-chart {
			max-height: none;
			min-height: 260px;
		}
	}

	:global(.poc-root .mpc-map-zoom-hint) {
		font-size: 0.78rem;
		color: var(--muted);
		margin: 8px 0 0;
		line-height: 1.45;
	}

	:global(.poc-root .mpc-tract-edu-legend) {
		display: flex;
		flex-wrap: wrap;
		gap: 10px 20px;
		align-items: center;
		margin-bottom: 6px;
		font-size: 0.82rem;
		color: var(--muted);
	}

	:global(.poc-root .mpc-tract-edu-legend-item) {
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}

	:global(.poc-root .mpc-tract-edu-swatch) {
		width: 11px;
		height: 11px;
		border-radius: 2px;
		flex-shrink: 0;
		box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.08);
	}

	/* TodIntensityScatter: readable tooltip on warm background */
	:global(.poc-root .tod-intensity-wrap .scatter-tooltip) {
		color: var(--ink);
		border-color: var(--line);
		box-shadow: var(--shadow-sm);
	}

	/* ── Tooltip & legend (global for D3 injected elements) ── */
	:global(.poc-root .tooltip) {
		position: absolute;
		pointer-events: none;
		opacity: 0;
		background: rgba(20, 24, 31, 0.94);
		color: #fff;
		padding: 10px 12px;
		border-radius: 10px;
		font-size: 0.82rem;
		line-height: 1.45;
		width: 230px;
		box-shadow: 0 10px 24px rgba(0, 0, 0, 0.22);
		z-index: 20;
		max-width: 280px;
	}

	:global(.poc-root .tooltip strong) {
		display: block;
		margin-bottom: 4px;
		font-size: 0.9rem;
	}

	:global(.poc-root .legend) {
		display: flex;
		gap: 12px;
		flex-wrap: wrap;
		color: var(--muted);
		font-size: 0.84rem;
	}

	:global(.poc-root .legend-item) {
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}

	:global(.poc-root .legend-scale) {
		display: inline-flex;
		align-items: center;
		gap: 8px;
	}

	:global(.poc-root .legend-ramp) {
		display: inline-grid;
		grid-auto-flow: column;
		gap: 2px;
	}

	:global(.poc-root .legend-ramp span) {
		width: 18px;
		height: 10px;
		border-radius: 999px;
		display: inline-block;
	}

	:global(.poc-root .swatch) {
		width: 12px;
		height: 12px;
		border-radius: 999px;
		display: inline-block;
	}

	:global(.poc-root .chart-note) {
		font-size: 0.85rem;
		color: var(--muted);
		margin: 0 0 8px;
	}

	:global(.poc-root .empty) {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 240px;
		color: var(--muted);
		text-align: center;
		padding: 20px;
		border: 1px dashed var(--line);
		border-radius: 14px;
		background: #faf7f1;
	}

	:global(.poc-root .summary-stat) {
		padding: 14px;
		border-radius: 14px;
		background: #faf7f0;
		border: 1px solid var(--line);
	}

	:global(.poc-root .summary-stat .k) {
		font-size: 0.78rem;
		color: var(--muted);
	}

	:global(.poc-root .summary-stat .v) {
		font-size: 1.15rem;
		font-weight: 700;
	}

	/* NHGIS-style tract globals */
	:global(.poc-root .mpc-tooltip) {
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

	:global(.poc-root .mpc-legend) {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 10px 14px;
		font-size: 0.82rem;
		color: var(--mpc-muted);
	}

	:global(.poc-root .mpc-legend-item) {
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}

	:global(.poc-root .mpc-swatch) {
		width: 12px;
		height: 12px;
		border-radius: 3px;
		display: inline-block;
	}

	:global(.poc-root .mpc-legend-scale) {
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}

	:global(.poc-root .mpc-legend-ramp span) {
		display: inline-block;
		width: 18px;
		height: 10px;
	}

	:global(.poc-root .mpc-empty) {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 160px;
		color: var(--muted);
		border: 1px dashed var(--line);
		border-radius: 12px;
		background: #faf7f1;
		padding: 16px;
		text-align: center;
	}

	:global(.poc-root .mpc-chart-note) {
		font-size: 0.85rem;
		color: var(--mpc-muted);
		margin: 0 0 8px;
	}

	:global(.poc-root .mpc-summary-stat) {
		padding: 12px;
		border-radius: 10px;
		background: #faf7f0;
		border: 1px solid var(--line);
	}

	:global(.poc-root .mpc-k) {
		font-size: 0.78rem;
		color: var(--muted);
	}

	:global(.poc-root .mpc-v) {
		font-size: 1.1rem;
		font-weight: 700;
	}

	/* ── Tract section ────────────────────────────────── */
	.tract-section {
		margin-top: 28px;
		display: grid;
		gap: 18px;
	}

	.full-width { grid-column: 1 / -1; }

	/* ── Takeaway cards ───────────────────────────────── */
	.takeaway-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
		gap: 12px;
		margin-top: 10px;
	}

	.takeaway-card {
		padding: 14px;
		border-radius: 14px;
		background: #faf7f0;
		border: 1px solid var(--line);
	}

	.takeaway-label {
		font-size: 0.78rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--muted);
		margin-bottom: 8px;
	}

	.takeaway-row {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-bottom: 4px;
	}

	.takeaway-tag {
		font-size: 0.7rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		padding: 3px 8px;
		border-radius: 999px;
		min-width: 60px;
		text-align: center;
	}

	.takeaway-tag.tod { background: var(--accent-soft); color: #0b5e2c; }
	.takeaway-tag.ctrl { background: #e2e8f0; color: #475569; }
	.takeaway-tag.minimal { background: #f1f5f9; color: #64748b; }
	.takeaway-tag.hi-aff { background: #d1fae5; color: #065f46; }
	.takeaway-tag.lo-aff { background: #f5f5f4; color: #57534e; }

	.takeaway-value {
		font-size: 1.1rem;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}

	/* ── Conclusion ───────────────────────────────────── */
	.conclusion {
		border-left: 4px solid var(--accent);
	}

	/* ── Loading ──────────────────────────────────────── */
	.loading-status {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 16px;
		min-height: 200px;
		color: var(--muted);
	}

	.loading-status--error h3 { color: #c0392b; font-size: 1.1rem; margin: 0; }

	.spinner {
		width: 40px;
		height: 40px;
		border: 3px solid var(--line);
		border-top-color: var(--accent);
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin { to { transform: rotate(360deg); } }

	/* ── Responsive ───────────────────────────────────── */
	@media (max-width: 1060px) {
		.dashboard, .small-grid, .summary-grid {
			grid-template-columns: 1fr;
		}
	}
</style>
