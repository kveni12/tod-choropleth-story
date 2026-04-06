<script>
	import * as d3 from 'd3';

	export let model = null;
	export let currentStep = 0;

	const width = 820;
	const height = 680;
	const mapInset = { top: 30, right: 180, bottom: 28, left: 26 };
	const categoryColors = {
		tod_dominated: '#0b8a5b',
		nontod_dominated: '#d16e2d',
		minimal: '#8391a5'
	};

	let frameEl;
	let hoveredGisjoin = null;
	let tooltip = null;

	function mix(base, accent, weight = 0.18) {
		return d3.interpolateRgb(base, accent)(weight);
	}

	function formatSigned(value) {
		if (!Number.isFinite(value)) return 'No data';
		return `${value > 0 ? '+' : ''}${d3.format(',.0f')(value)} units`;
	}

	function formatPct(value) {
		return Number.isFinite(value) ? `${d3.format('.1f')(value)}%` : '—';
	}

	function formatShare(value) {
		return Number.isFinite(value) ? `${d3.format('.0%')(value)}` : '—';
	}

	$: featureCollection = model?.featureCollection ?? { type: 'FeatureCollection', features: [] };
	$: projection = d3.geoMercator().fitExtent(
		[
			[mapInset.left, mapInset.top],
			[width - mapInset.right, height - mapInset.bottom]
		],
		featureCollection
	);
	$: geoPath = d3.geoPath(projection);
	$: colorScale = d3
		.scaleDivergingSymlog(d3.interpolateBrBG)
		.domain(model?.colorDomain ?? [-1, 0, 1]);
	$: drawnFeatures = featureCollection.features.map((feature) => ({
		feature,
		path: geoPath(feature)
	}));
	$: projectedProjects = (model?.projects ?? [])
		.filter((project) => Number.isFinite(project.lon) && Number.isFinite(project.lat))
		.map((project) => {
			const point = projection([project.lon, project.lat]);
			return point ? { ...project, x: point[0], y: point[1] } : null;
		})
		.filter(Boolean);
	$: focusFeatures = featureCollection.features.filter((feature) => feature.properties.isFocusRegion);
	$: focusRect = focusFeatures.length
		? (() => {
				const bounds = geoPath.bounds({ type: 'FeatureCollection', features: focusFeatures });
				const [[x0, y0], [x1, y1]] = bounds;
				return {
					x: x0 - 12,
					y: y0 - 12,
					width: x1 - x0 + 24,
					height: y1 - y0 + 24
				};
			})()
		: null;

	const gradientStops = [
		{ offset: '0%', color: d3.interpolateBrBG(0) },
		{ offset: '25%', color: d3.interpolateBrBG(0.25) },
		{ offset: '50%', color: d3.interpolateBrBG(0.5) },
		{ offset: '75%', color: d3.interpolateBrBG(0.75) },
		{ offset: '100%', color: d3.interpolateBrBG(1) }
	];

	function tractTint(feature) {
		const base = colorScale(feature.properties.housingChange);
		if (currentStep < 1) return base;
		if (feature.properties.category === 'tod_dominated') return mix(base, categoryColors.tod_dominated, 0.22);
		if (feature.properties.category === 'nontod_dominated') return mix(base, categoryColors.nontod_dominated, 0.18);
		return mix(base, categoryColors.minimal, 0.16);
	}

	function tractStroke(feature) {
		if (hoveredGisjoin === feature.properties.gisjoin) return '#18202d';
		if (currentStep < 1) return 'rgba(112, 106, 95, 0.35)';
		if (feature.properties.category === 'tod_dominated') return 'var(--tod)';
		if (feature.properties.category === 'nontod_dominated') return 'var(--nontod)';
		return 'var(--minimal)';
	}

	function tractStrokeWidth(feature) {
		if (hoveredGisjoin === feature.properties.gisjoin) return 1.8;
		if (currentStep < 1) return 0.45;
		if (feature.properties.category === 'minimal') return 0.95;
		return 1.3;
	}

	function projectRadius(project) {
		return Math.max(2.2, Math.min(9, Math.sqrt(project.hu || 0) * 0.22));
	}

	function projectFill(project) {
		return project.isTodProject ? 'var(--tod)' : 'var(--nontod)';
	}

	function showTooltip(event, feature) {
		const rect = frameEl.getBoundingClientRect();
		tooltip = {
			x: event.clientX - rect.left + 14,
			y: event.clientY - rect.top + 14,
			title: feature.properties.tooltipTitle,
			category: feature.properties.category,
			rows: [
				['Net housing change', formatSigned(feature.properties.housingChange)],
				['Tract category', categoryLabel(feature.properties.category)],
				['TOD share of new units', formatShare(feature.properties.todShare)],
				['Affordable share of new units', formatShare(feature.properties.affordableShare)],
				['Stock growth from new projects', formatPct(feature.properties.stockIncreasePct)]
			]
		};
	}

	function moveTooltip(event) {
		if (!tooltip || !frameEl) return;
		const rect = frameEl.getBoundingClientRect();
		tooltip = { ...tooltip, x: event.clientX - rect.left + 14, y: event.clientY - rect.top + 14 };
	}

	function clearTooltip() {
		hoveredGisjoin = null;
		tooltip = null;
	}

	function categoryLabel(category) {
		if (category === 'tod_dominated') return 'TOD-dominated';
		if (category === 'nontod_dominated') return 'Non-TOD-dominated';
		return 'Minimal development';
	}
