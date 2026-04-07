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
	import { periodCensusBounds } from '$lib/utils/periods.js';
	import {
		MBTA_BLUE,
		MBTA_GREEN,
		MBTA_MAP_NEUTRAL,
		MBTA_ORANGE,
		MBTA_RED
	} from '$lib/utils/mbtaColors.js';

	/**
	 * Tract-dashboard–style map: census % housing change choropleth (2010–20), TOD-tier
	 * outlines, optional MassBuilds developments and MBTA overlays.
	 *
	 * Parameters
	 * ----------
	 * panelState : PanelState
	 *     Shared with ``FilterPanel`` / ``MapView`` (transit toggles, dev filters, zoom).
	 * tractList : Array<object>
	 *     Filtered census tract rows (same universe as ``nhgisRows``).
	 * nhgisRows : Array<object>
	 *     Rows from ``buildNhgisLikeRows`` including ``gisjoin``, ``devClass``, ``census_hu_change_10_20``.
	 * metricsDevelopments : Array<object> | null | undefined
	 *     Optional MassBuilds rows for TOD / stock tooltips — use the same window as ``buildTractDevClassMap``
	 *     (e.g. 1990–2026 on the main POC). When omitted, uses ``buildFilteredData`` (panel period only).
	 */
	let { panelState, tractList, nhgisRows, metricsDevelopments = null } = $props();

	let containerEl = $state(null);
	let tooltip = $state({ visible: false, x: 0, y: 0, lines: [] });

	/** Nice unit ticks + pixel radii for HTML dot-size legend (same sqrt scale as map dots). */
	let devSizeLegendTicks = $state(/** @type {{ units: number; rPx: number }[] | null} */ (null));

	/** Reserved width per map colorbar (ticks + bar + vertical title, inset from map). */
	const CHORO_LEGEND_COL_W = 70;
	const DEV_LEGEND_COL_W = 70;
	const mapUid = Math.random().toString(36).slice(2, 11);

	/** Lighter grey for minimal-development tract outline (half stroke vs TOD tiers); legend ring matches. */
	const MINIMAL_TRACT_STROKE = '#94a3b8';

	/**
	 * Z-order rank for tract polygons (later in DOM = drawn on top at shared edges).
	 * Excluded (tan / no reliable % change) → minimal → non-TOD → TOD.
	 *
	 * Parameters
	 * ----------
	 * row : object | undefined
	 *     Row with ``census_hu_change_10_20`` and optional ``devClass``.
	 *
	 * Returns
	 * -------
	 * number
	 *     Integer 0–3 (0 lowest).
	 */
	function tractTierRankFromRow(row) {
		if (!row) return 0;
		const v = Number(row.census_hu_change_10_20);
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

		const showDevs = panelState.showDevelopments;
		mapCanvasLeft = showDevs ? DEV_LEGEND_COL_W : 0;
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

		svg.call(zoom).on('dblclick.zoom', null).style('touch-action', 'none');

		svg.append('g').attr('class', 'map-legend-group');
	}

	function updateChoropleth() {
		if (!containerEl || !svgRef) return;

		refreshMetrics();

		const rowByGj = new Map((nhgisRows ?? []).map((r) => [r.gisjoin, r]));
		const values = (nhgisRows ?? [])
			.map((r) => Number(r.census_hu_change_10_20))
			.filter(Number.isFinite);
		const maxAbs = Math.max(1, d3.max(values, (d) => Math.abs(d)) || 1);
		const color = d3
			.scaleLinear()
			.domain([-maxAbs, 0, maxAbs])
			.range([MBTA_RED, MBTA_MAP_NEUTRAL, MBTA_BLUE]);

		d3.select(containerEl)
			.selectAll('path.tract-poly')
			.attr('fill', (d) => {
				const id = d.properties?.gisjoin;
				const row = rowByGj.get(id);
				const v = row ? Number(row.census_hu_change_10_20) : NaN;
				return Number.isFinite(v) ? color(v) : '#e7e0d5';
			})
			.attr('stroke', (d) => {
				const id = d.properties?.gisjoin;
				const row = rowByGj.get(id);
				const dc = row?.devClass;
				if (dc === 'tod_dominated') return 'var(--accent, #0d9488)';
				if (dc === 'nontod_dominated') return 'var(--warning, #ea580c)';
				if (dc === 'minimal') return MINIMAL_TRACT_STROKE;
				return 'rgba(60,64,67,0.22)';
			})
			.attr('stroke-width', (d) => {
				const id = d.properties?.gisjoin;
				const row = rowByGj.get(id);
				const dc = row?.devClass;
				if (!dc) return 0.5;
				return dc === 'minimal' ? 0.75 : 1.5;
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
					.tickFormat((v) => `${fmtTick(v)}%`)
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
			.text('Housing change (%, 2010–20)');

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
		devLayer.selectAll('*').remove();

		if (!panelState.showDevelopments) {
			devSizeLegendTicks = null;
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

		const y0mf = 10;
		const legBarHmf = Math.max(120, mapH - y0mf - 14);
		const legBarWmf = 10;
		const mfBarLeft = 0;
		const mfBarRight = mfBarLeft + legBarWmf;
		const gradMfId = `poc-dev-mf-grad-${mapUid}`;
		svg.select('defs').selectAll(`#${gradMfId}`).remove();
		const gradMf = svg.select('defs').append('linearGradient').attr('id', gradMfId)
			.attr('x1', '0%').attr('y1', '100%').attr('x2', '0%').attr('y2', '0%');
		for (let i = 0; i <= 48; i++) {
			const t = i / 48;
			gradMf.append('stop').attr('offset', `${t * 100}%`).attr('stop-color', interpolateOrangeGreen(t));
		}
		const mfLegG = devLeg.append('g').attr('class', 'map-dev-legend-inner').attr('transform', 'translate(6,0)');
		mfLegG
			.append('rect')
			.attr('x', mfBarLeft)
			.attr('y', y0mf)
			.attr('width', legBarWmf)
			.attr('height', legBarHmf)
			.attr('rx', 2)
			.attr('fill', `url(#${gradMfId})`)
			.attr('stroke', 'var(--border)')
			.attr('stroke-width', 0.5);
		const yMf = d3.scaleLinear().domain([0, 1]).range([y0mf + legBarHmf, y0mf]);
		mfLegG
			.append('g')
			.attr('transform', `translate(${mfBarRight + 5},0)`)
			.call(d3.axisRight(yMf).ticks(4).tickFormat(d3.format('.0%')).tickSize(3))
			.call((g) => g.selectAll('path,line').attr('stroke', 'var(--border)'))
			.call((g) =>
				g.selectAll('text').attr('fill', 'var(--text-muted)').attr('font-size', '8px')
			);
		mfLegG
			.append('text')
			.attr('transform', `translate(11.5, ${y0mf + legBarHmf * 0.5}) rotate(-90)`)
			.attr('text-anchor', 'middle')
			.attr('fill', 'var(--text-muted)')
			.attr('font-size', '7.5px')
			.attr('font-weight', 600)
			.text('MF share (dot fill)');

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
			.join('circle')
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
			.style('cursor', 'pointer')
			.on('mouseenter', handleDevEnter)
			.on('mousemove', handleMouseMove)
			.on('mouseleave', handleOverlayLeave);
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
				const dc = row?.devClass;
				if (dc === 'tod_dominated') return 'var(--accent, #0d9488)';
				if (dc === 'nontod_dominated') return 'var(--warning, #ea580c)';
				if (dc === 'minimal') return MINIMAL_TRACT_STROKE;
				return 'rgba(60,64,67,0.22)';
			})
			.attr('stroke-width', (d) => {
				const id = d.properties?.gisjoin;
				const row = rowByGj?.get(id);
				const dc = row?.devClass;
				if (id === hoveredId) return dc === 'minimal' ? 1.6 : 3.2;
				if (selectedSet.has(id)) return dc === 'minimal' ? 1.4 : 2.8;
				if (!dc) return 0.5;
				return dc === 'minimal' ? 0.75 : 1.5;
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
		const title = county && String(county) !== 'County Name' ? String(county) : String(id);

		const lines = [{ bold: true, text: title }];

		const huPct = row ? Number(row.census_hu_change_10_20) : NaN;
		lines.push({
			bold: false,
			text: `Census housing change (2010–20): ${Number.isFinite(huPct) ? `${fmt1(huPct)}%` : '—'}`
		});

		const tier =
			row?.devClass === 'tod_dominated'
				? 'TOD-dominated tract'
				: row?.devClass === 'nontod_dominated'
					? 'Non-TOD-dominated (significant dev)'
					: row?.devClass === 'minimal'
						? 'Minimal development'
						: 'Unclassified';
		lines.push({ bold: false, text: `Cohort (MassBuilds rules): ${tier}` });

		if (t) {
			const tp = panelState.timePeriod;
			const { startY, endY } = periodCensusBounds(tp);

			const pop = t[`pop_${endY}`] ?? t.pop_2020;
			if (pop != null) lines.push({ bold: false, text: `Population (${endY}): ${fmtInt(pop)}` });

			const huS = t[`total_hu_${startY}`];
			const huE = t[`total_hu_${endY}`];
			if (huS != null) lines.push({ bold: false, text: `Housing units (${startY}): ${fmtInt(huS)}` });
			if (huE != null) lines.push({ bold: false, text: `Housing units (${endY}): ${fmtInt(huE)}` });
			if (huS != null && huE != null) {
				const diff = huE - huS;
				const sign = diff >= 0 ? '+' : '';
				lines.push({ bold: false, text: `Net HU change (census): ${sign}${fmtInt(diff)}` });
			}

			const m = tractTodMetricsMap?.get(id);
			if (m && Number.isFinite(m.totalNewUnits) && m.totalNewUnits > 0) {
				lines.push({
					bold: false,
					text: `New units (MassBuilds, same window as cohort outlines): ${fmtInt(m.totalNewUnits)}`
				});
			}
			if (m?.todFraction != null && Number.isFinite(m.todFraction)) {
				lines.push({
					bold: false,
					text: `TOD share of new dev units: ${fmt1(m.todFraction * 100)}%`
				});
			}
			if (m?.pctStockIncrease != null && Number.isFinite(m.pctStockIncrease)) {
				lines.push({
					bold: false,
					text: `Stock increase (MassBuilds / base HU): ${fmt1(m.pctStockIncrease)}%`
				});
			}

			const agg = devAggMap?.get(id);
			if (agg?.new_units) {
				lines.push({
					bold: false,
					text: `Filtered new units (sum): ${fmtInt(agg.new_units)}`
				});
			}

			const stopsRaw = Number(t.transit_stops) || 0;
			lines.push({ bold: false, text: `MBTA stops (tract + buffer): ${stopsRaw}` });

			const medInc = t.median_income_change_pct_10_20;
			if (medInc != null && Number.isFinite(medInc)) {
				lines.push({ bold: false, text: `Median income change (2010–20): ${fmt1(medInc)}%` });
			}
		} else {
			lines.push({ bold: false, text: 'No tract attributes loaded for this polygon.' });
		}

		tooltip = { visible: true, x: event.clientX, y: event.clientY, lines };
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
			lines: [
				{ bold: true, text: d.name || 'MBTA Stop' },
				{ bold: false, text: `Routes: ${routes}` },
				{ bold: false, text: `Mode: ${modes}` }
			]
		};
	}

	function handleLineEnter(event, d) {
		const props = d.properties ?? {};
		const name = props.route_long_name || props.route_short_name || props.route_id || 'MBTA Route';
		tooltip = {
			visible: true,
			x: event.clientX,
			y: event.clientY,
			lines: [
				{ bold: true, text: name },
				{ bold: false, text: `Route: ${props.route_short_name || props.route_id || ''}` }
			]
		};
	}

	function handleDevEnter(event, d) {
		const fmtPct = d3.format('.1f');
		const lines = [{ bold: true, text: d.name || 'Development' }];
		lines.push({ bold: false, text: `${d.municipal}` });
		lines.push({ bold: false, text: `Units: ${d.hu}` });
		const mf = developmentMultifamilyShare(d);
		if (mf != null && Number.isFinite(mf)) {
			lines.push({ bold: false, text: `Multifamily (share): ${fmtPct(mf * 100)}%` });
		}
		const transitM = transitDistanceMiToMetres(panelState.transitDistanceMi ?? 0.5);
		const todMi = panelState.transitDistanceMi ?? 0.5;
		const prox = developmentMbtaProximity(d, mbtaStops, transitM);
		const access =
			isDevelopmentTransitAccessible(d, transitM) && meetsTodMultifamilyFloor(d, panelState);
		const nearestM = prox.nearestDistM;
		const nWithin = prox.stopsWithinRadius;
		if (nearestM != null && Number.isFinite(nearestM)) {
			lines.push({
				bold: false,
				text: `Nearest stop: ${nearestM.toFixed(0)} m${access ? ' (within TOD radius)' : ''}`
			});
		} else {
			lines.push({ bold: false, text: 'Nearest stop: —' });
		}
		lines.push({
			bold: false,
			text: `Stops within ${todMi} mi: ${nWithin}`
		});
		const affCap = developmentAffordableUnitsCapped(d);
		if (affCap > 0) {
			const src = d.affrd_source === 'lihtc' ? ' (HUD LIHTC)' : '';
			lines.push({ bold: false, text: `Affordable: ${affCap}${src}` });
		}
		lines.push({ bold: false, text: d.mixed_use ? 'Mixed-use' : 'Residential' });
		if (d.rdv) lines.push({ bold: false, text: 'Redevelopment' });
		tooltip = { visible: true, x: event.clientX, y: event.clientY, lines };
	}

	function handleOverlayLeave() {
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

	onDestroy(() => {
		if (containerEl) d3.select(containerEl).selectAll('*').remove();
		lastStructuralKey = '';
		svgRef = null;
		projectionRef = null;
	});
</script>

<div class="poc-nhgis-map">
	<label class="poc-dev-toggle">
		<input type="checkbox" bind:checked={panelState.showDevelopments} />
		<span>Show MassBuilds developments on map</span>
	</label>

	<div class="poc-legend-row">
		<fieldset class="poc-transit-field">
			<legend class="poc-transit-legend">MBTA</legend>
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
				class:poc-map-key-compact--split={panelState.showDevelopments}
			>
				<div class="poc-map-key-col poc-map-key-col--tract">
					<p class="poc-key-one poc-key-tract-fill">
						<strong>Tract fill</strong>
						<span class="poc-key-tract-fill-body">
							<span class="poc-key-tract-fill-line">
								Census housing change (%, 2010–20). Full scale on map colorbar.
							</span>
							<!-- Inline diverging strip matches tract choropleth (same anchors as map scale). -->
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
					<ul class="poc-key-rings">
						<li><span class="poc-k-ring poc-k-ring--tod"></span> TOD-dominated (significant development)</li>
						<li><span class="poc-k-ring poc-k-ring--nontod"></span> Non-TOD-dominated (significant development)</li>
						<li><span class="poc-k-ring poc-k-ring--min"></span> Minimal development</li>
					</ul>
				</div>
				{#if panelState.showDevelopments}
					<div class="poc-map-key-col poc-map-key-col--dev">
						<p class="poc-key-one poc-key-dev">
							<strong>Developments</strong>
							<span class="poc-key-tract-fill-body">
								<span class="poc-key-tract-fill-line">
									Fill = share of new units that are multi-family. Full scale on map colorbar.
								</span>
								<!-- Same ramp as dev dots / SVG MF legend (interpolateOrangeGreen). -->
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
		<div class="map-root" bind:this={containerEl}></div>
		{#if tooltip.visible}
			<div
				class="map-tooltip"
				style:left="{tooltip.x + 12}px"
				style:top="{tooltip.y + 12}px"
			>
				{#each tooltip.lines as line, i (i)}
					<p class:tooltip-bold={line.bold}>{line.text}</p>
				{/each}
			</div>
		{/if}
	</div>
	<p class="poc-map-zoom-hint">Scroll or pinch to zoom · drag to pan · click tracts to select (optional)</p>
</div>

<style>
	.poc-nhgis-map {
		display: flex;
		flex-direction: column;
		gap: 6px;
		min-width: 0;
	}

	.poc-dev-toggle {
		display: flex;
		align-items: center;
		gap: 8px;
		margin: 0;
		padding: 8px 10px;
		border-radius: var(--radius-sm);
		border: 2px solid color-mix(in srgb, var(--accent) 55%, var(--border));
		background: color-mix(in srgb, var(--accent) 12%, var(--bg-card));
		font-size: 0.8125rem;
		font-weight: 600;
		color: var(--text);
		cursor: pointer;
		user-select: none;
		line-height: 1.25;
	}

	.poc-dev-toggle input {
		width: 1.1rem;
		height: 1.1rem;
		accent-color: var(--accent);
		margin: 0;
		flex-shrink: 0;
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
		position: relative;
		width: 100%;
		background: transparent;
	}

	.map-root {
		width: 100%;
		max-width: 100%;
		min-height: 300px;
	}

	.map-tooltip {
		position: fixed;
		z-index: 20;
		max-width: 340px;
		padding: 10px 12px;
		font-size: 0.78rem;
		line-height: 1.4;
		color: var(--text);
		background: var(--bg-card);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		box-shadow: var(--shadow);
		pointer-events: none;
	}

	.map-tooltip p {
		margin: 0 0 4px;
	}

	.map-tooltip p:last-child {
		margin-bottom: 0;
	}

	:global(.tooltip-bold) {
		font-weight: 700;
		color: var(--text);
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
