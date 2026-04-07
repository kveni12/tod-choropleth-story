/**
 * D3 charts for the main-page tract POC (mirrors ``static/municipal/index.html`` behavior).
 */
import * as d3 from 'd3';
import { createMapZoomLayer } from './mapZoom.js';

const incomePalette = ['#edf4ff', '#bfd6f6', '#6fa8dc', '#2f6ea6', '#003da5'];

const fmtInt = d3.format(',');
const fmtPct1 = d3.format('.1%');

function makeTooltip(root) {
	return root.append('div').attr('class', 'mpc-tooltip');
}

function positionTooltip(root, tooltip, event) {
	const rect = root.node().getBoundingClientRect();
	let x = event.clientX - rect.left + 14;
	let y = event.clientY - rect.top + 14;
	const node = tooltip.node();
	if (node) {
		const tw = node.offsetWidth || 0;
		const th = node.offsetHeight || 0;
		if (x + tw > rect.width - 10) x = Math.max(8, x - tw - 28);
		if (y + th > rect.height - 10) y = Math.max(8, y - th - 28);
	}
	tooltip.style('left', `${x}px`).style('top', `${y}px`);
}

function addHtmlLegend(root, items) {
	const legend = root.append('div').attr('class', 'mpc-legend').style('margin-bottom', '10px');
	items.forEach((item) => {
		const entry = legend.append('span').attr('class', 'mpc-legend-item');
		if (item.type === 'line') {
			entry
				.append('span')
				.style('width', '18px')
				.style('height', '0')
				.style('border-top', `3px solid ${item.color}`)
				.style('display', 'inline-block');
		} else if (item.type === 'outline') {
			entry
				.append('span')
				.style('width', '12px')
				.style('height', '12px')
				.style('border-radius', '999px')
				.style('border', `2px solid ${item.color}`)
				.style('background', item.fill || 'transparent')
				.style('display', 'inline-block');
		} else {
			entry.append('span').attr('class', 'mpc-swatch').style('background', item.color || '#999');
		}
		entry.append('span').text(item.label);
	});
	return legend;
}

function addRampLegend(root, labelLeft, labelRight, colors) {
	const legend = root.append('div').attr('class', 'mpc-legend').style('margin-bottom', '10px');
	const scale = legend.append('span').attr('class', 'mpc-legend-scale');
	scale.append('span').text(labelLeft);
	const ramp = scale.append('span').attr('class', 'mpc-legend-ramp');
	colors.forEach((color) => ramp.append('span').style('background', color));
	scale.append('span').text(labelRight);
	return legend;
}

function linearRegression(points) {
	const valid = points.filter((d) => Number.isFinite(d.x) && Number.isFinite(d.y));
	if (valid.length < 2) return null;
	const meanX = d3.mean(valid, (d) => d.x);
	const meanY = d3.mean(valid, (d) => d.y);
	const numerator = d3.sum(valid, (d) => (d.x - meanX) * (d.y - meanY));
	const denominator = d3.sum(valid, (d) => (d.x - meanX) ** 2);
	if (!denominator) return null;
	const slope = numerator / denominator;
	const intercept = meanY - slope * meanX;
	return { slope, intercept };
}

const affordableColor = d3.scaleThreshold().domain([0.05, 0.1, 0.2, 0.35]).range(incomePalette);

function nhgisWeightedMean(values, key) {
	const valid = values.filter(
		(d) => Number.isFinite(d[key]) && Number.isFinite(d.pop_2020) && d.pop_2020 > 0
	);
	if (!valid.length) return NaN;
	const total = d3.sum(valid, (d) => d.pop_2020);
	return d3.sum(valid, (d) => d[key] * d.pop_2020) / total;
}

function permutationPValue(a, b, accessor, iterations = 600) {
	const aVals = a.map(accessor).filter(Number.isFinite);
	const bVals = b.map(accessor).filter(Number.isFinite);
	if (aVals.length < 2 || bVals.length < 2) return NaN;
	const observed = Math.abs(d3.mean(aVals) - d3.mean(bVals));
	const combined = aVals.concat(bVals);
	const split = aVals.length;
	let extreme = 0;
	for (let i = 0; i < iterations; i += 1) {
		const shuffled = d3.shuffle(combined.slice());
		const left = shuffled.slice(0, split);
		const right = shuffled.slice(split);
		const diff = Math.abs(d3.mean(left) - d3.mean(right));
		if (diff >= observed) extreme += 1;
	}
	return (extreme + 1) / (iterations + 1);
}

function significanceStars(pValue) {
	if (!Number.isFinite(pValue)) return '';
	if (pValue < 0.001) return '***';
	if (pValue < 0.01) return '**';
	if (pValue < 0.05) return '*';
	return '';
}

/**
 * Draw all tract-mode POC panels into the given container elements.
 *
 * Parameters
 * ----------
 * cfg : object
 */
