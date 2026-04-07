<script>
	import { onDestroy } from 'svelte';
	import * as d3 from 'd3';
	import {
		tractGeo,
		developments,
		mbtaStops,
		mbtaLines
	} from '$lib/stores/data.svelte.js';
	import {
		aggregateDevsByTract,
		aggregateTractTodMetrics,
		buildFilteredData,
		developmentAffordableUnitsCapped,
		developmentMultifamilyShare,
		developmentMbtaProximity,
		isDevelopmentTransitAccessible,
		transitDistanceMiToMetres,
		transitModeUiLabel
	} from '$lib/utils/derived.js';
	import { periodCensusBounds, periodDisplayLabel } from '$lib/utils/periods.js';
	import {
		MBTA_BLUE,
		MBTA_GREEN,
		MBTA_MAP_NEUTRAL,
		MBTA_ORANGE,
		MBTA_RED
	} from '$lib/utils/mbtaColors.js';

	/**
	 * Tract-dashboard–style map: census net housing-unit change choropleth (period from panel), TOD-tier
	 * outlines, optional MassBuilds developments and MBTA overlays.
	 *
	 * Parameters
	 * ----------
	 * panelState : PanelState
	 *     Shared with ``FilterPanel`` / ``MapView`` (transit toggles, dev filters, zoom).
	 * tractList : Array<object>
	 *     Filtered census tract rows (same universe as ``nhgisRows``).
	 * nhgisRows : Array<object>
	 *     Rows from ``buildNhgisLikeRows`` including ``gisjoin``, ``devClass``, ``census_hu_change``.
	 * metricsDevelopments : Array<object> | null | undefined
	 *     Optional MassBuilds rows for TOD / stock tooltips — use the same window as ``buildTractDevClassMap``
	 *     (e.g. 1990–2026 on the main POC). When omitted, uses ``buildFilteredData`` (panel period only).
	 */
	let { panelState, tractList, nhgisRows, metricsDevelopments = null } = $props();

	let containerEl = $state(null);
	let stepEls = $state([]);
	let tooltip = $state({
		visible: false,
		x: 0,
		y: 0,
		eyebrow: '',
		title: '',
		badge: '',
		badgeTone: '',
		primaryRows: [],
		secondaryRows: []
	});
	let revealStage = $state(0);

	/** Nice unit ticks + pixel radii for HTML dot-size legend (same sqrt scale as map dots). */
	let devSizeLegendTicks = $state(/** @type {{ units: number; rPx: number }[] | null} */ (null));

	/** Reserved width per map colorbar (ticks + bar + vertical title, inset from map). */
	const CHORO_LEGEND_COL_W = 70;
	const DEV_LEGEND_COL_W = 70;
	const mapUid = Math.random().toString(36).slice(2, 11);

	/** Lighter grey for minimal-development tract outline (half stroke vs TOD tiers); legend ring matches. */
	const MINIMAL_TRACT_STROKE = '#94a3b8';

	function devClassStroke(row) {
		const dc = row?.devClass;
		if (dc === 'tod_dominated') return 'var(--accent, #0d9488)';
		if (dc === 'nontod_dominated') return 'var(--warning, #ea580c)';
		if (dc === 'minimal') return MINIMAL_TRACT_STROKE;
		return 'rgba(60,64,67,0.22)';
	}

	function tintFill(baseFill, row) {
		if (revealStage < 1) return baseFill;
		const dc = row?.devClass;
		if (!dc) return baseFill;
		const accent =
			dc === 'tod_dominated'
				? 'var(--accent, #0d9488)'
				: dc === 'nontod_dominated'
					? 'var(--warning, #ea580c)'
					: MINIMAL_TRACT_STROKE;
		return d3.interpolateRgb(baseFill, accent)(dc === 'minimal' ? 0.1 : 0.17);
	}

	const stepContent = [
		{
			kicker: 'Step 1',
			title: 'Start with the choropleth',
			body: 'Focus first on tract color alone. Blue tracts added more housing units over the period; red tracts grew less or lost units.'
		},
		{
			kicker: 'Step 2',
			title: 'Add the tract categories',
			body: 'Then add the outline colors and the slight interior tint: green for TOD-dominated, orange for non-TOD-dominated, and gray for minimal-development tracts.'
		},
		{
			kicker: 'Step 3',
			title: 'Add the projects',
			body: 'Finally, bring in the MassBuilds developments to see how individual projects cluster within those tract patterns.'
		}
	];

	function stepRef(node, index) {
		stepEls[index] = node;
		stepEls = [...stepEls];
		return {
			destroy() {
				stepEls[index] = null;
				stepEls = [...stepEls];
			}
		};
	}

	/**
	 * Z-order rank for tract polygons (later in DOM = drawn on top at shared edges).
	 * Excluded (tan / no reliable % change) → minimal → non-TOD → TOD.
	 *
	 * Parameters
	 * ----------
	 * row : object | undefined
	 *     Row with ``census_hu_change`` and optional ``devClass``.
	 *
	 * Returns
	 * -------
	 * number
	 *     Integer 0–3 (0 lowest).
	 */
	function tractTierRankFromRow(row) {
		if (!row) return 0;
		const v = Number(row.census_hu_change);
		if (!Number.isFinite(v)) return 0;
		const dc = row.devClass;
		if (dc === 'tod_dominated') return 3;
		if (dc === 'nontod_dominated') return 2;
		if (dc === 'minimal') return 1;
		return 0;
	}

	/** Re-append tract paths so stroke precedence follows ``tractTierRankFromRow`` after data updates. */
	function reorderTractLayerPaths() {
		if (!containerEl) return;
		const rowByGj = new Map((nhgisRows ?? []).map((r) => [r.gisjoin, r]));
		const layer = d3.select(containerEl).select('.tract-layer');
		const nodes = layer.selectAll('path.tract-poly').nodes();
		if (nodes.length === 0) return;
		nodes.sort((na, nb) => {
			const da = d3.select(na).datum();
			const db = d3.select(nb).datum();
			const ra = tractTierRankFromRow(rowByGj.get(da.properties?.gisjoin));
			const rb = tractTierRankFromRow(rowByGj.get(db.properties?.gisjoin));
			if (ra !== rb) return ra - rb;
			return String(da.properties?.gisjoin ?? '').localeCompare(String(db.properties?.gisjoin ?? ''));
		});
		const parent = nodes[0].parentNode;
		if (!parent) return;
		for (const n of nodes) parent.appendChild(n);
	}

	let mapCanvasLeft = 0;
	let mapW = 520;
	const mapH = 480;

	let svgRef = $state(null);
	let zoomBehaviorRef = $state(null);
	let projectionRef = $state(null);
	let lastStructuralKey = $state('');

	/** @type {Map<string, object> | null} */
	let tractTodMetricsMap = $state(null);
	/** @type {Map<string, object> | null} */
	let devAggMap = $state(null);

	const structuralKey = $derived(
		JSON.stringify({
			n: tractList.length,
			gf: tractGeo?.features?.length ?? 0,
			ms: mbtaStops.length,
			showDev: panelState.showDevelopments
		})
	);

	const dataKey = $derived(
		JSON.stringify({
			tp: panelState.timePeriod,
			stops: panelState.minStops,
			tdMi: panelState.transitDistanceMi,
			sig: panelState.sigDevMinPctStockIncrease,
			todCut: panelState.todFractionCutoff,
			huSrc: panelState.huChangeSource,
			devMin: panelState.minUnitsPerProject,
			devMfPct: panelState.minDevMultifamilyRatioPct,
			devAffPct: panelState.minDevAffordableRatioPct,
			redev: panelState.includeRedevelopment,
			minPop: panelState.minPopulation,
			minDens: panelState.minPopDensity,
			dn: developments.length,
			nr: nhgisRows?.length ?? 0,
			md: metricsDevelopments?.length ?? -1,
			showDev: panelState.showDevelopments
		})
	);

	function meetsTodMultifamilyFloor(d, ps) {
		const minPct = Math.min(100, Math.max(0, Number(ps.minDevMultifamilyRatioPct) || 0));
		if (minPct <= 0) return true;
		const s = developmentMultifamilyShare(d);
		return s != null && s >= minPct / 100;
	}

	function stopColor(stop) {
		if (stop.color) return stop.color;
		const m = stop.modes ?? [];
		if (m.includes('commuter_rail')) return '#a855f7';
		if (m.includes('rail')) return '#3b82f6';
		if (m.includes('bus')) return '#f97316';
		return '#888';
	}

	function recenterMap() {
		if (!svgRef || !zoomBehaviorRef) return;
		svgRef
			.transition()
			.duration(350)
			.call(zoomBehaviorRef.transform, d3.zoomIdentity);
	}

	function stopRadius(stop) {
		const m = stop.modes ?? [];
		if (m.includes('rail') || m.includes('commuter_rail')) return 3;
		return 1.2;
	}

	function lineStrokeColor(routeColor) {
		if (routeColor == null || routeColor === '') return '#888';
		const s = String(routeColor).trim();
		return s.startsWith('#') ? s : `#${s}`;
	}

	function lineMode(routeType) {
		if (routeType === 0 || routeType === 1) return 'rail';
		if (routeType === 2) return 'commuter_rail';
		if (routeType === 3) return 'bus';
		return 'other';
	}

	/** Multifamily share ramp: MBTA orange → MBTA green (matches SVG MF legend and dots). */
	function interpolateOrangeGreen(t) {
		return d3.interpolateRgb(MBTA_ORANGE, MBTA_GREEN)(Math.min(1, Math.max(0, t)));
	}

	/**
	 * Pick human-friendly unit values between ``lo`` and ``hi`` for a sqrt-sized dot legend.
	 *
	 * Parameters
	 * ----------
	 * lo : number
	 *     Domain minimum (same as ``rScale`` domain lower bound).
	 * hi : number
	 *     Domain maximum.
	 * rScale : d3.ScaleContinuousNumeric<number, number>
	 *     Sqrt scale mapping units → dot radius in SVG px (same as map).
	 *
	 * Returns
	 * -------
	 * Array<{ units: number, rPx: number }>
	 */
	function computeDevSizeLegendTicks(lo, hi, rScale) {
		if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) return [];
		const raw = d3.ticks(lo, hi, 5).filter((t) => t >= lo && t <= hi);
		if (raw.length === 0) {
			const u = (lo + hi) / 2;
			return [{ units: u, rPx: rScale(u) }];
		}
		let vals = raw;
		if (raw.length > 4) {
			const pick = (i) => raw[Math.min(Math.max(0, i), raw.length - 1)];
			const idxs = [0, Math.floor(raw.length / 3), Math.floor((2 * raw.length) / 3), raw.length - 1];
			vals = [...new Set(idxs.map(pick))];
		}
		vals.sort((a, b) => a - b);
		return vals.map((units) => ({ units, rPx: rScale(units) }));
	}

	/** Format unit counts for the dot-size legend (comma-separated integers). */
	function formatDevUnitsLegend(u) {
		const n = Math.round(Number(u));
		if (!Number.isFinite(n)) return '—';
		return d3.format(',.0f')(n);
	}

	function buildTractLookup() {
		const m = new Map();
		for (const t of tractList) {
			if (t.gisjoin && typeof t.gisjoin === 'string' && t.gisjoin.startsWith('G')) m.set(t.gisjoin, t);
		}
		return m;
	}

	function refreshMetrics() {
		if (!tractList.length) {
			tractTodMetricsMap = null;
			devAggMap = null;
			return;
		}
		const tractMap = new Map();
		for (const t of tractList) {
			if (t.gisjoin) tractMap.set(t.gisjoin, t);
		}
		const transitM = transitDistanceMiToMetres(panelState.transitDistanceMi ?? 0.5);
		const minMf = Math.min(1, Math.max(0, (Number(panelState.minDevMultifamilyRatioPct) || 0) / 100));
		const tractSet = new Set(tractList.map((t) => t.gisjoin).filter(Boolean));
		let devsForMetrics;
		if (metricsDevelopments && Array.isArray(metricsDevelopments)) {
			devsForMetrics = metricsDevelopments.filter((d) => tractSet.has(d.gisjoin));
		} else {
			devsForMetrics = buildFilteredData(tractList, developments, panelState).filteredDevs;
		}
		tractTodMetricsMap = aggregateTractTodMetrics(
			devsForMetrics,
			tractMap,
			tractList,
			panelState.timePeriod,
			transitM,
			panelState.huChangeSource ?? 'massbuilds',
			minMf
		);
		devAggMap = aggregateDevsByTract(devsForMetrics, tractMap, panelState.timePeriod, panelState);
	}

	function rebuildSVG() {
		if (!containerEl) return;
		const root = d3.select(containerEl);
		root.selectAll('*').remove();

		const features = tractGeo?.features ?? [];
		if (features.length === 0) {
			root.append('p').attr('class', 'map-empty').text('Loading map data…');
			return;
		}

		const rowByGjForOrder = new Map((nhgisRows ?? []).map((r) => [r.gisjoin, r]));
		const sortedFeatures = [...features].sort((a, b) => {
			const ra = tractTierRankFromRow(rowByGjForOrder.get(a.properties?.gisjoin));
			const rb = tractTierRankFromRow(rowByGjForOrder.get(b.properties?.gisjoin));
			if (ra !== rb) return ra - rb;
			return String(a.properties?.gisjoin ?? '').localeCompare(String(b.properties?.gisjoin ?? ''));
		});

		const cw = containerEl.clientWidth || 900;
		mapW = Math.max(400, Math.min(1100, cw - CHORO_LEGEND_COL_W - DEV_LEGEND_COL_W - 16));

		mapCanvasLeft = 0;
		const svgW = mapCanvasLeft + mapW + CHORO_LEGEND_COL_W;
		const svgH = mapH;

		const projection = d3
			.geoMercator()
			.fitExtent(
				[
					[mapCanvasLeft, 0],
					[mapCanvasLeft + mapW, mapH]
				],
				tractGeo
			);
		projectionRef = projection;
		const path = d3.geoPath(projection);

		const svg = root
			.append('svg')
			.attr('viewBox', `0 0 ${svgW} ${svgH}`)
			.attr('width', '100%')
			.attr('height', 'auto')
			.attr('preserveAspectRatio', 'xMidYMid meet')
			.style('display', 'block')
			.style('background', 'var(--bg, #0f1115)');
		svgRef = svg;

		const clipId = `poc-map-clip-${mapUid}`;
		svg.append('defs').append('clipPath').attr('id', clipId)
			.append('rect')
			.attr('x', mapCanvasLeft)
			.attr('y', 0)
			.attr('width', mapW)
			.attr('height', mapH);

		svg.append('g').attr('class', 'map-dev-legend-group');

		const mapRoot = svg.append('g').attr('class', 'map-root').attr('clip-path', `url(#${clipId})`);
		const zoomLayer = mapRoot.append('g').attr('class', 'map-zoom-layer');

		zoomLayer
			.append('g')
			.attr('class', 'tract-layer')
			.selectAll('path.tract-poly')
			.data(sortedFeatures, (d) => d.properties?.gisjoin)
			.join('path')
			.attr('class', 'tract-poly')
			.attr('vector-effect', 'non-scaling-stroke')
			.attr('d', path)
			.attr('fill', 'var(--bg-card)')
			.attr('stroke', 'var(--border)')
			.attr('stroke-width', 0.5)
			.style('cursor', 'pointer')
			.on('mouseenter', handleTractEnter)
			.on('mousemove', handleMouseMove)
			.on('mouseleave', handleTractLeave)
			.on('click', handleTractClick);

		zoomLayer
			.append('g')
			.attr('class', 'mbta-lines-layer')
			.selectAll('path.mbta-line')
			.data(mbtaLines?.features ?? [], (d, i) => d.properties?.route_id ?? i)
			.join('path')
			.attr('class', 'mbta-line')
			.attr('d', path)
			.attr('fill', 'none')
			.attr('stroke', (d) => lineStrokeColor(d.properties?.route_color))
			.attr('stroke-width', 1.5)
			.attr('stroke-opacity', 0.7)
			.attr('vector-effect', 'non-scaling-stroke')
			.style('cursor', 'pointer')
			.on('mouseenter', handleLineEnter)
			.on('mousemove', handleMouseMove)
			.on('mouseleave', handleOverlayLeave);

		const stopG = zoomLayer.append('g').attr('class', 'mbta-stops-layer');
		stopG
			.selectAll('circle.mbta-stop')
			.data(mbtaStops, (d) => d.id)
			.join('circle')
			.attr('class', 'mbta-stop')
			.attr('r', (d) => stopRadius(d))
			.attr('cx', (d) => projection([d.lon, d.lat])?.[0] ?? -9999)
			.attr('cy', (d) => projection([d.lon, d.lat])?.[1] ?? -9999)
			.attr('fill', (d) => stopColor(d))
			.attr('stroke', '#555')
			.attr('stroke-width', 0.3)
			.style('cursor', 'pointer')
			.on('mouseenter', handleStopEnter)
			.on('mousemove', handleMouseMove)
			.on('mouseleave', handleOverlayLeave);

		zoomLayer.append('g').attr('class', 'dev-dots-layer');

		const zoom = d3
			.zoom()
			.scaleExtent([1, 28])
			.on('zoom', (event) => {
				zoomLayer.attr('transform', event.transform);
				const k = event.transform.k;
				const invK = 1 / k;
				stopG.selectAll('circle.mbta-stop')
					.attr('r', (d) => stopRadius(d) * invK)
					.attr('stroke-width', 0.3 * invK);
				zoomLayer.select('.dev-dots-layer').selectAll('circle.dev-dot')
					.attr('r', function () {
						const d = d3.select(this).datum();
						return (d?.rBase ?? 2.5) * invK;
					})
					.attr('stroke-width', function () {
						const d = d3.select(this).datum();
						return (d?.strokeWBase ?? 0.3) * invK;
					});
			});
		zoomBehaviorRef = zoom;

		svg.call(zoom).on('dblclick.zoom', null).style('touch-action', 'none');

		svg.append('g').attr('class', 'map-legend-group');
	}

	function updateChoropleth() {
		if (!containerEl || !svgRef) return;

		refreshMetrics();

		const rowByGj = new Map((nhgisRows ?? []).map((r) => [r.gisjoin, r]));
		const values = (nhgisRows ?? [])
			.map((r) => Number(r.census_hu_change))
			.filter(Number.isFinite);
		const maxAbs = Math.max(1, d3.max(values, (d) => Math.abs(d)) || 1);
		const color = d3
			.scaleLinear()
			.domain([-maxAbs, 0, maxAbs])
			.range([MBTA_RED, MBTA_MAP_NEUTRAL, MBTA_BLUE]);

		d3.select(containerEl)
			.selectAll('path.tract-poly')
			.transition()
			.duration(350)
			.attr('fill', (d) => {
				const id = d.properties?.gisjoin;
				const row = rowByGj.get(id);
				const v = row ? Number(row.census_hu_change) : NaN;
				const baseFill = Number.isFinite(v) ? color(v) : '#e7e0d5';
				return tintFill(baseFill, row);
			})
			.attr('stroke', (d) => {
				const id = d.properties?.gisjoin;
				const row = rowByGj.get(id);
				if (revealStage < 1) return 'rgba(60,64,67,0.18)';
				return devClassStroke(row);
			})
			.attr('stroke-width', (d) => {
				const id = d.properties?.gisjoin;
				const row = rowByGj.get(id);
				const dc = row?.devClass;
				if (revealStage < 1) return 0.45;
				if (!dc) return 0.5;
				return dc === 'minimal' ? 1.15 : 2.4;
			});

		const svg = svgRef;
		const legGroup = svg.select('.map-legend-group');
		legGroup.selectAll('*').remove();
		const mapRight = mapCanvasLeft + mapW;
		legGroup.attr('transform', `translate(${mapRight + 6},0)`);

		const y0 = 10;
		const legBarH = Math.max(120, mapH - y0 - 14);
		const barW = 10;
		const barRight = 58;
		const barLeft = barRight - barW;
		const fmtTick = (v) => {
			const n = Number(v);
			if (!Number.isFinite(n)) return '';
			const ax = Math.abs(n);
			if (ax >= 1000 || (ax > 0 && ax < 0.01)) return d3.format('.2~s')(n);
			return d3.format('.1f')(n);
		};

		const legendG = legGroup.append('g').attr('class', 'map-legend-inner');
		const gradId = `poc-choro-grad-${mapUid}`;
		svg.select('defs').selectAll(`#${gradId}`).remove();
		const grad = svg
			.select('defs')
			.append('linearGradient')
			.attr('id', gradId)
			.attr('x1', '0%')
			.attr('y1', '100%')
			.attr('x2', '0%')
			.attr('y2', '0%');

		const d0 = -maxAbs;
		const d1 = maxAbs;
		const nStops = 48;
		for (let i = 0; i <= nStops; i++) {
			const t = i / nStops;
			const v = d0 + t * (d1 - d0);
			grad.append('stop').attr('offset', `${t * 100}%`).attr('stop-color', color(v));
		}
		legendG
			.append('rect')
			.attr('x', barLeft)
			.attr('y', y0)
			.attr('width', barW)
			.attr('height', legBarH)
			.attr('rx', 2)
			.attr('fill', `url(#${gradId})`)
			.attr('stroke', 'var(--border)')
			.attr('stroke-width', 0.5);

		const yScale = d3.scaleLinear().domain([d0, d1]).range([y0 + legBarH, y0]);
		const choroAxisX = barLeft - 0.5;
		legendG
			.append('g')
			.attr('transform', `translate(${choroAxisX},0)`)
			.call(
				d3
					.axisLeft(yScale)
					.ticks(5)
					.tickFormat((v) => fmtTick(v))
					.tickSize(3)
			)
			.call((g) => g.selectAll('path,line').attr('stroke', 'var(--border)'))
			.call((g) => g.selectAll('text').attr('fill', 'var(--text-muted)').attr('font-size', '8px'));

		legendG
			.append('text')
			.attr('transform', `translate(4, ${y0 + legBarH * 0.5}) rotate(-90)`)
			.attr('text-anchor', 'middle')
			.attr('fill', 'var(--text-muted)')
			.attr('font-size', '7.5px')
			.attr('font-weight', 600)
			.text(`Net housing units (${periodDisplayLabel(panelState.timePeriod)})`);

		containerEl.__pocChoroMaxAbs = maxAbs;
		containerEl.__pocRowByGj = rowByGj;
		reorderTractLayerPaths();
	}

	function updateDevelopments() {
		if (!containerEl || !svgRef || !projectionRef) return;

		const svg = svgRef;
		const devLeg = svg.select('.map-dev-legend-group');
		devLeg.selectAll('*').remove();

		const devLayer = d3.select(containerEl).select('.dev-dots-layer');
		const t = d3.transition().duration(350);

		if (revealStage < 2) {
			devSizeLegendTicks = null;
			devLayer
				.selectAll('circle.dev-dot')
				.transition(t)
				.attr('opacity', 0)
				.style('pointer-events', 'none');
			return;
		}

		const { filteredDevs } = buildFilteredData(tractList, developments, panelState);
		const projection = projectionRef;

		const currentK = d3.zoomTransform(svgRef.node()).k;
		const invK = 1 / currentK;

		const transitM = transitDistanceMiToMetres(panelState.transitDistanceMi ?? 0.5);
		const huVals = filteredDevs.map((d) => Number(d.hu) || 0).filter((h) => h > 0);
		const huMin = huVals.length ? d3.min(huVals) : 1;
		const huMax = huVals.length ? d3.max(huVals) : 1;
		const lo = Math.max(1, huMin);
		const hi = Math.max(lo + 1e-6, huMax);
		const rScale = d3.scaleSqrt().domain([lo, hi]).range([1.4, 8]);

		devSizeLegendTicks = filteredDevs.length ? computeDevSizeLegendTicks(lo, hi, rScale) : [];

		const mfColor = d3.scaleSequential((t) => interpolateOrangeGreen(t)).domain([0, 1]).clamp(true);

		const glyphData = filteredDevs.map((d) => {
			const hu = Number(d.hu) || 0;
			const mf = developmentMultifamilyShare(d);
			const access =
				isDevelopmentTransitAccessible(d, transitM) && meetsTodMultifamilyFloor(d, panelState);
			const rBase = hu > 0 ? rScale(Math.max(lo, Math.min(hi, hu))) : rScale(lo);
			return {
				...d,
				mfShare: mf,
				rBase,
				strokeWBase: access ? 0.55 : 0.4,
				transitAccessible: access
			};
		});

		devLayer
			.selectAll('circle.dev-dot')
			.data(glyphData, (d, i) => `${d.gisjoin}-${d.lat}-${d.lon}-${i}`)
			.join(
				(enter) =>
					enter
						.append('circle')
						.attr('class', 'dev-dot')
						.attr('cx', (d) => projection([d.lon, d.lat])?.[0] ?? -9999)
						.attr('cy', (d) => projection([d.lon, d.lat])?.[1] ?? -9999)
						.attr('r', (d) => d.rBase * invK)
						.attr('fill', (d) =>
							d.mfShare == null || !Number.isFinite(d.mfShare) ? '#475569' : mfColor(d.mfShare)
						)
						.attr('fill-opacity', 0.78)
						.attr('stroke', (d) => (d.transitAccessible ? '#ffffff' : 'rgba(15, 23, 42, 0.55)'))
						.attr('stroke-width', (d) => d.strokeWBase * invK)
						.attr('opacity', 0)
						.style('cursor', 'pointer')
						.style('pointer-events', 'none')
						.call((sel) =>
							sel
								.on('mouseenter', handleDevEnter)
								.on('mousemove', handleMouseMove)
								.on('mouseleave', handleOverlayLeave)
						),
				(update) => update,
				(exit) => exit.transition(t).attr('opacity', 0).remove()
			)
			.transition(t)
			.attr('cx', (d) => projection([d.lon, d.lat])?.[0] ?? -9999)
			.attr('cy', (d) => projection([d.lon, d.lat])?.[1] ?? -9999)
			.attr('r', (d) => d.rBase * invK)
			.attr('fill', (d) =>
				d.mfShare == null || !Number.isFinite(d.mfShare) ? '#475569' : mfColor(d.mfShare)
			)
			.attr('fill-opacity', 0.78)
			.attr('stroke', (d) => (d.transitAccessible ? '#ffffff' : 'rgba(15, 23, 42, 0.55)'))
			.attr('stroke-width', (d) => d.strokeWBase * invK)
			.attr('opacity', 1)
			.selection()
			.style('pointer-events', 'auto');
	}

	function updateOverlays() {
		if (!containerEl || !svgRef) return;

		const lineVis = {
			rail: panelState.showRailLines,
			commuter_rail: panelState.showCommuterRailLines,
			bus: panelState.showBusLines
		};
		const stopVis = {
			rail: panelState.showRailStops,
			commuter_rail: panelState.showCommuterRailStops,
			bus: panelState.showBusStops
		};

		d3.select(containerEl).selectAll('path.mbta-line')
			.attr('display', (d) => {
				const mode = lineMode(d.properties?.route_type);
				return lineVis[mode] ? null : 'none';
			});

		d3.select(containerEl).selectAll('circle.mbta-stop')
			.attr('display', (d) => {
				const modes = d.modes ?? [];
				const visible = modes.some((m) => stopVis[m]);
				return visible ? null : 'none';
			});
	}

	function updateSelection() {
		if (!containerEl) return;
		const hoveredId = panelState.hoveredTract;
		const selectedSet = panelState.selectedTracts;
		const rowByGj = containerEl.__pocRowByGj;
		d3.select(containerEl)
			.selectAll('path.tract-poly')
			.attr('stroke', (d) => {
				const id = d.properties?.gisjoin;
				if (id === hoveredId) return '#ffffff';
				if (selectedSet.has(id)) return 'var(--cat-a, #6366f1)';
				const row = rowByGj?.get(id);
				if (revealStage < 1) return 'rgba(60,64,67,0.18)';
				return devClassStroke(row);
			})
			.attr('stroke-width', (d) => {
				const id = d.properties?.gisjoin;
				const row = rowByGj?.get(id);
				const dc = row?.devClass;
				if (id === hoveredId) return dc === 'minimal' ? 2 : 3.6;
				if (selectedSet.has(id)) return dc === 'minimal' ? 1.7 : 3;
				if (revealStage < 1) return 0.45;
				if (!dc) return 0.5;
				return dc === 'minimal' ? 1.15 : 2.4;
			});
	}

	function handleTractEnter(event, d) {
		const id = d.properties?.gisjoin;
		panelState.setHovered(id);
		const el = containerEl;
		if (!el) return;
		const rowByGj = el.__pocRowByGj;
		const row = rowByGj?.get(id);
		const fmt = d3.format('.2f');
		const fmt1 = d3.format('.1f');
		const fmtInt = d3.format(',.0f');
		const tractLookup = buildTractLookup();
		const t = tractLookup.get(id);
		const county = t?.county;
		const tractPlace = county && String(county) !== 'County Name' ? String(county) : String(id);

		const huNet = row ? Number(row.census_hu_change) : NaN;
		const pl = periodDisplayLabel(panelState.timePeriod);

		const tier =
			row?.devClass === 'tod_dominated'
				? 'TOD-dominated tract'
				: row?.devClass === 'nontod_dominated'
					? 'Non-TOD-dominated (significant dev)'
					: row?.devClass === 'minimal'
						? 'Minimal development'
						: 'Unclassified';
		const badgeTone =
			row?.devClass === 'tod_dominated'
				? 'tod'
				: row?.devClass === 'nontod_dominated'
					? 'nontod'
					: row?.devClass === 'minimal'
						? 'minimal'
						: 'neutral';
		const primaryRows = [
			{
				label: `Census net housing units (${pl})`,
				value: Number.isFinite(huNet) ? fmtInt(huNet) : '—'
			}
		];
		const secondaryRows = [];

		if (t) {
			const tp = panelState.timePeriod;
			const { startY, endY } = periodCensusBounds(tp);

			const pop = t[`pop_${endY}`] ?? t.pop_2020;
			if (pop != null) secondaryRows.push({ label: `Population (${endY})`, value: fmtInt(pop) });

			const huS = t[`total_hu_${startY}`];
			const huE = t[`total_hu_${endY}`];
			if (huS != null) secondaryRows.push({ label: `Housing units (${startY})`, value: fmtInt(huS) });
			if (huE != null) secondaryRows.push({ label: `Housing units (${endY})`, value: fmtInt(huE) });
			if (huS != null && huE != null) {
				const diff = huE - huS;
				const sign = diff >= 0 ? '+' : '';
				secondaryRows.push({ label: 'Net HU change (census)', value: `${sign}${fmtInt(diff)}` });
			}

			const m = tractTodMetricsMap?.get(id);
			if (m && Number.isFinite(m.totalNewUnits) && m.totalNewUnits > 0) {
				primaryRows.push({
					label: 'New units (MassBuilds)',
					value: fmtInt(m.totalNewUnits)
				});
			}
			if (m?.todFraction != null && Number.isFinite(m.todFraction)) {
				primaryRows.push({ label: 'TOD share of new dev units', value: `${fmt1(m.todFraction * 100)}%` });
			}
			if (m?.pctStockIncrease != null && Number.isFinite(m.pctStockIncrease)) {
				primaryRows.push({ label: 'Stock increase', value: `${fmt1(m.pctStockIncrease)}%` });
			}

			const agg = devAggMap?.get(id);
			if (agg?.new_units) {
				secondaryRows.push({ label: 'Filtered new units (sum)', value: fmtInt(agg.new_units) });
			}

			const stopsRaw = Number(t.transit_stops) || 0;
			secondaryRows.push({ label: 'MBTA stops (tract + buffer)', value: String(stopsRaw) });

			const medInc = t[`median_income_change_pct_${tp}`];
			if (medInc != null && Number.isFinite(medInc)) {
				primaryRows.push({ label: `Median income change (${periodDisplayLabel(tp)})`, value: `${fmt1(medInc)}%` });
			}
		} else {
			secondaryRows.push({ label: 'Tract data', value: 'No tract attributes loaded' });
		}

		tooltip = {
			visible: true,
			x: event.clientX,
			y: event.clientY,
			eyebrow: 'Census tract',
			title: county && String(county) !== 'County Name' ? `Tract in ${tractPlace}` : `Tract: ${tractPlace}`,
			badge: tier,
			badgeTone,
			primaryRows,
			secondaryRows
		};
	}

	function handleMouseMove(event) {
		tooltip = { ...tooltip, x: event.clientX, y: event.clientY };
	}

	function handleTractLeave() {
		panelState.setHovered(null);
		tooltip = { ...tooltip, visible: false };
	}

	function handleTractClick(event, d) {
		event.stopPropagation();
		const id = d.properties?.gisjoin;
		if (id) panelState.toggleTract(id);
	}

	function handleStopEnter(event, d) {
		const routes = d.routes?.join(', ') || 'Unknown';
		const modes = (d.modes ?? []).map((m) => transitModeUiLabel(m)).join(', ') || 'Unknown';
		tooltip = {
			visible: true,
			x: event.clientX,
			y: event.clientY,
			eyebrow: 'Transit stop',
			title: d.name || 'MBTA Stop',
			badge: 'Transit stop',
			badgeTone: 'neutral',
			primaryRows: [
				{ label: 'Routes', value: routes },
				{ label: 'Mode', value: modes }
			],
			secondaryRows: []
		};
	}

	function handleLineEnter(event, d) {
		const props = d.properties ?? {};
		const name = props.route_long_name || props.route_short_name || props.route_id || 'MBTA Route';
		tooltip = {
			visible: true,
			x: event.clientX,
			y: event.clientY,
			eyebrow: 'Transit line',
			title: name,
			badge: 'MBTA line',
			badgeTone: 'neutral',
			primaryRows: [
				{ label: 'Route', value: props.route_short_name || props.route_id || '—' }
			],
			secondaryRows: []
		};
	}

	function handleDevEnter(event, d) {
		const fmtPct = d3.format('.1f');
		const primaryRows = [
			{ label: 'Municipality', value: d.municipal || '—' },
			{ label: 'Units', value: String(d.hu ?? '—') }
		];
		const secondaryRows = [];
		const mf = developmentMultifamilyShare(d);
		if (mf != null && Number.isFinite(mf)) {
			primaryRows.push({ label: 'Multifamily share', value: `${fmtPct(mf * 100)}%` });
		}
		const transitM = transitDistanceMiToMetres(panelState.transitDistanceMi ?? 0.5);
		const todMi = panelState.transitDistanceMi ?? 0.5;
		const prox = developmentMbtaProximity(d, mbtaStops, transitM);
		const access =
			isDevelopmentTransitAccessible(d, transitM) && meetsTodMultifamilyFloor(d, panelState);
		const nearestM = prox.nearestDistM;
		const nWithin = prox.stopsWithinRadius;
		if (nearestM != null && Number.isFinite(nearestM)) {
			secondaryRows.push({
				label: 'Nearest stop',
				value: `${nearestM.toFixed(0)} m${access ? ' (within TOD radius)' : ''}`
			});
		} else {
			secondaryRows.push({ label: 'Nearest stop', value: '—' });
		}
		secondaryRows.push({ label: `Stops within ${todMi} mi`, value: String(nWithin) });
		const affCap = developmentAffordableUnitsCapped(d);
		if (affCap > 0) {
			const src = d.affrd_source === 'lihtc' ? ' (HUD LIHTC)' : '';
			primaryRows.push({ label: 'Affordable units', value: `${affCap}${src}` });
		}
		secondaryRows.push({ label: 'Type', value: d.mixed_use ? 'Mixed-use' : 'Residential' });
		if (d.rdv) secondaryRows.push({ label: 'Redevelopment', value: 'Yes' });
		tooltip = {
			visible: true,
			x: event.clientX,
			y: event.clientY,
			eyebrow: 'MassBuilds project',
			title: `Development: ${d.name || 'Unnamed project'}`,
			badge: access ? 'Transit-accessible' : 'Not transit-accessible',
			badgeTone: access ? 'tod' : 'minimal',
			primaryRows,
			secondaryRows
		};
	}

	function handleOverlayLeave() {
		panelState.setHovered(null);
		tooltip = { ...tooltip, visible: false };
	}

	const overlayKey = $derived(
		JSON.stringify({
			busL: panelState.showBusLines,
			railL: panelState.showRailLines,
			crL: panelState.showCommuterRailLines,
			busS: panelState.showBusStops,
			railS: panelState.showRailStops,
			crS: panelState.showCommuterRailStops
		})
	);

	$effect(() => {
		void structuralKey;
		void containerEl;
		if (!containerEl) return;
		if (structuralKey !== lastStructuralKey) {
			lastStructuralKey = structuralKey;
			rebuildSVG();
			updateChoropleth();
			updateDevelopments();
			updateOverlays();
			updateSelection();
		}
	});

	$effect(() => {
		void dataKey;
		void revealStage;
		if (!containerEl || !svgRef) return;
		updateChoropleth();
		updateDevelopments();
		updateSelection();
	});

	$effect(() => {
		void overlayKey;
		if (!containerEl || !svgRef) return;
		updateOverlays();
	});

	$effect(() => {
		void panelState.hoveredTract;
		void panelState.selectedTracts;
		void panelState.selectedTracts.size;
		if (!containerEl || !svgRef) return;
		updateSelection();
	});

	$effect(() => {
		if (stepEls.filter(Boolean).length !== stepContent.length) return;
		const observer = new IntersectionObserver(
			(entries) => {
				const visible = entries
					.filter((entry) => entry.isIntersecting)
					.sort((a, b) => b.intersectionRatio - a.intersectionRatio);
				if (!visible.length) return;
				const next = Number(visible[0].target.getAttribute('data-step-index'));
				if (Number.isFinite(next)) revealStage = next;
			},
			{
				root: null,
				threshold: [0.35, 0.6, 0.85],
				rootMargin: '-10% 0px -30% 0px'
			}
		);
		for (const el of stepEls) {
			if (el) observer.observe(el);
		}
		return () => observer.disconnect();
	});

	onDestroy(() => {
		if (containerEl) d3.select(containerEl).selectAll('*').remove();
		lastStructuralKey = '';
		svgRef = null;
		projectionRef = null;
	});
