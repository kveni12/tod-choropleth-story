<script>
	/**
	 * Full tract explorer for the home page: same filters and map as ``/tract``, TOD Analysis scatters,
	 * and a detail column for selected tracts (``TractDetail``).
	 */
	import FilterPanel from '$lib/components/FilterPanel.svelte';
	import MapView from '$lib/components/MapView.svelte';
	import TodIntensityScatter from '$lib/components/TodIntensityScatter.svelte';
	import TodAffordabilityScatter from '$lib/components/TodAffordabilityScatter.svelte';
	import TractDetail from '$lib/components/TractDetail.svelte';
	import MethodologyNote from '$lib/components/MethodologyNote.svelte';
	import { createPanelState } from '$lib/stores/panelState.svelte.js';
	import { tractData, developments, meta } from '$lib/stores/data.svelte.js';
	import {
		cohortYMeansForPanel,
		selectedTractsYWeightedMean,
		yMetricDisplayKind,
		formatYMetricSummary
	} from '$lib/utils/derived.js';
	import { base } from '$app/paths';

	const explorePanel = createPanelState('explore-home');
	// Align defaults with the tract narrative (median income change, stock-growth X).
	explorePanel.xVar = 'pct_stock_increase';
	explorePanel.yVar = 'median_income_change_pct';

	/** Home explore: X-axis dropdown and tract detail tables only use these MassBuilds / stock metrics. */
	const EXPLORE_X_AXIS_KEYS = [
		'pct_stock_increase',
		'tod_pct_stock_increase',
		'nontod_pct_stock_increase',
		'affordable_share'
	];

	$effect(() => {
		if (!EXPLORE_X_AXIS_KEYS.includes(explorePanel.xVar)) {
			explorePanel.xVar = 'pct_stock_increase';
		}
	});

	/** Scatter: first TOD Analysis plot (intensity) vs second (affordable TOD share, TOD-dominated only). */
	let scatterMode = $state(/** @type {'intensity' | 'affordability'} */ ('intensity'));

	const cohortSummaryKey = $derived(
		JSON.stringify({
			tp: explorePanel.timePeriod,
			y: explorePanel.yVar,
			n: tractData.length,
			dn: developments.length,
			stops: explorePanel.minStops,
			tdMi: explorePanel.transitDistanceMi,
			sig: explorePanel.sigDevMinPctStockIncrease,
			todCut: explorePanel.todFractionCutoff,
			huSrc: explorePanel.huChangeSource,
			minPop: explorePanel.minPopulation,
			minDens: explorePanel.minPopDensity,
			sel: [...explorePanel.selectedTracts].sort().join('\t')
		})
	);

	const cohortStats = $derived.by(() => {
		void cohortSummaryKey;
		const raw = cohortYMeansForPanel(tractData, explorePanel, developments);
		if (!raw) return null;
		const yMeta = meta.yVariables?.find((v) => v.key === raw.yBase);
		const kind = yMetricDisplayKind(yMeta);
		const selRaw = selectedTractsYWeightedMean(
			tractData,
			explorePanel,
			explorePanel.selectedTracts
		);
		return {
			...raw,
			displayLabel: yMeta?.label ?? raw.yBase,
			kind,
			fmtTod: formatYMetricSummary(raw.meanTod, kind),
			fmtCtrl: formatYMetricSummary(raw.meanNonTod, kind),
			fmtMinimal: formatYMetricSummary(raw.meanMinimal, kind),
			fmtSelected: formatYMetricSummary(selRaw?.mean ?? NaN, kind),
			nSel: selRaw?.nSelected ?? 0,
			nSelWithY: selRaw?.nWithY ?? 0
		};
	});
</script>

