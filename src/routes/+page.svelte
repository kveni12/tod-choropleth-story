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
	import ExploreTractSection from '$lib/components/ExploreTractSection.svelte';

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

	/** Map overlays + dev filters for ``PocNhgisTractMap`` (aligned with tract ``FilterPanel`` / ``MapView``). */
	const pocMapPanel = createPanelState('poc-main');

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

	function buildTakeawayScale(items) {
		const finite = items.filter((d) => Number.isFinite(d.value));
		if (!finite.length) return [];
		const min = d3.min(finite, (d) => d.value) ?? 0;
		const max = d3.max(finite, (d) => d.value) ?? 0;
		const span = max - min;
		const pad = span > 0 ? span * 0.12 : Math.max(Math.abs(max) * 0.15, 1);
		const lo = min - pad;
		const hi = max + pad;
		const scale = d3.scaleLinear().domain([lo, hi]).range([0, 100]);
		return finite.map((d) => ({ ...d, pct: scale(d.value) }));
	}

	function buildCohortTakeawayItems(row) {
		if (!row) return [];
		return buildTakeawayScale([
			{ key: 'tod', label: 'TOD', value: row.rawTod, fmt: row.fmtTod, tone: 'tod' },
			{ key: 'ctrl', label: 'non-TOD', value: row.rawCtrl, fmt: row.fmtCtrl, tone: 'ctrl' },
			{ key: 'minimal', label: 'minimal dev.', value: row.rawMinimal, fmt: row.fmtMinimal, tone: 'minimal' }
		]);
	}

	function buildAffordabilityTakeawayItems(row) {
		if (!row) return [];
		return buildTakeawayScale([
			{ key: 'hi-aff', label: 'High aff.', value: row.rawHi, fmt: row.fmtHi, tone: 'hi-aff' },
			{ key: 'lo-aff', label: 'Low aff.', value: row.rawLo, fmt: row.fmtLo, tone: 'lo-aff' }
		]);
	}

	function formatTakeawayDelta(value, key) {
		if (!Number.isFinite(value)) return '—';
		const kind = key === 'bachelors_pct_change' ? 'pp' : 'pct';
		const out = formatYMetricSummary(value, kind);
		return value > 0 ? `+${out}` : out;
	}

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
		<h1>TOD can expand access. Do lower-income residents benefit too?</h1>
		<p class="subtitle">
			Transit-oriented development is widely viewed as a positive planning strategy: it can support housing growth,
			reduce car dependence, and place more homes near transit. This dashboard focuses on one policy question:
			<strong>whether TOD's gains appear to be shared with lower-income residents, or concentrated in ways that point to affordability as the missing guardrail.</strong>
			The patterns below are <strong>descriptive associations, not causal proof</strong>, but they suggest TOD should be paired
			with stronger affordable-housing requirements if the goal is inclusive growth.
		</p>
	</section>

	{#if !muniLoaded}
		<div class="loading-status">
			<div class="spinner" aria-hidden="true"></div>
			<p>Loading municipal data…</p>
		</div>
	{:else}

	<section class="story card full-width">
		<h2>What this graphic is doing</h2>
		<p>
			This writeup now focuses on a single map rather than the full dashboard. The map begins with
			<strong>tract-level housing change</strong>, then layers in <strong>TOD vs non-TOD tract cohorts</strong>,
			and finally reveals <strong>MassBuilds project points</strong>. That sequence is meant to make the spatial
			pattern legible before the reader has to think about any broader policy claims.
		</p>
		<p>
			The central question is simple: <strong>where does TOD actually concentrate, and how different do those tracts
			look from the statewide housing-change background?</strong>
		</p>
	</section>

	<!-- ═══════════════════════════════════════════════════════
	     PART 2 — TRACT ANALYSIS
	     ═══════════════════════════════════════════════════════ -->
	<section class="tract-section">
		<section class="story card full-width">
			<h2>How to read the map</h2>
			<p>
				Start with the base choropleth: it shows where housing units increased most between 2010 and 2020. Then
				add the cohort outlines: those separate <strong>TOD-dominated</strong>, <strong>non-TOD-dominated</strong>,
				and <strong>minimal-development</strong> tracts using the same rules as the original tract dashboard.
				Finally, the project points connect those tract patterns back to specific developments on the ground.
			</p>
			<p>
				This is a descriptive map, not a causal estimate. It is meant to locate where recent housing change and
				transit-oriented development overlap spatially, not to prove that TOD caused subsequent demographic change.
			</p>
			<p>
				Because the map uses the original tract-dashboard rules, the TOD threshold remains
				<strong>{threshold.toFixed(2)} miles</strong>. That keeps the proof of concept aligned with the broader
				project while narrowing the reader’s attention to one interactive figure.
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
					MassBuilds cohort (TOD-dominated vs non-TOD-dominated vs minimal development), matching the tract
					dashboard rules. Use the overlays to add MBTA lines and stops and MassBuilds projects (same encoding as
					the <a href="{base}/tract">tract map</a>).
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
				<h2>Design decisions</h2>
				<p>
					There are several design decisions that are integral to how this figure tells its story about TOD
					development. They are outlined below.
				</p>
				<p>
					<strong>Narrative-driven structure with scrollytelling.</strong> The scrolling sequence introduces the
					map in stages, beginning with housing change and then adding tract cohorts and development projects.
					This allows the figure to introduce contextually relevant confounding factors without overwhelming the
					reader all at once. At the same time, the map itself remains fixed, which preserves spatial context and
					makes it easier to compare one step to the next. This creates a strong visual argument, though one
					limitation is that adding more steps could provide more context at the cost of greater complexity.
				</p>
				<p>
					<strong>Interactive filtering and layering.</strong> Filtering and layering are key to describing the
					complexity of transit-oriented development policy in Massachusetts. As users move through the steps,
					they encounter additional layers that help them build their own interpretation of how housing growth,
					transit access, and MassBuilds projects line up. Zooming and tooltips provide more detail on demand
					without cluttering the main interface. That said, a future iteration could abstract away even more of
					the secondary controls so the map reads even more cleanly at first glance.
				</p>
				<p>
					<strong>Accessibility and color theory / normalization.</strong> The map uses muted, standardized color
					choices so the figure remains legible and comparatively friendly to color-blind viewers. We also drew
					from the MBTA visual language by using colors derived from the T and standard transit-facing typography
					such as Helvetica and Inter, which helps the map feel grounded in a recognizable Massachusetts transit
					context. Values are also normalized in the choropleth and categorical overlays are kept visually
					distinct, which helps viewers draw comparisons without having to guess whether they are looking at raw
					counts, percentages, or mixed scales. These choices are important to the figure’s readability, even
					though the palette and legend could still be refined further in the final project.
				</p>
			</section>

			<section class="story card full-width">
				<h2>What this figure can and cannot say</h2>
				<p>
					This map is useful for identifying where recent housing growth, TOD concentration, and project activity
					line up. It is much less useful for making causal claims on its own. Questions about affordability,
					demographic turnover, and displacement still require the supporting analysis elsewhere in the project.
				</p>
				<p>
					That tradeoff is intentional: this proof of concept prioritizes clarity and interaction quality for one
					core figure rather than trying to answer every project question at once.
				</p>
			</section>

			<section class="story card full-width conclusion">
				<h2>Sources</h2>
				<p>
					NHGIS tract-level census data for housing-unit change, MassBuilds development data for project locations
					and tract cohort construction, and cleaned MBTA stop and line layers from the original tract dashboard
					pipeline.
				</p>
				<p>
					The visual and interaction structure is adapted from the broader `tod-d3-poc` tract map, but narrowed
					here into a single scrollytelling figure.
				</p>
			</section>

			<!-- <ExploreTractSection /> -->
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
		background: var(--bg);
		max-width: 1680px;
		margin: 0 auto;
		padding: 18px 22px 36px;
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
		border: 1px solid rgba(120, 114, 102, 0.14);
		border-radius: 12px;
		box-shadow: none;
	}

	/* ── Hero ─────────────────────────────────────────── */
	.hero-full {
		padding: 20px 22px;
		margin-bottom: 14px;
	}

	.eyebrow {
		display: inline-block;
		margin-bottom: 8px;
		padding: 0;
		border-radius: 0;
		background: transparent;
		color: var(--accent);
		font-weight: 700;
		font-size: 0.74rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	.subtitle { color: var(--muted); line-height: 1.58; margin-bottom: 0; }

	/* ── Dashboard layout ─────────────────────────────── */
	.dashboard {
		display: grid;
		gap: 14px;
	}

	.controls-header {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		align-items: end;
		flex-wrap: wrap;
	}

	.controls-bar h2 { margin-bottom: 6px; font-size: 1.05rem; }
	.controls-note { color: var(--muted); line-height: 1.5; font-size: 0.9rem; margin: 0; }
	.controls-reset { white-space: nowrap; }
	.controls-inline {
		margin-top: 14px;
	}

	.controls-grid,
	.advanced-grid {
		display: grid;
		gap: 12px;
	}

	.controls-grid {
		grid-template-columns: minmax(260px, 1.35fr) minmax(220px, 1fr) minmax(220px, 1fr);
		align-items: end;
		margin-top: 14px;
	}

	.advanced-grid {
		grid-template-columns: repeat(2, minmax(0, 1fr));
		margin-top: 14px;
	}

	.control-field {
		min-width: 0;
	}

	.control-field--range {
		max-width: 420px;
	}

	.control-block + .control-block {
		margin-top: 0;
		padding-top: 0;
		border-top: 0;
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
	}

	.play-row button { flex: 0 0 auto; min-width: 92px; }

	.play-slider-wrap { flex: 1 1 auto; }
	.play-caption { margin-top: 6px; font-size: 0.84rem; color: var(--muted); }

	input[type="number"], select, input[type="search"] {
		width: 100%;
		padding: 9px 10px;
		border: 1px solid #c9c1b4;
		border-radius: 8px;
		background: #fff;
		color: var(--ink);
		font: inherit;
	}

	input[type="range"] { width: 100%; }

	.check-grid {
		display: grid;
		gap: 8px;
		max-height: 180px;
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
		border: 1px solid #cfc6b8;
		border-radius: 8px;
		padding: 8px 12px;
		background: #fff;
		color: var(--ink);
		cursor: pointer;
		transition: background 120ms ease, border-color 120ms ease;
	}

	button.secondary {
		background: #fff;
		color: var(--ink);
	}

	button:hover {
		background: #faf7f0;
		border-color: #bdb3a4;
	}

	/* ── Content area ─────────────────────────────────── */
	.content {
		display: grid;
		gap: 14px;
	}

	.summary { padding: 16px; }

	.summary-grid {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 10px;
		margin: 12px 0;
	}

	.summary-stat {
		padding: 12px;
		border-radius: 10px;
		background: transparent;
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

	.finding-list {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 10px;
		margin-top: 12px;
	}

	.finding-item {
		padding: 12px;
		border-radius: 10px;
		background: transparent;
		border: 1px solid var(--line);
	}

	.finding-kicker {
		font-size: 0.75rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--muted);
		margin-bottom: 6px;
	}

	.finding-item p {
		color: var(--muted);
		line-height: 1.5;
		margin: 0;
	}

	.chip {
		padding: 5px 8px;
		border-radius: 8px;
		background: transparent;
		border: 1px solid var(--line);
		color: #433d34;
		font-size: 0.85rem;
		font-weight: 500;
	}

	/* ── Story / narrative cards ──────────────────────── */
	.story {
		padding: 18px;
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

	.supplemental {
		margin-top: 12px;
		padding-top: 12px;
		border-top: 1px solid var(--line);
	}

	.supplemental summary {
		cursor: pointer;
		font-weight: 700;
		color: var(--ink);
		list-style: none;
	}

	.supplemental summary::-webkit-details-marker {
		display: none;
	}

	.supplemental summary::before {
		content: '+';
		display: inline-block;
		margin-right: 8px;
		font-weight: 700;
		color: var(--accent);
	}

	.supplemental[open] summary::before {
		content: '–';
	}

	.supplemental-grid,
	.supplemental-card {
		margin-top: 14px;
	}

	/* ── Chart cards ──────────────────────────────────── */
	.chart-card { padding: 20px; }
	.chart-card { padding: 16px; }

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
		gap: 14px;
	}

	.small-chart { min-height: 320px; }
	.chart-tall { min-height: 520px; }

	/* Cohort comparison chart: responsive height, scroll if needed */
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
		gap: 14px;
		align-items: start;
	}

	/* Narrative + chart in one white card (municipal affordability & vulnerability) */
	.story-chart-panel {
		padding: 18px;
	}

	.story-chart-panel__grid {
		display: grid;
		gap: 14px;
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
		.controls-grid,
		.advanced-grid {
			grid-template-columns: 1fr;
		}

		.finding-list,
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
		margin-top: 18px;
		display: grid;
		gap: 14px;
	}

	.full-width { grid-column: 1 / -1; }

	/* ── Takeaway cards ───────────────────────────────── */
	.takeaway-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
		gap: 10px;
		margin-top: 10px;
	}

	.takeaway-card {
		padding: 12px;
		border-radius: 10px;
		background: transparent;
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

	.takeaway-dumbbell {
		position: relative;
		height: 132px;
		margin: 10px 0 6px;
	}

	.takeaway-dumbbell--compact {
		height: 110px;
	}

	.takeaway-axis {
		position: absolute;
		left: 0;
		right: 0;
		top: 56px;
		height: 4px;
		border-radius: 999px;
		background: linear-gradient(90deg, #e8e0d4, #ddd3c3);
	}

	.takeaway-dumbbell--compact .takeaway-axis {
		top: 46px;
	}

	.takeaway-dot-group {
		position: absolute;
		top: 0;
		transform: translateX(-50%);
		display: grid;
		justify-items: center;
		gap: 4px;
		min-width: 72px;
		max-width: 92px;
	}

	.takeaway-dot-group--lower {
		top: 24px;
	}

	.takeaway-dot-label {
		font-size: 0.68rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--muted);
		text-align: center;
		line-height: 1.15;
		white-space: nowrap;
	}

	.takeaway-dot {
		width: 16px;
		height: 16px;
		border-radius: 999px;
		border: 3px solid #fff;
		box-shadow: 0 2px 10px rgba(31, 36, 48, 0.15);
		margin-top: 18px;
	}

	.takeaway-dumbbell--compact .takeaway-dot {
		margin-top: 12px;
	}

	.takeaway-dot-group.tod .takeaway-dot,
	.takeaway-dot-group.hi-aff .takeaway-dot {
		background: var(--accent);
	}

	.takeaway-dot-group.ctrl .takeaway-dot {
		background: #94a3b8;
	}

	.takeaway-dot-group.minimal .takeaway-dot,
	.takeaway-dot-group.lo-aff .takeaway-dot {
		background: #c9bfaf;
	}

	.takeaway-dot-value {
		font-size: 0.95rem;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		color: var(--ink);
		white-space: nowrap;
		background: rgba(255, 253, 248, 0.96);
		padding: 0 4px;
		border-radius: 6px;
	}

	.takeaway-meta {
		margin-top: 10px;
		padding-top: 10px;
		border-top: 1px solid var(--line);
		display: grid;
		gap: 6px;
	}

	.takeaway-statline {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 14px;
		font-size: 0.9rem;
		color: var(--muted);
	}

	.takeaway-statline strong {
		color: var(--ink);
		font-size: 1rem;
		font-variant-numeric: tabular-nums;
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