</script>

<div class="poc-nhgis-map">
	<div class="poc-scrolly">
		<div class="poc-scrolly-map">
			<div class="poc-legend-row">
				<fieldset class="poc-transit-field">
					<legend class="poc-transit-legend">MBTA Overlays</legend>
					<div class="poc-transit-compact" role="group" aria-label="Transit overlays">
						<div class="poc-t-row">
							<span class="poc-t-h"></span>
							<span class="poc-t-h">Lines</span>
							<span class="poc-t-h">Stops</span>
						</div>
						<div class="poc-t-row">
							<span class="poc-t-l">Bus</span>
							<label class="poc-t-cell"><input type="checkbox" bind:checked={panelState.showBusLines} /></label>
							<label class="poc-t-cell"><input type="checkbox" bind:checked={panelState.showBusStops} /></label>
						</div>
						<div class="poc-t-row">
							<span class="poc-t-l">Rapid Transit</span>
							<label class="poc-t-cell"><input type="checkbox" bind:checked={panelState.showRailLines} /></label>
							<label class="poc-t-cell"><input type="checkbox" bind:checked={panelState.showRailStops} /></label>
						</div>
						<div class="poc-t-row">
							<span class="poc-t-l">Commuter Rail</span>
							<label class="poc-t-cell"><input type="checkbox" bind:checked={panelState.showCommuterRailLines} /></label>
							<label class="poc-t-cell"><input type="checkbox" bind:checked={panelState.showCommuterRailStops} /></label>
						</div>
					</div>
				</fieldset>

				<div class="poc-map-key card-key" role="region" aria-label="Map legend">
					<div
						class="poc-map-key-compact"
						class:poc-map-key-compact--split={revealStage >= 2}
					>
						<div class="poc-map-key-col poc-map-key-col--tract">
							<p class="poc-key-one poc-key-tract-fill">
								<strong>Tract fill</strong>
								<span class="poc-key-tract-fill-body">
									<span class="poc-key-tract-fill-line">
										Census net housing change ({periodDisplayLabel(panelState.timePeriod)}). Full scale on map colorbar.
									</span>
									<span
										class="poc-key-tract-bar"
										style="background: linear-gradient(to right, {MBTA_RED}, {MBTA_MAP_NEUTRAL}, {MBTA_BLUE});"
										role="img"
										aria-label="Housing change scale: more negative toward red, more positive toward blue"
									></span>
								</span>
							</p>
							<p class="poc-key-no-data">
								<span
									class="poc-key-fill-swatch poc-key-fill-swatch--no-data"
									style="background: #e7e0d5;"
									role="img"
									aria-hidden="true"
								></span>
								<span class="poc-key-no-data-text">Tan fill: excluded due to limited data (missing or unreliable % change).</span>
							</p>
							{#if revealStage >= 1}
								<ul class="poc-key-rings">
									<li><span class="poc-k-ring poc-k-ring--tod"></span> TOD-dominated (significant development)</li>
									<li><span class="poc-k-ring poc-k-ring--nontod"></span> Non-TOD-dominated (significant development)</li>
									<li><span class="poc-k-ring poc-k-ring--min"></span> Minimal development</li>
								</ul>
							{/if}
						</div>
						{#if revealStage >= 2}
							<div class="poc-map-key-col poc-map-key-col--dev">
								<p class="poc-key-one poc-key-dev">
									<strong>Developments</strong>
									<span class="poc-key-tract-fill-body">
										<span class="poc-key-tract-fill-line">
											Fill = share of new units that are multi-family. Full scale on map colorbar.
										</span>
										<span
											class="poc-key-tract-bar"
											style="background: linear-gradient(to right, {MBTA_ORANGE}, {MBTA_GREEN});"
											role="img"
											aria-label="Share of new units that are multi-family: lower toward orange, higher toward green"
										></span>
									</span>
								</p>
								{#if devSizeLegendTicks && devSizeLegendTicks.length > 0}
									<div class="poc-key-dev-sizes" aria-label="Development dot size by unit count">
										<p class="poc-key-dev-sizes-title">Units (radius ∝ √units, same as map)</p>
										<ul class="poc-key-dev-sizes-list">
											{#each devSizeLegendTicks as t, i (i)}
												<li class="poc-key-dev-size-item">
													<span class="poc-key-dev-size-dot-wrap">
														<span
															class="poc-key-dev-size-dot"
															style:width="{2 * t.rPx}px"
															style:height="{2 * t.rPx}px"
														></span>
													</span>
													<span class="poc-key-dev-size-num">{formatDevUnitsLegend(t.units)}</span>
												</li>
											{/each}
										</ul>
									</div>
								{/if}
								<ul class="poc-key-rings" aria-label="Development dot outlines">
									<li>
										<span class="poc-k-ring poc-k-ring--dev-access"></span> Transit-accessible
									</li>
									<li>
										<span class="poc-k-ring poc-k-ring--dev-noaccess"></span> Not transit-accessible
									</li>
								</ul>
							</div>
						{/if}
					</div>
				</div>
			</div>

			<div class="map-wrap">
				<div class="map-main" onmouseleave={handleOverlayLeave}>
					<div class="poc-stage-chip">Map step {revealStage + 1} of 3</div>
					<button class="poc-map-reset" type="button" onclick={recenterMap}>Recenter map</button>
					<div class="map-root" bind:this={containerEl}></div>
					{#if tooltip.visible}
						<div
							class="map-tooltip"
							style:left="{tooltip.x + 12}px"
							style:top="{tooltip.y + 12}px"
						>
							<div class="map-tooltip__header">
								<div class="map-tooltip__header-copy">
									{#if tooltip.eyebrow}
										<p class="map-tooltip__eyebrow">{tooltip.eyebrow}</p>
									{/if}
									<p class="map-tooltip__title">{tooltip.title}</p>
								</div>
								{#if tooltip.badge}
									<span class="map-tooltip__badge map-tooltip__badge--{tooltip.badgeTone}">{tooltip.badge}</span>
								{/if}
							</div>
							{#if tooltip.primaryRows.length > 0}
								<div
									class="map-tooltip__primary"
									class:map-tooltip__primary--tod={tooltip.badgeTone === 'tod'}
									class:map-tooltip__primary--nontod={tooltip.badgeTone === 'nontod'}
									class:map-tooltip__primary--minimal={tooltip.badgeTone === 'minimal'}
								>
									{#each tooltip.primaryRows as row, i (i)}
										<div class="map-tooltip__primary-row">
											<span class="map-tooltip__primary-label">{row.label}</span>
											<span class="map-tooltip__primary-value">{row.value}</span>
										</div>
									{/each}
								</div>
							{/if}
							{#if tooltip.secondaryRows.length > 0}
								<div class="map-tooltip__details">
									<p class="map-tooltip__details-label">Details</p>
									<div class="map-tooltip__rows">
										{#each tooltip.secondaryRows as row, i (i)}
											<div class="map-tooltip__row">
												<span class="map-tooltip__label">{row.label}</span>
												<span class="map-tooltip__value">{row.value}</span>
											</div>
										{/each}
									</div>
								</div>
							{/if}
						</div>
					{/if}
				</div>

				<aside class="poc-stepper-side" aria-label="Map explanation steps">
					<div class="poc-stepper-head">
						<p class="poc-stepper-inline-kicker">Map walkthrough</p>
						<p class="poc-stepper-inline-hint">Scroll down the page and the map will progressively add layers.</p>
					</div>
					<div class="poc-stepper-inline-rail" aria-label="Map steps">
						{#each stepContent as step, i}
							<section
								use:stepRef={i}
								class="poc-stepper-card"
								class:poc-stepper-card--active={revealStage === i}
								data-step-index={i}
							>
								<div class="poc-stepper-card-top">
									<span class="poc-stepper-pill-num">{i + 1}</span>
									<div class="poc-stepper-pill-text">
										<span class="poc-stepper-pill-kicker">{step.kicker}</span>
										<span class="poc-stepper-pill-title">{step.title}</span>
									</div>
								</div>
								<p class="poc-stepper-card-body">{step.body}</p>
							</section>
						{/each}
					</div>
				</aside>
			</div>
			<p class="poc-map-zoom-hint">Scroll through the narrative steps · drag to pan · scroll or pinch to zoom</p>
		</div>
	</div>
</div>

<style>
	.poc-nhgis-map {
		display: flex;
		flex-direction: column;
		gap: 6px;
		min-width: 0;
	}

	.poc-scrolly {
		display: block;
	}

	.poc-scrolly-map {
		display: flex;
		flex-direction: column;
		gap: 6px;
		min-height: 0;
	}

	.poc-stage-chip {
		align-self: flex-start;
		padding: 5px 9px;
		border-radius: 999px;
		background: color-mix(in srgb, var(--accent) 10%, var(--bg-card));
		border: 1px solid color-mix(in srgb, var(--accent) 22%, var(--border));
		font-size: 0.72rem;
		font-weight: 700;
		letter-spacing: 0.03em;
		color: var(--text);
	}

	.poc-stepper-side {
		display: grid;
		gap: 14px;
		align-content: start;
		padding-top: 12px;
	}

	.poc-stepper-head {
		position: sticky;
		top: 16px;
		display: grid;
		gap: 4px;
		padding: 12px 14px;
		border: 1px solid color-mix(in srgb, var(--accent) 18%, var(--border));
		border-radius: var(--radius-sm);
		background: color-mix(in srgb, var(--bg-card) 96%, white);
	}

	.poc-stepper-inline-kicker,
	.poc-stepper-inline-body-kicker {
		margin: 0;
		font-size: 0.68rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--accent);
	}

	.poc-stepper-inline-hint,
	.poc-stepper-inline-body-copy {
		margin: 0;
		font-size: 0.76rem;
		line-height: 1.4;
		color: var(--text-muted);
	}

	.poc-stepper-inline-rail {
		display: grid;
		gap: 16vh;
	}

	.poc-stepper-card {
		display: grid;
		align-content: center;
		gap: 12px;
		width: 100%;
		min-height: 58vh;
		padding: 10px 0 0;
		border-left: 2px solid color-mix(in srgb, var(--accent) 16%, var(--border));
		padding-left: 18px;
		border-radius: var(--radius-sm);
		border: 0;
		background: transparent;
		text-align: left;
		color: var(--text);
		opacity: 0.48;
		transform: translateY(14px);
		transition:
			opacity 220ms ease,
			transform 220ms ease,
			border-color 220ms ease;
	}

	.poc-stepper-card--active {
		border-left-color: color-mix(in srgb, var(--accent) 52%, var(--border));
		opacity: 1;
		transform: translateY(0);
	}

	.poc-stepper-card-top {
		display: grid;
		grid-template-columns: 28px minmax(0, 1fr);
		gap: 10px;
		align-items: center;
	}

	.poc-stepper-pill-num {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		border-radius: 999px;
		border: 1px solid var(--border);
		font-size: 0.82rem;
		font-weight: 700;
		color: var(--text);
	}

	.poc-stepper-card--active .poc-stepper-pill-num {
		border-color: var(--accent);
		background: color-mix(in srgb, var(--accent) 15%, var(--bg-card));
	}

	.poc-stepper-pill-text {
		display: grid;
		min-width: 0;
	}

	.poc-stepper-pill-title {
		font-size: 0.82rem;
		font-weight: 600;
		line-height: 1.25;
		color: var(--text);
	}

	.poc-stepper-pill-kicker {
		font-size: 0.65rem;
		line-height: 1.25;
		color: var(--text-muted);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.poc-stepper-card-body {
		margin: 0;
		max-width: 32ch;
		font-size: 0.9rem;
		line-height: 1.6;
		color: var(--text-muted);
	}

	/* Transit toggles ~1/4 width; text legend ~3/4 on wide viewports */
	.poc-legend-row {
		display: flex;
		flex-direction: column;
		gap: 6px;
		align-items: stretch;
		min-width: 0;
	}

	@media (min-width: 640px) {
		.poc-legend-row {
			flex-direction: row;
			align-items: flex-start;
		}

		/* Transit block was capped at 25% width, which crushed the label column; size to content instead. */
		.poc-transit-field {
			flex: 0 0 auto;
			max-width: none;
			min-width: min-content;
		}

		.poc-map-key {
			flex: 1 1 0;
			min-width: 0;
		}
	}

	@media (max-width: 900px) {
		.map-wrap {
			grid-template-columns: 1fr;
		}

		.map-main {
			position: relative;
			top: auto;
		}

		.poc-map-reset {
			top: 8px;
			right: 8px;
		}

		.poc-stepper-head {
			position: relative;
			top: auto;
		}

		.poc-stepper-inline-rail {
			gap: 18px;
		}

		.poc-stepper-card {
			min-height: 0;
			padding-top: 0;
		}
	}

	.poc-transit-field {
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		background: var(--bg-card);
		padding: 2px 5px 4px;
		margin: 0;
	}

	.poc-transit-legend {
		padding: 0 2px;
		font-size: 0.58rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-muted);
	}

	.poc-transit-compact {
		display: block;
		width: max-content;
		max-width: 100%;
		min-width: 0;
	}

	/* auto label column + fixed narrow checkbox columns keeps rows on one line with less dead space */
	.poc-t-row {
		display: grid;
		grid-template-columns: auto 1.575rem 1.575rem;
		column-gap: 0.525rem;
		row-gap: 2px;
		align-items: center;
		font-size: 0.6rem;
		line-height: 1.2;
		color: var(--text-muted);
	}

	.poc-t-h {
		text-align: center;
		font-weight: 700;
		font-size: 0.52rem;
		text-transform: uppercase;
		letter-spacing: 0.02em;
		color: var(--text-muted);
	}

	.poc-t-l {
		font-weight: 500;
		color: var(--text);
		padding-right: 0.15rem;
		white-space: nowrap;
	}

	.poc-t-cell {
		display: flex;
		justify-content: center;
		align-items: center;
		cursor: pointer;
		min-height: 23px;
		margin: 0;
		padding: 0;
	}

	.poc-t-cell input {
		accent-color: var(--accent);
		margin: 0;
	}

	.card-key {
		border: 1px solid color-mix(in srgb, var(--accent) 22%, var(--border));
		background: color-mix(in srgb, var(--accent) 5%, var(--bg-card));
		border-radius: var(--radius-sm);
		padding: 5px 8px;
	}

	.poc-map-key-compact {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 0.65rem;
		line-height: 1.35;
		color: var(--text-muted);
	}

	/* Tract (left) vs developments (right) when MassBuilds overlay is on */
	.poc-map-key-compact--split {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
		gap: 8px 14px;
		align-items: start;
	}

	@media (max-width: 639px) {
		.poc-map-key-compact--split {
			grid-template-columns: 1fr;
		}

		.poc-map-key-col--dev {
			border-left: none;
			padding-left: 0;
			border-top: 1px dashed var(--border);
			padding-top: 8px;
		}
	}

	.poc-map-key-col {
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.poc-map-key-col--dev {
		border-left: 1px dashed var(--border);
		padding-left: 10px;
	}

	.poc-map-key-col--dev .poc-key-dev {
		padding-top: 0;
		border-top: none;
	}

	.poc-key-no-data {
		display: flex;
		align-items: flex-start;
		gap: 6px;
		margin: 0;
		font-size: 0.6rem;
		line-height: 1.35;
		color: var(--text-muted);
	}

	.poc-key-fill-swatch {
		display: inline-block;
		width: 14px;
		height: 14px;
		border-radius: 3px;
		border: 1px solid var(--border);
		flex-shrink: 0;
		margin-top: 0.1rem;
		box-sizing: border-box;
	}

	.poc-key-no-data-text {
		color: var(--text-muted);
	}

	.poc-key-one {
		margin: 0;
		display: flex;
		align-items: flex-start;
		gap: 4px;
	}

	.poc-key-tract-fill {
		flex-wrap: wrap;
		align-items: center;
	}

	.poc-key-tract-fill-body {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 4px;
		min-width: 0;
		flex: 1 1 12rem;
	}

	.poc-key-tract-fill-line {
		display: block;
	}

	.poc-key-tract-bar {
		display: block;
		width: 100%;
		max-width: 9rem;
		height: 5px;
		border-radius: 2px;
		border: 1px solid var(--border);
		flex-shrink: 0;
	}

	.poc-key-one strong {
		color: var(--text);
		font-weight: 600;
		flex-shrink: 0;
	}

	.poc-key-dev {
		padding-top: 2px;
		border-top: 1px dashed var(--border);
		flex-wrap: wrap;
		align-items: center;
	}

	.poc-key-dev-sizes {
		margin: 0;
		padding: 4px 0 0;
	}

	.poc-key-dev-sizes-title {
		margin: 0 0 5px;
		font-size: 0.58rem;
		font-weight: 600;
		color: var(--text-muted);
		line-height: 1.25;
	}

	.poc-key-dev-sizes-list {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		gap: 6px 14px;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.poc-key-dev-size-item {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 3px;
	}

	/* Match map max r (8); keeps small circles bottom-aligned with large ones. */
	.poc-key-dev-size-dot-wrap {
		display: flex;
		align-items: flex-end;
		justify-content: center;
		min-height: 18px;
		width: 100%;
	}

	.poc-key-dev-size-dot {
		display: block;
		border-radius: 999px;
		flex-shrink: 0;
		box-sizing: border-box;
		/* Neutral grey: size legend encodes area only; MF fill is the colorbar above. */
		background: #94a3b8;
		border: 1px solid rgba(15, 23, 42, 0.35);
	}

	.poc-key-dev-size-num {
		font-size: 0.58rem;
		font-variant-numeric: tabular-nums;
		color: var(--text);
		font-weight: 600;
	}

	.poc-key-rings {
		display: flex;
		flex-wrap: wrap;
		gap: 3px 10px;
		margin: 0;
		padding: 0;
		list-style: none;
		font-size: 0.62rem;
	}

	.poc-key-rings li {
		display: inline-flex;
		align-items: center;
		gap: 4px;
	}

	.poc-k-ring {
		display: inline-block;
		width: 14px;
		height: 14px;
		border-radius: 999px;
		flex-shrink: 0;
		border: 2px solid var(--border);
		background: color-mix(in srgb, var(--bg-card) 88%, transparent);
	}

	.poc-k-ring--tod {
		border-color: var(--accent, #0d9488);
	}
	.poc-k-ring--nontod {
		border-color: var(--warning, #ea580c);
	}
	.poc-k-ring--min {
		border-color: #94a3b8;
	}

	/* Dev outline swatches: grey fill so stroke semantics stay visible (map dots stay orange–green by MF). */
	.poc-k-ring--dev-access,
	.poc-k-ring--dev-noaccess {
		background: #94a3b8;
	}

	.poc-k-ring--dev-access {
		border-color: #ffffff;
		box-shadow: 0 0 0 1px rgba(15, 23, 42, 0.38);
	}

	.poc-k-ring--dev-noaccess {
		border-color: rgba(15, 23, 42, 0.55);
	}

	.map-wrap {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(260px, 320px);
		gap: 28px;
		width: 100%;
		background: transparent;
		align-items: stretch;
	}

	.map-main {
		position: sticky;
		top: 18px;
		min-width: 0;
		align-self: start;
	}

	.poc-map-reset {
		position: absolute;
		top: 10px;
		right: 10px;
		z-index: 6;
		padding: 0.42rem 0.7rem;
		border: 1px solid color-mix(in srgb, var(--border) 88%, white 12%);
		border-radius: 999px;
		background: color-mix(in srgb, var(--bg-card) 92%, white 8%);
		color: var(--text);
		font-size: 0.78rem;
		font-weight: 700;
		line-height: 1;
		box-shadow: 0 4px 12px rgba(15, 23, 42, 0.08);
		backdrop-filter: blur(6px);
	}

	.poc-map-reset:hover {
		background: color-mix(in srgb, var(--bg-card) 82%, white 18%);
	}

	.poc-map-reset:focus-visible {
		outline: 2px solid color-mix(in srgb, var(--accent) 60%, white 40%);
		outline-offset: 2px;
	}

	.map-root {
		width: 100%;
		max-width: 100%;
		min-height: 300px;
	}

	.map-tooltip {
		position: fixed;
		z-index: 20;
		max-width: 360px;
		padding: 12px 13px;
		font-size: 0.78rem;
		line-height: 1.4;
		color: var(--text);
		background: var(--bg-card);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		box-shadow: var(--shadow);
		pointer-events: none;
	}

	.map-tooltip__header {
		display: flex;
		justify-content: space-between;
		gap: 8px;
		align-items: flex-start;
		margin-bottom: 8px;
	}

	.map-tooltip__header-copy {
		display: grid;
		gap: 3px;
		min-width: 0;
	}

	.map-tooltip__eyebrow {
		margin: 0;
		font-size: 0.63rem;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--text-muted);
	}

	.map-tooltip__title {
		margin: 0;
		font-size: 0.92rem;
		font-weight: 700;
		line-height: 1.2;
		color: var(--text);
	}

	.map-tooltip__badge {
		display: inline-flex;
		align-items: center;
		padding: 3px 8px;
		border-radius: 999px;
		font-size: 0.68rem;
		font-weight: 700;
		letter-spacing: 0.03em;
		border: 1px solid var(--border);
		background: color-mix(in srgb, var(--bg-card) 85%, transparent);
	}

	.map-tooltip__badge--tod {
		border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
		background: color-mix(in srgb, var(--accent) 13%, var(--bg-card));
		color: var(--accent);
	}

	.map-tooltip__badge--nontod {
		border-color: color-mix(in srgb, var(--warning) 55%, var(--border));
		background: color-mix(in srgb, var(--warning) 13%, var(--bg-card));
		color: var(--warning);
	}

	.map-tooltip__badge--minimal {
		border-color: #94a3b8;
		background: color-mix(in srgb, #94a3b8 13%, var(--bg-card));
		color: #526074;
	}

	.map-tooltip__badge--neutral {
		color: var(--text-muted);
	}

	.map-tooltip__primary {
		display: grid;
		gap: 6px;
		padding: 8px 10px;
		margin-bottom: 8px;
		border-radius: 10px;
		background: color-mix(in srgb, var(--accent) 6%, var(--bg-card));
		border: 1px solid color-mix(in srgb, var(--accent) 16%, var(--border));
	}

	.map-tooltip__primary--tod {
		background: color-mix(in srgb, var(--accent) 9%, var(--bg-card));
		border-color: color-mix(in srgb, var(--accent) 30%, var(--border));
	}

	.map-tooltip__primary--nontod {
		background: color-mix(in srgb, var(--warning) 9%, var(--bg-card));
		border-color: color-mix(in srgb, var(--warning) 28%, var(--border));
	}

	.map-tooltip__primary--minimal {
		background: color-mix(in srgb, #94a3b8 10%, var(--bg-card));
		border-color: color-mix(in srgb, #94a3b8 28%, var(--border));
	}

	.map-tooltip__primary-row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 10px;
		align-items: baseline;
	}

	.map-tooltip__primary-label {
		font-size: 0.68rem;
		font-weight: 700;
		line-height: 1.3;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		color: var(--text-muted);
	}

	.map-tooltip__primary-value {
		font-size: 0.86rem;
		font-weight: 700;
		line-height: 1.25;
		text-align: right;
		color: var(--text);
	}

	.map-tooltip__details {
		display: grid;
		gap: 6px;
	}

	.map-tooltip__details-label {
		margin: 0;
		font-size: 0.63rem;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--text-muted);
	}

	.map-tooltip__rows {
		display: grid;
		gap: 6px;
	}

	.map-tooltip__row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 10px;
		align-items: start;
	}

	.map-tooltip__label {
		color: var(--text-muted);
		font-size: 0.73rem;
		line-height: 1.35;
	}

	.map-tooltip__value {
		color: var(--text);
		font-size: 0.76rem;
		font-weight: 600;
		line-height: 1.35;
		text-align: right;
	}

	.poc-map-zoom-hint {
		margin: 0;
		font-size: 0.7rem;
		color: var(--text-muted);
	}

	:global(.map-empty) {
		margin: 0;
		padding: 16px;
		font-size: 0.875rem;
		color: var(--text-muted);
	}
</style>