</script>

<div class="map-card">
	<div class="map-header">
		<div>
			<p class="map-kicker">Interactive map</p>
			<h2>Massachusetts tract-level housing change</h2>
		</div>
		<div class="map-step-chip">Step {currentStep + 1} of 3</div>
	</div>

	<div class="map-frame" bind:this={frameEl} on:mouseleave={clearTooltip}>
		<svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Choropleth map of Massachusetts census tracts showing housing change and TOD categories">
			<defs>
				<linearGradient id="housing-change-gradient" x1="0%" y1="100%" x2="0%" y2="0%">
					{#each gradientStops as stop}
						<stop offset={stop.offset} stop-color={stop.color}></stop>
					{/each}
				</linearGradient>
			</defs>

			<g class="tract-layer">
				{#each drawnFeatures as drawn (drawn.feature.properties.gisjoin)}
					<path
						d={drawn.path}
						fill={tractTint(drawn.feature)}
						stroke={tractStroke(drawn.feature)}
						stroke-width={tractStrokeWidth(drawn.feature)}
						class:hovered={hoveredGisjoin === drawn.feature.properties.gisjoin}
						on:mouseenter={(event) => {
							hoveredGisjoin = drawn.feature.properties.gisjoin;
							showTooltip(event, drawn.feature);
						}}
						on:mousemove={moveTooltip}
						on:mouseleave={clearTooltip}
					></path>
				{/each}
			</g>

			{#if focusRect}
				<g class="focus-callout">
					<rect
						x={focusRect.x}
						y={focusRect.y}
						width={focusRect.width}
						height={focusRect.height}
						rx="18"
						ry="18"
						opacity={currentStep >= 1 ? 1 : 0}
					></rect>
					<text x={focusRect.x + 14} y={focusRect.y - 8} opacity={currentStep >= 1 ? 1 : 0}>Greater Boston TOD cluster</text>
				</g>
			{/if}

			<g class="project-layer">
				{#each projectedProjects as project}
					<circle
						cx={project.x}
						cy={project.y}
						r={projectRadius(project)}
						fill={projectFill(project)}
						fill-opacity={currentStep >= 2 ? 0.68 : 0}
						stroke="#fff"
						stroke-width="0.7"
						opacity={currentStep >= 2 ? 1 : 0}
					></circle>
				{/each}
			</g>

			<g class="legend" transform={`translate(${width - 138}, 36)`}>
				<text class="legend-title" x="0" y="0">Net housing change</text>
				<text class="legend-subtitle" x="0" y="18">2000–2020</text>
				<rect x="0" y="30" width="18" height="170" fill="url(#housing-change-gradient)" rx="9"></rect>
				{#each [
					{ label: `${d3.format(',.0f')(model?.colorDomain?.[2] ?? 0)}+`, y: 40 },
					{ label: '0', y: 118 },
					{ label: `${d3.format(',.0f')(model?.colorDomain?.[0] ?? 0)}`, y: 196 }
				] as tick}
					<line x1="20" x2="28" y1={tick.y} y2={tick.y} class="legend-tick"></line>
					<text x="34" y={tick.y + 4} class="legend-label">{tick.label}</text>
				{/each}

				{#if currentStep >= 1}
					<g transform="translate(0, 230)">
						<text class="legend-title" x="0" y="0">Tract categories</text>
						{#each [
							{ label: 'TOD-dominated', color: 'var(--tod)' },
							{ label: 'Non-TOD-dominated', color: 'var(--nontod)' },
							{ label: 'Minimal development', color: 'var(--minimal)' }
						] as item, index}
							<circle cx="8" cy={24 + index * 22} r="6.5" fill="transparent" stroke={item.color} stroke-width="2"></circle>
							<text x="24" y={28 + index * 22} class="legend-label">{item.label}</text>
						{/each}
					</g>
				{/if}

				{#if currentStep >= 2}
					<g transform="translate(0, 328)">
						<text class="legend-title" x="0" y="0">Projects</text>
						<circle cx="8" cy="24" r="6" fill="var(--tod)" fill-opacity="0.7" stroke="#fff" stroke-width="0.6"></circle>
						<text x="24" y="28" class="legend-label">Transit-accessible project</text>
						<circle cx="8" cy="46" r="6" fill="var(--nontod)" fill-opacity="0.7" stroke="#fff" stroke-width="0.6"></circle>
						<text x="24" y="50" class="legend-label">Project outside TOD radius</text>
					</g>
				{/if}
			</g>
		</svg>

		{#if tooltip}
			<div class="tooltip" style={`left:${tooltip.x}px; top:${tooltip.y}px;`}>
				<p class="tooltip-kicker">Census tract</p>
				<h3>{tooltip.title}</h3>
				<span class={`tooltip-badge tooltip-badge--${tooltip.category}`}>{categoryLabel(tooltip.category)}</span>
				<div class={`tooltip-highlight tooltip-highlight--${tooltip.category}`}>
					{#each tooltip.rows.slice(0, 2) as row}
						<div class="tooltip-row tooltip-row--strong">
							<span>{row[0]}</span>
							<strong>{row[1]}</strong>
						</div>
					{/each}
				</div>
				<div class="tooltip-details">
					{#each tooltip.rows.slice(2) as row}
						<div class="tooltip-row">
							<span>{row[0]}</span>
							<span>{row[1]}</span>
						</div>
					{/each}
				</div>
			</div>
		{/if}
	</div>
</div>

<style>
	.map-card {
		padding: 1.25rem;
		background: var(--paper);
		border: 1px solid rgba(120, 114, 102, 0.18);
		border-radius: var(--radius-xl);
		box-shadow: var(--shadow);
	}

	.map-header {
		display: flex;
		align-items: end;
		justify-content: space-between;
		gap: 1rem;
		margin-bottom: 1rem;
	}

	.map-kicker,
	.legend-title,
	.tooltip-kicker {
		font-size: 0.75rem;
		font-weight: 800;
		letter-spacing: 0.07em;
		text-transform: uppercase;
	}

	.map-kicker,
	.tooltip-kicker {
		color: var(--accent);
		margin-bottom: 0.3rem;
	}

	.map-header h2 {
		font-size: clamp(1.5rem, 2vw, 2rem);
		line-height: 1.04;
	}

	.map-step-chip {
		padding: 0.55rem 0.8rem;
		border-radius: 999px;
		background: var(--accent-soft);
		color: var(--accent);
		font-size: 0.78rem;
		font-weight: 800;
		letter-spacing: 0.05em;
		text-transform: uppercase;
	}

	.map-frame {
		position: relative;
	}

	svg {
		display: block;
		width: 100%;
		height: auto;
		background: #f7f3ec;
		border-radius: var(--radius-lg);
	}

	path,
	circle,
	rect {
		transition:
			fill 320ms ease,
			stroke 320ms ease,
			stroke-width 320ms ease,
			opacity 320ms ease;
	}

	path.hovered {
		filter: brightness(1.04);
	}

	.focus-callout rect {
		fill: rgba(255, 255, 255, 0.08);
		stroke: rgba(17, 24, 39, 0.72);
		stroke-width: 1.3;
		stroke-dasharray: 6 6;
	}

	.focus-callout text {
		font-size: 0.76rem;
		font-weight: 700;
		fill: #1f2430;
	}

	.legend-title {
		fill: var(--ink);
	}

	.legend-subtitle,
	.legend-label {
		font-size: 0.74rem;
		fill: var(--muted);
	}

	.legend-tick {
		stroke: rgba(31, 36, 48, 0.55);
		stroke-width: 1;
	}

	.tooltip {
		position: absolute;
		z-index: 3;
		max-width: 300px;
		padding: 0.85rem 0.95rem;
		border: 1px solid rgba(120, 114, 102, 0.22);
		border-radius: var(--radius-md);
		background: rgba(255, 253, 248, 0.97);
		box-shadow: 0 16px 36px rgba(31, 36, 48, 0.14);
		pointer-events: none;
	}

	.tooltip h3 {
		margin-bottom: 0.45rem;
		font-size: 1rem;
		line-height: 1.2;
	}

	.tooltip-badge {
		display: inline-flex;
		margin-bottom: 0.7rem;
		padding: 0.22rem 0.52rem;
		border-radius: 999px;
		font-size: 0.72rem;
		font-weight: 700;
	}

	.tooltip-badge--tod {
		background: color-mix(in srgb, var(--tod) 14%, white);
		color: var(--tod);
	}

	.tooltip-badge--nontod_dominated {
		background: color-mix(in srgb, var(--nontod) 14%, white);
		color: var(--nontod);
	}

	.tooltip-badge--minimal {
		background: color-mix(in srgb, var(--minimal) 16%, white);
		color: #506075;
	}

	.tooltip-highlight {
		padding: 0.55rem 0.65rem;
		border-radius: 12px;
		margin-bottom: 0.55rem;
	}

	.tooltip-highlight--tod {
		background: color-mix(in srgb, var(--tod) 11%, white);
	}

	.tooltip-highlight--nontod_dominated {
		background: color-mix(in srgb, var(--nontod) 11%, white);
	}

	.tooltip-highlight--minimal {
		background: color-mix(in srgb, var(--minimal) 13%, white);
	}

	.tooltip-row {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: 1rem;
		align-items: baseline;
		font-size: 0.8rem;
		color: var(--muted);
	}

	.tooltip-row + .tooltip-row {
		margin-top: 0.34rem;
	}

	.tooltip-row--strong {
		color: var(--ink);
	}

	.tooltip-details {
		display: grid;
		gap: 0.2rem;
	}

	@media (max-width: 960px) {
		.map-card {
			padding: 0.95rem;
		}

		.map-header {
			align-items: start;
			flex-direction: column;
		}
	}
</style>
