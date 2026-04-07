<script>
	import FilterPanel from '$lib/components/FilterPanel.svelte';
	import MapView from '$lib/components/MapView.svelte';
	import TodIntensityScatter from '$lib/components/TodIntensityScatter.svelte';
	import TodAffordabilityScatter from '$lib/components/TodAffordabilityScatter.svelte';
	import BinnedBarChart from '$lib/components/BinnedBarChart.svelte';
	import TractDetail from '$lib/components/TractDetail.svelte';
	import MethodologyNote from '$lib/components/MethodologyNote.svelte';
	import { tractData, developments, meta } from '$lib/stores/data.svelte.js';
	import {
		cohortYMeansForPanel,
		selectedTractsYWeightedMean,
		yMetricDisplayKind,
		formatYMetricSummary
	} from '$lib/utils/derived.js';

	let { panelState, domainOverride = null } = $props();

	/** @type {'map' | 'bar' | 'tod'} */
	let activeTab = $state('map');

	const tabs = $derived([
		{ id: 'map', label: 'Map' },
		{ id: 'bar', label: 'Bar' },
		{ id: 'tod', label: 'TOD Analysis' }
	]);

	/** Tracks all inputs that change TOD / non-TOD cohort membership or the Y field. */
	const cohortSummaryKey = $derived(
		JSON.stringify({
			tp: panelState.timePeriod,
			y: panelState.yVar,
			n: tractData.length,
			dn: developments.length,
			stops: panelState.minStops,
			tdMi: panelState.transitDistanceMi,
			sig: panelState.sigDevMinPctStockIncrease,
			todCut: panelState.todFractionCutoff,
			huSrc: panelState.huChangeSource,
			minPop: panelState.minPopulation,
			minDens: panelState.minPopDensity,
			sel: [...panelState.selectedTracts].sort().join('\t')
		})
	);

	/**
	 * Population-weighted mean of the selected Y for each cohort (same weighting as the
	 * binned bar chart).
	 */
	const cohortStats = $derived.by(() => {
		void cohortSummaryKey;
		const raw = cohortYMeansForPanel(tractData, panelState, developments);
		if (!raw) return null;
		const yMeta = meta.yVariables?.find((v) => v.key === raw.yBase);
		const kind = yMetricDisplayKind(yMeta);
		const selRaw = selectedTractsYWeightedMean(
			tractData,
			panelState,
			panelState.selectedTracts
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

<section class="analysis-panel" aria-labelledby="panel-title-{panelState.id}">
	<h2 id="panel-title-{panelState.id}" class="sr-only">
		Analysis ({panelState.id} panel)
	</h2>

	<FilterPanel {panelState} />

	{#if cohortStats}
		<div
			class="cohort-summary"
			role="region"
			aria-label="Population-weighted averages for the Y variable: TOD-dominated, non-TOD-dominated, minimal development, and manual selection"
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
							None selected — click the map to add tracts
						{:else}
							{cohortStats.nSelWithY} / {cohortStats.nSel} selected with data
						{/if}
					</span>
				</div>
			</div>
			<p class="cohort-summary-note">
				Means weighted by tract {cohortStats.weightLabel} (same as the bar chart). Selected tracts
				use your current map selection only (any cohort).
			</p>
		</div>
	{/if}

	<div class="viz-main">
		<div class="viz-tabs" role="tablist" aria-label="Visualization">
			{#each tabs as t (t.id)}
				<button
					type="button"
					role="tab"
					class="viz-tab"
					aria-selected={activeTab === t.id}
					onclick={() => (activeTab = t.id)}
				>
					{t.label}
				</button>
			{/each}
		</div>

		<!-- Mount only the active viz so hidden panes never overlap clicks and D3 always gets real layout width. -->
		<div class="viz-surface" role="tabpanel">
			{#if activeTab === 'map'}
				<div class="viz-pane viz-pane--map">
					<MapView {panelState} {domainOverride} />
				</div>
			{:else if activeTab === 'tod'}
				<div class="viz-pane viz-pane--tod">
					<h3 class="tod-subhead">TOD intensity vs demographics</h3>
					<TodIntensityScatter {panelState} {domainOverride} />
					<h3 class="tod-subhead">Affordable TOD share (TOD-dominated tracts)</h3>
					<TodAffordabilityScatter {panelState} {domainOverride} />
				</div>
			{:else}
				<div class="viz-pane">
					<BinnedBarChart {panelState} {domainOverride} />
				</div>
			{/if}
		</div>
	</div>

	<div class="analysis-footer">
		<TractDetail {panelState} />
		<MethodologyNote />
	</div>
</section>

<style>
	.analysis-panel {
		display: flex;
		flex-direction: column;
		gap: 6px;
		min-width: 0;
		max-width: 100%;
		min-height: 0;
		flex: 1;
		height: 100%;
		padding: 8px;
		background: var(--bg-panel);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		box-shadow: var(--shadow);
	}

	.analysis-panel :global(.filter-panel) {
		flex-shrink: 0;
	}

	.cohort-summary {
		flex-shrink: 0;
		padding: 5px 6px 6px;
		background: var(--bg-card);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
	}

	.cohort-summary-heading {
		margin: 0 0 6px;
		font-size: 0.6875rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-muted);
		line-height: 1.25;
	}

	.cohort-summary-grid {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 5px;
	}

	.cohort-summary-grid--four {
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}

	@media (min-width: 960px) {
		.cohort-summary-grid--four {
			grid-template-columns: repeat(4, minmax(0, 1fr));
		}
	}

	@media (max-width: 720px) {
		.cohort-summary-grid {
			grid-template-columns: 1fr;
		}
	}

	.cohort-pill {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 6px 8px;
		border-radius: var(--radius-sm);
		border: 1px solid var(--border);
		min-width: 0;
	}

	.cohort-pill--tod {
		background: color-mix(in srgb, var(--accent) 10%, var(--bg-panel));
		border-color: color-mix(in srgb, var(--accent) 35%, var(--border));
	}

	.cohort-pill--ctrl {
		background: color-mix(in srgb, #64748b 8%, var(--bg-panel));
		border-color: color-mix(in srgb, #64748b 28%, var(--border));
	}

	.cohort-pill-label {
		font-size: 0.625rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--text-muted);
	}

	.cohort-pill-value {
		font-size: 1rem;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		color: var(--text);
		line-height: 1.2;
	}

	.cohort-pill--tod .cohort-pill-value {
		color: var(--accent);
	}

	.cohort-pill--ctrl .cohort-pill-value {
		color: #64748b;
	}

	.cohort-pill--minimal {
		background: color-mix(in srgb, #64748b 10%, var(--bg-panel));
		border-color: color-mix(in srgb, #64748b 32%, var(--border));
	}

	.cohort-pill--minimal .cohort-pill-value {
		color: #475569;
	}

	.cohort-pill--picked {
		background: color-mix(in srgb, var(--cat-a, #c2410c) 12%, var(--bg-panel));
		border-color: color-mix(in srgb, var(--cat-a, #c2410c) 40%, var(--border));
	}

	.cohort-pill--picked .cohort-pill-value {
		color: var(--cat-a, #c2410c);
	}

	.cohort-pill-n {
		font-size: 0.625rem;
		color: var(--text-muted);
		line-height: 1.2;
	}

	.cohort-summary-note {
		margin: 6px 0 0;
		font-size: 0.5625rem;
		line-height: 1.35;
		color: var(--text-muted);
		opacity: 0.92;
	}

	/* Tabs + chart/map: grows to use most of the viewport; narrow column (portrait-friendly) */
	.viz-main {
		flex: 1 1 auto;
		min-height: 0;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.viz-tabs {
		position: relative;
		z-index: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 3px;
		padding: 3px;
		background: var(--bg-card);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		flex-shrink: 0;
	}

	.viz-tab {
		flex: 1;
		min-width: 4.5rem;
		padding: 6px 10px;
		border: none;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--text-muted);
		font-size: 0.875rem;
		font-weight: 500;
		cursor: pointer;
	}

	.viz-tab[aria-selected='true'] {
		background: var(--bg-hover);
		color: var(--accent);
	}

	.tod-subhead {
		font-size: 0.6875rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-muted);
		margin: 8px 0 4px;
	}

	.tod-subhead:first-child {
		margin-top: 0;
	}

	.viz-surface {
		position: relative;
		z-index: 0;
		isolation: isolate;
		flex: 1 1 auto;
		min-height: 72vh;
		border-radius: var(--radius-sm);
		border: 1px solid var(--border);
		background: var(--bg-card);
		overflow: hidden;
		/* ~50% larger than prior cap; still centered within the analysis column */
		width: 100%;
		max-width: min(100%, 108vh);
		margin-left: auto;
		margin-right: auto;
		display: flex;
		flex-direction: column;
		align-items: stretch;
	}

	.viz-pane {
		min-width: 0;
		flex: 1 1 auto;
	}

	/* Bar chart can scroll if needed; map uses a fixed legend column and stays overflow-hidden */
	.viz-pane:not(.viz-pane--map):not(.viz-pane--tod) {
		min-height: 0;
		overflow-y: auto;
	}

	.viz-pane--map {
		display: flex;
		justify-content: center;
		align-items: flex-start;
		min-height: min(78vh, 1080px);
		padding: 4px 0 8px;
		overflow: hidden;
	}

	.viz-pane--tod {
		display: flex;
		flex-direction: column;
		gap: 4px;
		flex: 1 1 auto;
		min-height: 0;
		overflow-y: auto;
		padding: 6px 8px 8px;
	}

	.analysis-footer {
		position: relative;
		z-index: 1;
		flex-shrink: 0;
		min-width: 0;
		padding-top: 4px;
		background: var(--bg-panel);
	}
</style>