<section class="explore-root card full-width" aria-labelledby="explore-tract-heading">
	<h2 id="explore-tract-heading">Explore the data for yourself</h2>
	<p class="explore-lead">
		Use the same tract filters, development rules, and TOD cohort settings as the
		<a href="{base}/tract">full tract dashboard</a>. Click tracts on the map or points on the scatter plot to
		inspect details; selections stay in sync. Brush-drag on the plot to add multiple tracts. Selected tracts
		are outlined in <strong>red</strong> with a weighted best-fit line when two or more are selected.
	</p>

	<div class="explore-grid">
		<aside class="explore-filters">
			<FilterPanel panelState={explorePanel} allowedXKeys={EXPLORE_X_AXIS_KEYS} />
		</aside>

		<div class="explore-center">
			{#if cohortStats}
				<div
					class="cohort-summary"
					role="region"
					aria-label="Population-weighted averages for the Y variable by cohort and selection"
				>
					<p class="cohort-summary-heading">{cohortStats.displayLabel}</p>
					<div class="cohort-summary-grid cohort-summary-grid--four">
						<div class="cohort-pill cohort-pill--tod">
							<span class="cohort-pill-label">TOD-dominated</span>
							<span class="cohort-pill-value">{cohortStats.fmtTod}</span>
							<span class="cohort-pill-n">
								{cohortStats.nTodWithY} / {cohortStats.nTod} tracts with data
							</span>
						</div>
						<div class="cohort-pill cohort-pill--ctrl">
							<span class="cohort-pill-label">non-TOD-dominated (sig. dev)</span>
							<span class="cohort-pill-value">{cohortStats.fmtCtrl}</span>
							<span class="cohort-pill-n">
								{cohortStats.nNonTodWithY} / {cohortStats.nNonTod} tracts with data
							</span>
						</div>
						<div class="cohort-pill cohort-pill--minimal">
							<span class="cohort-pill-label">Minimal development</span>
							<span class="cohort-pill-value">{cohortStats.fmtMinimal}</span>
							<span class="cohort-pill-n">
								{cohortStats.nMinimalWithY} / {cohortStats.nMinimal} tracts with data
							</span>
						</div>
						<div class="cohort-pill cohort-pill--picked">
							<span class="cohort-pill-label">Selected tracts</span>
							<span class="cohort-pill-value">{cohortStats.fmtSelected}</span>
							<span class="cohort-pill-n">
								{#if cohortStats.nSel === 0}
									None — click the map or scatter
								{:else}
									{cohortStats.nSelWithY} / {cohortStats.nSel} selected with data
								{/if}
							</span>
						</div>
					</div>
					<p class="cohort-summary-note">
						Means weighted by tract {cohortStats.weightLabel} (same as the tract bar chart).
					</p>
				</div>
			{/if}

			<div class="explore-map card explore-card">
				<h3 class="explore-h3">Map</h3>
				<p class="explore-hint">
					Choropleth uses your X and Y axis choices; cohort shading uses the TOD Analysis thresholds below.
				</p>
				<div class="explore-map-inner">
					<MapView panelState={explorePanel} />
				</div>
			</div>

			<div class="explore-scatter card explore-card">
				<div class="explore-scatter-head">
					<div>
						<h3 class="explore-h3">TOD Analysis</h3>
						<p class="explore-hint explore-hint--tight">
							Y axis follows &ldquo;Time &amp; Axes&rdquo; above. Toggle the second plot for affordable-share
							among TOD-dominated tracts only (same as the tract dashboard).
						</p>
					</div>
					<div class="explore-toggle" role="group" aria-label="TOD scatter type">
						<button
							type="button"
							class="explore-toggle-btn"
							class:active={scatterMode === 'intensity'}
							onclick={() => (scatterMode = 'intensity')}
						>
							TOD intensity
						</button>
						<button
							type="button"
							class="explore-toggle-btn"
							class:active={scatterMode === 'affordability'}
							onclick={() => (scatterMode = 'affordability')}
						>
							Affordable TOD share
						</button>
					</div>
				</div>
				<div class="explore-scatter-body">
					{#if scatterMode === 'intensity'}
						<TodIntensityScatter panelState={explorePanel} wideLayout showTrimControl={true} />
					{:else}
						<TodAffordabilityScatter panelState={explorePanel} />
					{/if}
				</div>
			</div>
		</div>

		<aside class="explore-sidebar card explore-card">
			<div class="explore-detail-wrap">
				<TractDetail
					panelState={explorePanel}
					sidebarMode="compact"
					hideBulkActions
					allowedXAxisKeys={EXPLORE_X_AXIS_KEYS}
				/>
			</div>
			<div class="explore-method">
				<MethodologyNote />
			</div>
		</aside>
	</div>
</section>

<style>
	.explore-root {
		margin-top: 18px;
		padding: 18px 20px 22px;
	}

	.explore-root h2 {
		margin: 0 0 10px;
		font-size: clamp(1.2rem, 2.4vw, 1.55rem);
	}

	.explore-lead {
		margin: 0 0 16px;
		color: var(--muted);
		line-height: 1.55;
		font-size: 0.95rem;
		max-width: 900px;
	}

	.explore-lead a {
		color: var(--accent);
		font-weight: 600;
	}

	.explore-grid {
		display: grid;
		grid-template-columns: minmax(260px, 320px) minmax(0, 1fr) minmax(280px, 400px);
		gap: 14px;
		align-items: start;
	}

	@media (max-width: 1280px) {
		.explore-grid {
			grid-template-columns: 1fr;
		}
	}

	.explore-filters {
		min-width: 0;
		padding: 10px 12px;
		background: var(--paper);
		border: 1px solid rgba(120, 114, 102, 0.14);
		border-radius: 12px;
	}

	.explore-filters :global(.filter-panel) {
		font-size: 0.75rem;
	}

	.explore-center {
		display: flex;
		flex-direction: column;
		gap: 12px;
		min-width: 0;
	}

	.explore-card {
		padding: 12px 14px;
		margin: 0;
	}

	.explore-h3 {
		margin: 0 0 6px;
		font-size: 1.05rem;
	}

	.explore-hint {
		margin: 0 0 10px;
		font-size: 0.82rem;
		color: var(--muted);
		line-height: 1.45;
	}

	.explore-hint--tight {
		margin-bottom: 0;
	}

	.explore-map-inner {
		display: flex;
		justify-content: center;
		align-items: flex-start;
		min-height: min(420px, 70vh);
		overflow: hidden;
		border-radius: 8px;
		border: 1px solid rgba(120, 114, 102, 0.12);
		background: var(--bg-card, #fffdf8);
	}

	.explore-map-inner :global(.map-wrap) {
		max-width: 100%;
	}

	.cohort-summary {
		padding: 8px 10px 10px;
		background: var(--paper);
		border: 1px solid rgba(120, 114, 102, 0.14);
		border-radius: 12px;
	}

	.cohort-summary-heading {
		margin: 0 0 6px;
		font-size: 0.65rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--muted);
	}

	.cohort-summary-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 6px;
	}

	@media (min-width: 900px) {
		.cohort-summary-grid--four {
			grid-template-columns: repeat(4, minmax(0, 1fr));
		}
	}

	.cohort-pill {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 6px 8px;
		border-radius: 8px;
		border: 1px solid var(--line, #d8d2c7);
		min-width: 0;
		background: var(--bg, #f5f2eb);
	}

	.cohort-pill--tod {
		background: color-mix(in srgb, var(--accent) 10%, var(--paper));
		border-color: color-mix(in srgb, var(--accent) 35%, var(--line, #d8d2c7));
	}

	.cohort-pill--tod .cohort-pill-value {
		color: var(--accent);
	}

	.cohort-pill--ctrl {
		background: color-mix(in srgb, #64748b 8%, var(--paper));
		border-color: color-mix(in srgb, #64748b 28%, var(--line, #d8d2c7));
	}

	.cohort-pill--ctrl .cohort-pill-value {
		color: #64748b;
	}

	.cohort-pill--minimal {
		background: color-mix(in srgb, #64748b 10%, var(--paper));
		border-color: color-mix(in srgb, #64748b 32%, var(--line, #d8d2c7));
	}

	.cohort-pill--minimal .cohort-pill-value {
		color: #475569;
	}

	.cohort-pill--picked {
		background: color-mix(in srgb, #b91c1c 10%, var(--paper));
		border-color: color-mix(in srgb, #b91c1c 32%, var(--line, #d8d2c7));
	}

	.cohort-pill--picked .cohort-pill-value {
		color: #b91c1c;
	}

	.cohort-pill-label {
		font-size: 0.58rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--muted);
	}

	.cohort-pill-value {
		font-size: 0.95rem;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		color: var(--ink);
		line-height: 1.2;
	}

	.cohort-pill-n {
		font-size: 0.58rem;
		color: var(--muted);
		line-height: 1.2;
	}

	.cohort-summary-note {
		margin: 8px 0 0;
		font-size: 0.62rem;
		line-height: 1.35;
		color: var(--muted);
	}

	.explore-scatter-head {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-start;
		justify-content: space-between;
		gap: 10px;
		margin-bottom: 8px;
	}

	.explore-toggle {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		padding: 3px;
		background: var(--bg, #f5f2eb);
		border: 1px solid rgba(120, 114, 102, 0.18);
		border-radius: 999px;
		flex-shrink: 0;
	}

	.explore-toggle-btn {
		border: none;
		background: transparent;
		padding: 6px 12px;
		border-radius: 999px;
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--muted);
		cursor: pointer;
	}

	.explore-toggle-btn.active {
		background: var(--paper);
		color: var(--accent);
		box-shadow: 0 1px 3px rgba(31, 36, 48, 0.12);
	}

	.explore-scatter-body {
		min-width: 0;
	}

	.explore-scatter-body :global(.tod-intensity-wrap.wide),
	.explore-scatter-body :global(.tod-aff-wrap) {
		width: 100%;
	}

	.explore-sidebar {
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 8px;
		max-height: min(92vh, 1200px);
		position: sticky;
		top: 12px;
	}

	@media (max-width: 1280px) {
		.explore-sidebar {
			position: static;
			max-height: none;
		}
	}

	.explore-detail-wrap {
		flex: 1 1 auto;
		min-height: 0;
		overflow: auto;
		border-top: 1px solid rgba(120, 114, 102, 0.12);
		padding-top: 8px;
	}

	.explore-method {
		border-top: 1px solid rgba(120, 114, 102, 0.12);
		padding-top: 6px;
		font-size: 0.75rem;
	}
</style>