export function drawMainPocTractCharts(cfg) {
	const {
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
		state,
		visibleRows,
		domainRows,
		projectRows,
		selectedProjectRows,
		nhgisLikeRows,
		tractGeo
	} = cfg;

	const visibleTotalUnits = Math.max(1, d3.sum(visibleRows, (d) => d.units));
	const domainTotalUnits = Math.max(1, d3.sum(domainRows, (d) => d.units));

	// --- Scatter ---
	if (elScatter) {
		const root = d3.select(elScatter);
		root.selectAll('*').remove();
		if (!visibleRows.length) {
			root.append('div').attr('class', 'mpc-empty').text('No tracts match the current filters.');
		} else {
			const yAccessor =
				state.growthScale === 'share'
					? (d) => (d.units / visibleTotalUnits) * 100
					: (d) => d.units;
			const yDomainAccessor =
				state.growthScale === 'share'
					? (d) => (d.units / domainTotalUnits) * 100
					: (d) => d.units;
			const yLabel =
				state.growthScale === 'share'
					? 'Share of visible-window growth (%)'
					: 'New units added in selected years';

			addHtmlLegend(root, [
				{ type: 'outline', color: 'var(--mpc-accent)', fill: '#ffffff', label: 'TOD-dominant tract' },
				{ type: 'outline', color: 'var(--mpc-warning)', fill: '#ffffff', label: 'Non-TOD-dominant tract' },
				{ type: 'outline', color: '#b7b0a3', fill: '#ffffff', label: 'No units in current window' }
			]);
			root.append('span').attr('class', 'mpc-legend-item').text('Point size = affordable units added');
			addRampLegend(root, 'Lower affordable share', 'Higher affordable share', incomePalette);

			const width = root.node().clientWidth || 800;
			const height = 420;
			const margin = { top: 20, right: 20, bottom: 54, left: 66 };
			const innerW = width - margin.left - margin.right;
			const innerH = height - margin.top - margin.bottom;
			const svg = root.append('svg').attr('viewBox', `0 0 ${width} ${height}`);
			const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

			const unitValues = domainRows.map(yDomainAccessor).filter(Number.isFinite).sort(d3.ascending);
			const affordableValues = domainRows.map((d) => d.affordableUnits).filter(Number.isFinite).sort(d3.ascending);
			const yMax =
				state.growthScale === 'share'
					? 100
					: Math.max(1, d3.quantile(unitValues, 0.98) || d3.max(unitValues) || 1);
			const rMax = Math.max(1, d3.quantile(affordableValues, 0.98) || d3.max(affordableValues) || 1);

			const x = d3
				.scaleLinear()
				.domain(d3.extent(domainRows, (d) => d.vulnerabilityPct))
				.nice()
				.range([0, innerW]);
			const y = d3.scaleLinear().domain([0, yMax]).nice().range([innerH, 0]).clamp(true);
			const r = d3.scaleSqrt().domain([0, rMax]).range([3, 14]).clamp(true);

			root
				.append('div')
				.attr('class', 'mpc-chart-note')
				.style('margin-bottom', '10px')
				.text(
					state.growthScale === 'share'
						? 'Linear y-axis: share of visible-window growth among filtered tracts.'
						: `Linear y-axis: new units in the selected years (98th pct ≈ ${d3.format(',.0f')(yMax)} units).`
				);

			const tooltip = makeTooltip(root);

			g.append('g')
				.attr('transform', `translate(0,${innerH})`)
				.call(d3.axisBottom(x).ticks(6).tickFormat((d) => `${d}%`));
			g.append('g').call(d3.axisLeft(y).ticks(6).tickFormat(state.growthScale === 'share' ? (d) => `${d}%` : d3.format('~s')));

			g.append('text')
				.attr('x', innerW / 2)
				.attr('y', innerH + 42)
				.attr('text-anchor', 'middle')
				.attr('fill', '#5e6573')
				.text('Poverty rate (tract, ACS 2020)');
			g.append('text')
				.attr('transform', 'rotate(-90)')
				.attr('x', -innerH / 2)
				.attr('y', -46)
				.attr('text-anchor', 'middle')
				.attr('fill', '#5e6573')
				.text(yLabel);

			const avgX = d3.mean(domainRows, (d) => d.vulnerabilityPct) || 0;
			const avgY = d3.mean(domainRows, yDomainAccessor) || 0;
			g.append('line')
				.attr('x1', x(avgX))
				.attr('x2', x(avgX))
				.attr('y1', 0)
				.attr('y2', innerH)
				.attr('stroke', '#b7b0a3')
				.attr('stroke-dasharray', '5 4');
			g.append('line')
				.attr('x1', 0)
				.attr('x2', innerW)
				.attr('y1', y(avgY))
				.attr('y2', y(avgY))
				.attr('stroke', '#b7b0a3')
				.attr('stroke-dasharray', '5 4');

			if (state.showTrendline) {
				const regression = linearRegression(
					visibleRows.map((d) => ({ x: d.vulnerabilityPct, y: yAccessor(d) }))
				);
				if (regression) {
					const xDom = x.domain();
					const trendPoints = xDom.map((xVal) => ({
						x: xVal,
						y: regression.slope * xVal + regression.intercept
					}));
					const line = d3
						.line()
						.x((d) => x(d.x))
						.y((d) => y(Math.max(0, Math.min(yMax, d.y))));
					g.append('path')
						.datum(trendPoints)
						.attr('fill', 'none')
						.attr('stroke', '#374151')
						.attr('stroke-width', 2)
						.attr('stroke-dasharray', '8 5')
						.attr('opacity', 0.8)
						.attr('d', line);
				}
			}

			g.selectAll('circle')
				.data(visibleRows, (d) => d.gisjoin)
				.join('circle')
				.attr('cx', (d) => x(d.vulnerabilityPct))
				.attr('cy', (d) => y(yAccessor(d)))
				.attr('r', (d) => r(d.affordableUnits))
				.attr('fill', (d) => affordableColor(d.affordableShare))
				.attr('fill-opacity', (d) =>
					state.selected.size && !state.selected.has(d.gisjoin) ? 0.28 : 0.75
				)
				.attr('stroke', (d) =>
					d.dominant === 'tod'
						? 'var(--mpc-accent)'
						: d.dominant === 'nonTod'
							? 'var(--mpc-warning)'
							: '#b7b0a3'
				)
				.attr('stroke-width', (d) => (state.selected.has(d.gisjoin) ? 2.8 : 1.8))
				.style('cursor', 'pointer')
				.on('click', (event, d) => {
					event.stopPropagation();
					cfg.toggleSelect(d.gisjoin);
				})
				.on('mouseenter', function (event, d) {
					d3.select(this).attr('stroke-width', 2.8);
					tooltip
						.style('opacity', 1)
						.html(
							`<strong>${d.label}</strong><br/>` +
								`Poverty rate: ${d.vulnerabilityPct.toFixed(1)}%<br/>` +
								`New units: ${fmtInt(Math.round(d.units))}<br/>` +
								(state.growthScale === 'share'
									? `Share of visible growth: ${((d.units / visibleTotalUnits) * 100).toFixed(1)}%<br/>`
									: '') +
								`Affordable share: ${fmtPct1(d.affordableShare)}<br/>` +
								`TOD share (MF-based): ${fmtPct1(d.todShare)}<br/>` +
								`County: ${d.county || '—'}`
						);
					positionTooltip(root, tooltip, event);
				})
				.on('mousemove', (event) => positionTooltip(root, tooltip, event))
				.on('mouseleave', function () {
					d3.select(this).attr('stroke-width', (d) => (state.selected.has(d.gisjoin) ? 2.8 : 1.8));
					tooltip.style('opacity', 0);
				});

			svg.on('click', () => cfg.clearSelection());
		}
	}

	// --- Main tract choropleth (MassBuilds metrics) ---
	if (elChoro) {
		const root = d3.select(elChoro);
		root.selectAll('*').remove();
		if (!tractGeo?.features?.length || !visibleRows.length) {
			root.append('div').attr('class', 'mpc-empty').text('No tract map data available.');
		} else {
			const byGj = new Map(visibleRows.map((d) => [d.gisjoin, d]));
			const metricConfig = {
				units: { label: 'New units in current window', get: (d) => d.units, fmt: d3.format(',.0f') },
				affordableUnits: { label: 'Affordable units in current window', get: (d) => d.affordableUnits, fmt: d3.format(',.0f') },
				under125: {
					label: 'Poverty rate (ACS 2020)',
					get: (d) => d.vulnerabilityPct / 100,
					fmt: d3.format('.0%')
				},
				high125: {
					label: 'Low poverty proxy (100 − poverty %)',
					get: (d) => d.highIncomeProxy / 100,
					fmt: d3.format('.0%')
				},
				affordableShare: { label: 'Affordable share', get: (d) => d.affordableShare, fmt: d3.format('.0%') },
				todShare: { label: 'TOD share of units (MF-based)', get: (d) => d.todShare, fmt: d3.format('.0%') }
			}[state.mapMetric];

			const domainValues = visibleRows.map(metricConfig.get).filter(Number.isFinite).sort(d3.ascending);
			const colorDomain =
				state.mapMetric === 'affordableShare' || state.mapMetric === 'todShare' || state.mapMetric === 'under125' || state.mapMetric === 'high125'
					? [0, 1]
					: [0, d3.quantile(domainValues, 0.98) || d3.max(domainValues) || 1];
			const color = d3.scaleQuantize().domain(colorDomain).range(incomePalette);
			addRampLegend(root, 'Lower', `Higher ${metricConfig.label.toLowerCase()}`, incomePalette);

			const width = root.node().clientWidth || 720;
			const height = 480;
			const projection = d3.geoMercator().fitSize([width, height], tractGeo);
			const path = d3.geoPath(projection);
			const svg = root
				.append('svg')
				.attr('viewBox', `0 0 ${width} ${height}`)
				.attr('width', '100%')
				.attr('height', 'auto')
				.attr('preserveAspectRatio', 'xMidYMid meet')
				.style('display', 'block')
				.style('touch-action', 'none');
			const zoomLayer = createMapZoomLayer(svg, width, height, { maxScale: 22 });
			const tooltip = makeTooltip(root);

			zoomLayer
				.selectAll('path')
				.data(tractGeo.features)
				.join('path')
				.attr('vector-effect', 'non-scaling-stroke')
				.attr('d', path)
				.attr('fill', (d) => {
					const gj = d.properties?.gisjoin;
					const row = byGj.get(gj);
					return row ? color(metricConfig.get(row)) : '#e7e0d5';
				})
				.attr('stroke', (d) => {
					const gj = d.properties?.gisjoin;
					const row = byGj.get(gj);
					return row && state.selected.has(gj) ? '#111827' : 'rgba(60,64,67,0.18)';
				})
				.attr('stroke-width', (d) => {
					const gj = d.properties?.gisjoin;
					const row = byGj.get(gj);
					return row && state.selected.has(gj) ? 1.8 : 0.35;
				})
				.style('cursor', 'pointer')
				.on('click', (event, d) => {
					event.stopPropagation();
					const gj = d.properties?.gisjoin;
					const row = byGj.get(gj);
					if (!row) return;
					cfg.toggleSelect(gj);
				})
				.on('mouseenter', (event, d) => {
					const gj = d.properties?.gisjoin;
					const row = byGj.get(gj);
					if (!row) return;
					tooltip
						.style('opacity', 1)
						.html(
							`<strong>${row.label}</strong><br/>` +
								`${metricConfig.label}: ${metricConfig.fmt(metricConfig.get(row))}<br/>` +
								`Poverty rate: ${row.vulnerabilityPct.toFixed(1)}%<br/>` +
								`Affordable share: ${fmtPct1(row.affordableShare)}`
						);
					positionTooltip(root, tooltip, event);
				})
				.on('mousemove', (event) => positionTooltip(root, tooltip, event))
				.on('mouseleave', () => tooltip.style('opacity', 0));

			svg.on('click', () => cfg.clearSelection());

			root
				.append('p')
				.attr('class', 'mpc-map-zoom-hint')
				.text('Scroll or pinch to zoom · drag to pan · double-click to reset');
		}
	}

	// --- Timeline ---
	if (elTimeline) {
		const root = d3.select(elTimeline);
		root.selectAll('*').remove();
		if (!selectedProjectRows.length) {
			root.append('div').attr('class', 'mpc-empty').text('No projects in the current window.');
		} else {
			addHtmlLegend(root, [
				{ color: '#d5b08c', label: 'New units by year' },
				{ type: 'line', color: '#17316f', label: 'Affordable share' }
			]);
			const series = d3.range(state.yearStart, state.yearEnd + 1).map((year) => {
				const rows = selectedProjectRows.filter((d) => d.year === year);
				const units = d3.sum(rows, (d) => d.units);
				const affordableUnits = d3.sum(rows, (d) => d.affordableUnits);
				return { year, units, affordableShare: units ? affordableUnits / units : 0 };
			});
			const width = root.node().clientWidth || 520;
			const height = 300;
			const margin = { top: 18, right: 46, bottom: 40, left: 50 };
			const innerW = width - margin.left - margin.right;
			const innerH = height - margin.top - margin.bottom;
			const svg = root.append('svg').attr('viewBox', `0 0 ${width} ${height}`);
			const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);
			const x = d3
				.scaleBand()
				.domain(series.map((d) => d.year))
				.range([0, innerW])
				.padding(0.18);
			const y = d3.scaleLinear().domain([0, d3.max(series, (d) => d.units) || 1]).nice().range([innerH, 0]);
			const y2 = d3
				.scaleLinear()
				.domain([0, Math.max(0.35, d3.max(series, (d) => d.affordableShare) || 0)])
				.nice()
				.range([innerH, 0]);
			g.append('g')
				.attr('transform', `translate(0,${innerH})`)
				.call(
					d3
						.axisBottom(x)
						.tickValues(
							series.filter((_, i) => i % Math.max(1, Math.ceil(series.length / 7)) === 0).map((d) => d.year)
						)
				);
			g.append('g').call(d3.axisLeft(y).ticks(5).tickFormat(d3.format('~s')));
			g.append('g')
				.attr('transform', `translate(${innerW},0)`)
				.call(d3.axisRight(y2).ticks(4).tickFormat(d3.format('.0%')));
			g.selectAll('rect')
				.data(series)
				.join('rect')
				.attr('x', (d) => x(d.year))
				.attr('y', (d) => y(d.units))
				.attr('width', x.bandwidth())
				.attr('height', (d) => innerH - y(d.units))
				.attr('fill', '#d5b08c');
			const line = d3
				.line()
				.x((d) => x(d.year) + x.bandwidth() / 2)
				.y((d) => y2(d.affordableShare));
			g.append('path')
				.datum(series)
				.attr('fill', 'none')
				.attr('stroke', '#17316f')
				.attr('stroke-width', 2.5)
				.attr('d', line);
		}
	}

	// --- TOD composition stacked ---
	if (elComposition) {
		const root = d3.select(elComposition);
		root.selectAll('*').remove();
		if (!projectRows.length) {
			root.append('div').attr('class', 'mpc-empty').text('Change filters to see TOD vs non-TOD composition over time.');
		} else {
			addHtmlLegend(root, [
				{ color: 'var(--mpc-accent)', label: 'TOD MF units' },
				{ color: 'var(--mpc-warning)', label: 'Non-TOD units' }
			]);
			const series = d3.range(state.yearStart, state.yearEnd + 1).map((year) => {
				const rows = projectRows.filter((d) => d.year === year);
				const todUnits = d3.sum(rows, (d) => d.todUnits);
				const total = d3.sum(rows, (d) => d.units);
				return {
					year,
					todShare: total ? todUnits / total : 0,
					nonTodShare: total ? 1 - todUnits / total : 0,
					total
				};
			});
			const width = root.node().clientWidth || 520;
			const height = 300;
			const margin = { top: 18, right: 20, bottom: 40, left: 52 };
			const innerW = width - margin.left - margin.right;
			const innerH = height - margin.top - margin.bottom;
			const svg = root.append('svg').attr('viewBox', `0 0 ${width} ${height}`);
			const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);
			const x = d3
				.scaleBand()
				.domain(series.map((d) => d.year))
				.range([0, innerW])
				.padding(0.16);
			const y = d3.scaleLinear().domain([0, 1]).range([innerH, 0]);
			g.append('g')
				.attr('transform', `translate(0,${innerH})`)
				.call(
					d3
						.axisBottom(x)
						.tickValues(
							series.filter((_, i) => i % Math.max(1, Math.ceil(series.length / 7)) === 0).map((d) => d.year)
						)
				);
			g.append('g').call(d3.axisLeft(y).ticks(5).tickFormat(d3.format('.0%')));
			const bars = g
				.selectAll('.mpc-comp-year')
				.data(series)
				.join('g')
				.attr('class', 'mpc-comp-year')
				.attr('transform', (d) => `translate(${x(d.year)},0)`);
			bars
				.append('rect')
				.attr('x', 0)
				.attr('y', (d) => y(d.todShare))
				.attr('width', x.bandwidth())
				.attr('height', (d) => y(0) - y(d.todShare))
				.attr('fill', 'var(--mpc-accent)')
				.attr('rx', 4);
			bars
				.append('rect')
				.attr('x', 0)
				.attr('y', (d) => y(1))
				.attr('width', x.bandwidth())
				.attr('height', (d) => y(d.todShare) - y(1))
				.attr('fill', 'var(--mpc-warning)')
				.attr('rx', 4);
		}
	}

	// --- Ranked growth (top tracts) ---
	if (elRanked) {
		const root = d3.select(elRanked);
		root.selectAll('*').remove();
		const rows = visibleRows
			.filter((d) => d.units > 0)
			.sort((a, b) => d3.descending(a.units, b.units))
			.slice(0, 16);
		if (!rows.length) {
			root.append('div').attr('class', 'mpc-empty').text('No tract growth to rank in the current window.');
		} else {
			addRampLegend(root, 'Lower affordable share', 'Higher affordable share', incomePalette);
			const width = root.node().clientWidth || 720;
			const height = 360;
			const margin = { top: 16, right: 54, bottom: 30, left: 168 };
			const innerW = width - margin.left - margin.right;
			const innerH = height - margin.top - margin.bottom;
			const svg = root.append('svg').attr('viewBox', `0 0 ${width} ${height}`);
			const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);
			const y = d3
				.scaleBand()
				.domain(rows.map((d) => d.label))
				.range([0, innerH])
				.padding(0.2);
			const x = d3.scaleLinear().domain([0, d3.max(rows, (d) => d.units) || 1]).nice().range([0, innerW]);
			g.append('g').call(d3.axisLeft(y).tickSize(0));
			g.append('g').attr('transform', `translate(0,${innerH})`).call(d3.axisBottom(x).ticks(5).tickFormat(d3.format('~s')));
			g.selectAll('rect')
				.data(rows)
				.join('rect')
				.attr('x', 0)
				.attr('y', (d) => y(d.label))
				.attr('width', (d) => x(d.units))
				.attr('height', y.bandwidth())
				.attr('rx', 6)
				.attr('fill', (d) => affordableColor(d.affordableShare))
				.attr('stroke', (d) => (d.dominant === 'tod' ? 'var(--mpc-accent)' : 'var(--mpc-warning)'))
				.attr('stroke-width', 1.4);
		}
	}

	// --- Affordable vs market composition ---
	if (elAffordMix) {
		const root = d3.select(elAffordMix);
		root.selectAll('*').remove();
		if (!projectRows.length) {
			root.append('div').attr('class', 'mpc-empty').text('Change filters to see affordable vs market-rate composition over time.');
		} else {
			addHtmlLegend(root, [
				{ color: '#17316f', label: 'Affordable units' },
				{ color: '#d5b08c', label: 'Market-rate units' }
			]);
			const series = d3.range(state.yearStart, state.yearEnd + 1).map((year) => {
				const rows = projectRows.filter((d) => d.year === year);
				const total = d3.sum(rows, (d) => d.units);
				const affordableUnits = d3.sum(rows, (d) => d.affordableUnits);
				return {
					year,
					affordableShare: total ? affordableUnits / total : 0,
					marketShare: total ? 1 - affordableUnits / total : 0,
					total
				};
			});
			const width = root.node().clientWidth || 720;
			const height = 300;
			const margin = { top: 18, right: 20, bottom: 40, left: 52 };
			const innerW = width - margin.left - margin.right;
			const innerH = height - margin.top - margin.bottom;
			const svg = root.append('svg').attr('viewBox', `0 0 ${width} ${height}`);
			const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);
			const x = d3
				.scaleBand()
				.domain(series.map((d) => d.year))
				.range([0, innerW])
				.padding(0.16);
			const y = d3.scaleLinear().domain([0, 1]).range([innerH, 0]);
			g.append('g')
				.attr('transform', `translate(0,${innerH})`)
				.call(
					d3
						.axisBottom(x)
						.tickValues(
							series.filter((_, i) => i % Math.max(1, Math.ceil(series.length / 7)) === 0).map((d) => d.year)
						)
				);
			g.append('g').call(d3.axisLeft(y).ticks(5).tickFormat(d3.format('.0%')));
			const bars = g
				.selectAll('.mpc-aff-year')
				.data(series)
				.join('g')
				.attr('class', 'mpc-aff-year')
				.attr('transform', (d) => `translate(${x(d.year)},0)`);
			bars
				.append('rect')
				.attr('x', 0)
				.attr('y', (d) => y(d.affordableShare))
				.attr('width', x.bandwidth())
				.attr('height', (d) => y(0) - y(d.affordableShare))
				.attr('fill', '#17316f')
				.attr('rx', 4);
			bars
				.append('rect')
				.attr('x', 0)
				.attr('y', (d) => y(1))
				.attr('width', x.bandwidth())
				.attr('height', (d) => y(d.affordableShare) - y(1))
				.attr('fill', '#d5b08c')
				.attr('rx', 4);
		}
	}

	// --- Growth capture (poverty median split) ---
	if (elGrowthCapture) {
		const root = d3.select(elGrowthCapture);
		root.selectAll('*').remove();
		if (!projectRows.length || !domainRows.length) {
			root.append('div').attr('class', 'mpc-empty').text('Change filters to compare where yearly growth is landing.');
		} else {
			const vulnerabilityMedian = d3.median(domainRows, (d) => d.vulnerabilityPct) || 0;
			const highVulnerability = new Set(
				domainRows.filter((d) => d.vulnerabilityPct >= vulnerabilityMedian).map((d) => d.gisjoin)
			);
			const series = d3.range(state.yearStart, state.yearEnd + 1).map((year) => {
				const rows = projectRows.filter((d) => d.year === year);
				const total = d3.sum(rows, (d) => d.units);
				const highUnits = d3.sum(rows.filter((d) => highVulnerability.has(d.gisjoin)), (d) => d.units);
				const lowUnits = total - highUnits;
				return {
					year,
					highShare: total ? highUnits / total : 0,
					lowShare: total ? lowUnits / total : 0,
					total
				};
			});
			addHtmlLegend(root, [
				{ color: 'var(--mpc-accent)', label: 'Higher poverty tracts (≥ median)' },
				{ color: 'var(--mpc-blue5)', label: 'Lower poverty tracts' }
			]);
			const width = root.node().clientWidth || 520;
			const height = 300;
			const margin = { top: 18, right: 18, bottom: 34, left: 52 };
			const innerW = width - margin.left - margin.right;
			const innerH = height - margin.top - margin.bottom;
			const svg = root.append('svg').attr('viewBox', `0 0 ${width} ${height}`);
			const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);
			const x = d3.scaleLinear().domain(d3.extent(series, (d) => d.year)).range([0, innerW]);
			const y = d3.scaleLinear().domain([0, 1]).range([innerH, 0]);
			g.append('g')
				.attr('transform', `translate(0,${innerH})`)
				.call(d3.axisBottom(x).ticks(Math.min(7, series.length)).tickFormat(d3.format('d')));
			g.append('g').call(d3.axisLeft(y).ticks(5).tickFormat(d3.format('.0%')));
			const area = d3
				.area()
				.x((d) => x(d.year))
				.y0(innerH)
				.y1((d) => y(d.highShare));
			const line = d3
				.line()
				.x((d) => x(d.year))
				.y((d) => y(d.highShare));
			const lowLine = d3
				.line()
				.x((d) => x(d.year))
				.y((d) => y(d.lowShare));
			g.append('path').datum(series).attr('fill', 'var(--mpc-accent-soft)').attr('fill-opacity', 0.85).attr('d', area);
			g.append('path')
				.datum(series)
				.attr('fill', 'none')
				.attr('stroke', 'var(--mpc-accent)')
				.attr('stroke-width', 2.4)
				.attr('d', line);
			g.append('path')
				.datum(series)
				.attr('fill', 'none')
				.attr('stroke', 'var(--mpc-blue5)')
				.attr('stroke-width', 2)
				.attr('stroke-dasharray', '6 4')
				.attr('d', lowLine);
		}
	}

	// --- Income & education: cohort comparison (population-weighted means, separate scale per outcome) ---
	if (elTractEdu) {
		const root = d3.select(elTractEdu);
		root.selectAll('*').remove();
		if (!nhgisLikeRows?.length) {
			root.append('div').attr('class', 'mpc-empty').text('No tract comparison data.');
		} else {
			const cohorts = [
				{ key: 'tod', label: 'TOD-dominated', color: '#0d9488' },
				{ key: 'nonTod', label: 'Non-TOD-dominated', color: '#ea580c' },
				{ key: 'minimal', label: 'Minimal development', color: '#64748b' }
			];
			const metrics = [
				{
					key: 'median_income_change_pct_10_20',
					title: 'Median household income',
					subtitle: 'Percent change (2010–2020), population-weighted by tract',
					xAxisLabel: 'Mean change (%)',
					fmt: (v) => `${v.toFixed(1)}%`,
					tickFmt: (v) => `${v.toFixed(0)}%`
				},
				{
					key: 'bachelors_pct_change_10_20',
					title: "Bachelor's degree or higher",
					subtitle: 'Change in share of adults 25+ (percentage points), population-weighted',
					xAxisLabel: 'Mean change (percentage points)',
					fmt: (v) => `${v.toFixed(1)} pp`,
					tickFmt: (v) => `${v.toFixed(1)}`
				}
			];
			const todRows = nhgisLikeRows.filter((d) => d.devClass === 'tod_dominated');
			const nonTodRows = nhgisLikeRows.filter((d) => d.devClass === 'nontod_dominated');
			const minimalRows = nhgisLikeRows.filter((d) => d.devClass === 'minimal');
			const summary = metrics.map((metric) => ({
				...metric,
				tod: nhgisWeightedMean(todRows, metric.key),
				nonTod: nhgisWeightedMean(nonTodRows, metric.key),
				minimal: nhgisWeightedMean(minimalRows, metric.key),
				pValue: permutationPValue(todRows, nonTodRows, (d) => d[metric.key])
			}));

			const leg = root.append('div').attr('class', 'mpc-tract-edu-legend');
			for (const c of cohorts) {
				const span = leg.append('span').attr('class', 'mpc-tract-edu-legend-item');
				span.append('span').attr('class', 'mpc-tract-edu-swatch').style('background-color', c.color);
				span.append('span').text(c.label);
			}

			const width = Math.max(300, root.node().clientWidth || 640);
			/* Vertical space per metric block — taller bar stack = thicker horizontal bars. */
			const blockH = 172;
			const legendH = 40;
			const margin = { top: 10, right: 12, bottom: 14, left: 12 };
			const innerW = width - margin.left - margin.right;
			const totalH = legendH + summary.length * blockH + margin.top + margin.bottom;
			const height = Math.min(580, Math.max(300, totalH));

			const svg = root
				.append('svg')
				.attr('viewBox', `0 0 ${width} ${height}`)
				.attr('width', '100%')
				.attr('height', 'auto')
				.attr('preserveAspectRatio', 'xMidYMid meet')
				.attr('class', 'mpc-tract-edu-svg')
				.style('display', 'block');

			const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

			summary.forEach((row, i) => {
				const blockG = g.append('g').attr('transform', `translate(0,${legendH + i * blockH})`);

				const vals = cohorts.map((c) => ({
					...c,
					value: row[c.key]
				}));
				const finite = vals.filter((d) => Number.isFinite(d.value));
				const minV = finite.length ? Math.min(0, d3.min(finite, (d) => d.value) ?? 0) : 0;
				const maxV = finite.length ? Math.max(0, d3.max(finite, (d) => d.value) ?? 0) : 1;
				const spanR = maxV - minV || 1e-6;
				const pad = spanR * 0.08;
				const x = d3.scaleLinear().domain([minV - pad, maxV + pad]).range([0, innerW]);

				blockG
					.append('text')
					.attr('x', 0)
					.attr('y', 15)
					.attr('font-size', 13)
					.attr('font-weight', 600)
					.attr('fill', 'currentColor')
					.text(row.title);

				blockG
					.append('text')
					.attr('x', 0)
					.attr('y', 31)
					.attr('font-size', 10)
					.attr('fill', 'currentColor')
					.attr('opacity', 0.72)
					.text(row.subtitle);

				const stars = significanceStars(row.pValue);
				const pNote =
					stars ||
					(Number.isFinite(row.pValue) ? `p = ${row.pValue.toFixed(3)} (TOD vs non-TOD)` : '');
				blockG
					.append('text')
					.attr('x', innerW)
					.attr('y', 15)
					.attr('text-anchor', 'end')
					.attr('font-size', 11)
					.attr('font-weight', 600)
					.attr('fill', 'currentColor')
					.text(pNote);

				const barTop = 44;
				const barH = 72;
				const sub = d3.scaleBand().domain(['tod', 'nonTod', 'minimal']).range([0, barH]).padding(0.06);

				for (const d of vals) {
					const v = d.value;
					if (!Number.isFinite(v)) continue;
					const xStart = x(Math.min(0, v));
					const xEnd = x(Math.max(0, v));
					const w = Math.max(0.5, xEnd - xStart);
					blockG
						.append('rect')
						.attr('x', xStart)
						.attr('y', barTop + sub(d.key))
						.attr('width', w)
						.attr('height', sub.bandwidth())
						.attr('fill', d.color)
						.attr('rx', 4)
						.attr('opacity', 0.92);

					const labelX = v >= 0 ? xEnd + 5 : xStart - 5;
					const anchor = v >= 0 ? 'start' : 'end';
					blockG
						.append('text')
						.attr('x', labelX)
						.attr('y', barTop + sub(d.key) + sub.bandwidth() / 2 + 4)
						.attr('text-anchor', anchor)
						.attr('font-size', 10)
						.attr('font-weight', 600)
						.attr('fill', '#334155')
						.text(row.fmt(v));
				}

				if (minV < 0 && maxV > 0) {
					blockG
						.append('line')
						.attr('x1', x(0))
						.attr('x2', x(0))
						.attr('y1', barTop)
						.attr('y2', barTop + barH)
						.attr('stroke', '#94a3b8')
						.attr('stroke-width', 1)
						.attr('stroke-dasharray', '4 3');
				}

				const axisG = blockG
					.append('g')
					.attr('transform', `translate(0,${barTop + barH + 6})`)
					.call(d3.axisBottom(x).ticks(5).tickFormat((d) => row.tickFmt(d)));
				axisG.selectAll('path,line').attr('stroke', 'currentColor').attr('opacity', 0.35);
				axisG.selectAll('text').attr('fill', 'currentColor').attr('opacity', 0.7).attr('font-size', 9);

				blockG
					.append('text')
					.attr('x', innerW / 2)
					.attr('y', barTop + barH + 34)
					.attr('text-anchor', 'middle')
					.attr('font-size', 10)
					.attr('fill', 'currentColor')
					.attr('opacity', 0.65)
					.text(row.xAxisLabel);
			});
		}
	}

	// --- Mobility strip / box simplified: mean comparison text + small bars ---
	if (elMobility) {
		const root = d3.select(elMobility);
		root.selectAll('*').remove();
		const data = nhgisLikeRows.filter((d) => Number.isFinite(d.avg_travel_time_change_10_20));
		if (!data.length) {
			root.append('div').attr('class', 'mpc-empty').text('No travel-time change data.');
		} else {
			const todRows = data.filter((d) => d.devClass === 'tod_dominated');
			const nonTodRows = data.filter((d) => d.devClass === 'nontod_dominated');
			const minimalRows = data.filter((d) => d.devClass === 'minimal');
			const mTod = nhgisWeightedMean(todRows, 'avg_travel_time_change_10_20');
			const mNon = nhgisWeightedMean(nonTodRows, 'avg_travel_time_change_10_20');
			const mMin = nhgisWeightedMean(minimalRows, 'avg_travel_time_change_10_20');
			const diff = mTod - mNon;
			const pVal = permutationPValue(todRows, nonTodRows, (d) => d.avg_travel_time_change_10_20);
			root
				.append('p')
				.attr('class', 'mpc-chart-note')
				.text(
					`Travel-time change (2010–20, pop.-weighted means): TOD-dom. ${Number.isFinite(mTod) ? `${mTod.toFixed(2)} min` : '—'} · non-TOD ${Number.isFinite(mNon) ? `${mNon.toFixed(2)} min` : '—'} · minimal development ${Number.isFinite(mMin) ? `${mMin.toFixed(2)} min` : '—'}. TOD vs non-TOD gap ${diff >= 0 ? '+' : ''}${Number.isFinite(diff) ? diff.toFixed(2) : '—'} min ${significanceStars(pVal) || 'n.s.'}`
				);
		}
	}

	// --- Takeaway cards ---
	if (elTakeaway) {
		const root = d3.select(elTakeaway);
		root.selectAll('*').remove();
		if (!nhgisLikeRows?.length) return;
		const todRows = nhgisLikeRows.filter((d) => d.devClass === 'tod_dominated');
		const nonTodRows = nhgisLikeRows.filter((d) => d.devClass === 'nontod_dominated');
		const minimalRows = nhgisLikeRows.filter((d) => d.devClass === 'minimal');
		const metrics = [
			{ title: 'Income change', key: 'median_income_change_pct_10_20', fmt: (v) => `${v.toFixed(1)}%` },
			{ title: "Bachelor's change", key: 'bachelors_pct_change_10_20', fmt: (v) => `${v.toFixed(1)} pp` },
			{ title: 'Travel time change', key: 'avg_travel_time_change_10_20', fmt: (v) => `${v.toFixed(1)} min` }
		];
		for (const metric of metrics) {
			const tod = nhgisWeightedMean(todRows, metric.key);
			const nonTod = nhgisWeightedMean(nonTodRows, metric.key);
			const minimal = nhgisWeightedMean(minimalRows, metric.key);
			const diff = tod - nonTod;
			const card = root.append('div').attr('class', 'mpc-summary-stat');
			card.append('div').attr('class', 'mpc-k').text(metric.title);
			card
				.append('div')
				.attr('class', 'mpc-v')
				.text(`TOD − non-TOD: ${diff >= 0 ? '+' : ''}${metric.fmt(diff)}`);
			card
				.append('div')
				.attr('class', 'mpc-chart-note')
				.style('margin-top', '6px')
				.text(
					`Minimal development: ${Number.isFinite(minimal) ? metric.fmt(minimal) : '—'} (weighted)`
				);
		}
	}
}
