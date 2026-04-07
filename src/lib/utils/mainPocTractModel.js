/**
 * Tract-level aggregates for the main-page POC (census tract mode), using the same
 * development-level TOD and affordable rules as ``/tract`` / ``PolicyInsights``.
 */

import {
	aggregateTractTodMetrics,
	classifyDevTodUnits,
	classifyTractDevelopment,
	developmentAffordableUnitsCapped,
	developmentAffordableShare,
	developmentMultifamilyShare,
	filterTractsByTract,
	transitDistanceMiToMetres
} from './derived.js';

/**
 * Default tract-universe panel matching ``createPanelState`` (tract dashboard).
 * Callers can relax e.g. ``minPopDensity`` to 0 to include more rural tracts.
 */
export const DEFAULT_MAIN_POC_UNIVERSE = {
	timePeriod: '10_20',
	minStops: 0,
	minPopulation: 0,
	minPopDensity: 200
};

/**
 * Default development filters aligned with ``createPanelState`` defaults.
 */
export const DEFAULT_MAIN_POC_DEV_OPTS = {
	minUnitsPerProject: 0,
	minDevMultifamilyRatioPct: 0,
	minDevAffordableRatioPct: 0,
	includeRedevelopment: true
};

/**
 * MassBuilds rows in a completion-year window, with tract-panel-style filters.
 *
 * Parameters
 * ----------
 * developments : Array<object>
 * yearStart : number
 * yearEnd : number
 * opts : {{ minUnitsPerProject?: number, minDevMultifamilyRatioPct?: number, minDevAffordableRatioPct?: number, includeRedevelopment?: boolean }}
 *
 * Returns
 * -------
 * Array<object>
 */
export function filterDevelopmentsByYearRange(developments, yearStart, yearEnd, opts = {}) {
	const minUnits = opts.minUnitsPerProject ?? 0;
	const minMf = Math.min(100, Math.max(0, Number(opts.minDevMultifamilyRatioPct) || 0)) / 100;
	const minAff = Math.min(100, Math.max(0, Number(opts.minDevAffordableRatioPct) || 0)) / 100;
	const includeR = opts.includeRedevelopment !== false;

	return developments.filter((d) => {
		const y = Number(d.completion_year);
		if (!Number.isFinite(y) || y < yearStart || y > yearEnd) return false;
		if ((Number(d.hu) || 0) < minUnits) return false;
		if (minMf > 0) {
			const mf = developmentMultifamilyShare(d);
			if (mf == null || mf < minMf) return false;
		}
		if (minAff > 0) {
			const aff = developmentAffordableShare(d);
			if (aff == null || aff < minAff) return false;
		}
		if (!includeR && d.rdv) return false;
		return true;
	});
}

/**
 * Short display label for a tract (county + tail of GEOID).
 *
 * Parameters
 * ----------
 * tract : {{ county?: string, geoid?: string, gisjoin?: string }}
 *
 * Returns
 * -------
 * string
 */
export function formatTractLabel(tract) {
	const c = tract.county ? tract.county.replace(/\s+County$/i, '') : '';
	const g = String(tract.geoid || '');
	const tail = g.length >= 6 ? g.slice(-6) : String(tract.gisjoin || '').slice(-6);
	return c ? `${c} · ${tail}` : tail || tract.gisjoin || '';
}

/**
 * Per-tract rolled-up metrics for the main POC (year window + TOD threshold in miles).
 *
 * Parameters
 * ----------
 * tractList : Array<object>
 *     Tracts that pass universe + county/search filters (may include zero-development tracts).
 * developments : Array<object>
 *     Filtered with ``filterDevelopmentsByYearRange`` for the same window.
 * thresholdMi : number
 *     Max distance to nearest stop (miles), same as panel ``transitDistanceMi``.
 * minDevMultifamilyRatioPct : number
 *     Same semantics as ``classifyDevTodUnits`` / panel ``minDevMultifamilyRatioPct`` (0–100).
 *
 * Returns
 * -------
 * Array<object>
 */
export function buildTractPocRows(tractList, developments, thresholdMi, minDevMultifamilyRatioPct = 0) {
	const transitM = transitDistanceMiToMetres(thresholdMi);
	const minMf = Math.min(1, Math.max(0, (Number(minDevMultifamilyRatioPct) || 0) / 100));

	const tractSet = new Set(tractList.map((t) => t.gisjoin).filter(Boolean));
	const byGj = new Map();
	for (const d of developments) {
		const gj = d.gisjoin;
		if (!gj || !tractSet.has(gj)) continue;
		if (!byGj.has(gj)) {
			byGj.set(gj, {
				gisjoin: gj,
				units: 0,
				affordableUnits: 0,
				todUnits: 0,
				nonTodUnits: 0
			});
		}
		const agg = byGj.get(gj);
		const hu = Number(d.hu) || 0;
		const { todUnits, nonTodUnits } = classifyDevTodUnits(d, transitM, minMf);
		const aff = developmentAffordableUnitsCapped(d);
		agg.units += hu;
		agg.affordableUnits += aff;
		agg.todUnits += todUnits;
		agg.nonTodUnits += nonTodUnits;
	}

	const rows = [];
	for (const t of tractList) {
		const gj = t.gisjoin;
		if (!gj) continue;
		const pr = Number(t.poverty_rate_2020);
		const vulnerabilityPct = Number.isFinite(pr) ? pr : NaN;
		const agg = byGj.get(gj);
		const units = agg ? agg.units : 0;
		const affordableUnits = agg ? agg.affordableUnits : 0;
		const todUnits = agg ? agg.todUnits : 0;
		const nonTodUnits = agg ? agg.nonTodUnits : 0;
		let dominant = 'none';
		if (units > 0) {
			dominant = todUnits >= nonTodUnits ? 'tod' : 'nonTod';
		}
		rows.push({
			gisjoin: gj,
			geoid: t.geoid,
			county: t.county || '',
			label: formatTractLabel(t),
			units,
			affordableUnits,
			affordableShare: units ? affordableUnits / units : 0,
			todUnits,
			todShare: units ? todUnits / units : 0,
			nonTodUnits,
			dominant,
			/** Poverty rate (%) ACS 2020 — tract analog to municipal “under $125k” exposure. */
			vulnerabilityPct,
			/** Display proxy where the municipal map used “$125k+” share. */
			highIncomeProxy: Number.isFinite(vulnerabilityPct) ? 100 - vulnerabilityPct : NaN,
			pop2020: Number(t.pop_2020) || 0,
			median_income_change_pct_10_20: t.median_income_change_pct_10_20,
			bachelors_pct_change_10_20: t.bachelors_pct_change_10_20,
			avg_travel_time_change_10_20: t.avg_travel_time_change_10_20,
			is_tod: !!t.is_tod
		});
	}
	return rows;
}

/**
 * Tracts in the relaxed universe, optionally filtered by county set and search string.
 *
 * Parameters
 * ----------
 * tractData : Array<object>
 * countiesAllowed : Set<string> | null
 *     If null/empty, all counties pass.
 * searchLower : string
 *     Matches ``gisjoin``, ``geoid``, ``label`` substring.
 * universePanel : {{ timePeriod: string, minStops?: number, minPopulation?: number, minPopDensity?: number }}
 *     Same shape as tract ``panelState`` for ``filterTractsByTract`` / ``passesTractUniverse``.
 *
 * Returns
 * -------
 * Array<object>
 */
export function filterTractsForMainPoc(tractData, countiesAllowed, searchLower, universePanel) {
	const panel = universePanel ?? DEFAULT_MAIN_POC_UNIVERSE;
	const base = filterTractsByTract(tractData, panel);
	let list = base;
	if (countiesAllowed && countiesAllowed.size > 0) {
		list = list.filter((t) => t.county && countiesAllowed.has(t.county));
	}
	if (searchLower) {
		list = list.filter((t) => {
			const gj = String(t.gisjoin || '').toLowerCase();
			const geo = String(t.geoid || '').toLowerCase();
			const lab = formatTractLabel(t).toLowerCase();
			return gj.includes(searchLower) || geo.includes(searchLower) || lab.includes(searchLower);
		});
	}
	return list;
}

/**
 * Unique county names from tract data (sorted).
 */
export function uniqueCounties(tractData) {
	const s = new Set();
	for (const t of tractData) {
		if (t.county) s.add(t.county);
	}
	return Array.from(s).sort((a, b) => a.localeCompare(b));
}

/**
 * Per-project rows (with ``gisjoin``) for yearly charts — same TOD split as tract dashboard.
 *
 * Parameters
 * ----------
 * developments : Array<object>
 * yearStart : number
 * yearEnd : number
 * thresholdMi : number
 * devOpts : object
 *
 * Returns
 * -------
 * Array<{ gisjoin: string, year: number, units: number, affordableUnits: number, todUnits: number, nonTodUnits: number }>
 */
/**
 * NHGIS-style tract rows for demographic charts. Optional ``devClassByGj`` maps
 * GISJOIN → ``'tod_dominated'`` | ``'nontod_dominated'`` | ``'minimal'`` from
 * MassBuilds stock-growth + TOD share rules (same window as ``windowDevs``).
 *
 * Parameters
 * ----------
 * tractList : Array<object>
 * devClassByGj : Map<string, string> | null | undefined
 *
 * Returns
 * -------
 * Array<object>
 */
export function buildNhgisLikeRows(tractList, devClassByGj) {
	return tractList.map((t) => ({
		gisjoin: t.gisjoin,
		is_tod: !!t.is_tod,
		devClass: devClassByGj?.get(t.gisjoin) ?? null,
		median_income_change_pct_10_20: t.median_income_change_pct_10_20,
		bachelors_pct_change_10_20: t.bachelors_pct_change_10_20,
		avg_travel_time_change_10_20: t.avg_travel_time_change_10_20,
		/** Decennial census percent change in housing units (2010→2020). */
		census_hu_change_10_20: t.census_hu_change_10_20,
		pop_2020: Number(t.pop_2020) || 0
	}));
}

/**
 * Per-tract development tier for the main POC: ``aggregateTractTodMetrics`` on the
 * same completion-year window as charts, then ``classifyTractDevelopment``.
 *
 * Parameters
 * ----------
 * tractList : Array<object>
 * windowDevs : Array<object>
 *     Output of ``filterDevelopmentsByYearRange`` for ``yearStart``–``yearEnd``.
 * universePanel : {{ timePeriod: string }}
 * thresholdMi : number
 * devOpts : object
 * sigDevPct : number
 * todFractionCutoff : number
 *
 * Returns
 * -------
 * Map<string, 'minimal' | 'tod_dominated' | 'nontod_dominated'>
 */
export function buildTractDevClassMap(
	tractList,
	windowDevs,
	universePanel,
	thresholdMi,
	devOpts,
	sigDevPct,
	todFractionCutoff
) {
	const tractMap = new Map();
	for (const t of tractList) {
		if (t.gisjoin) tractMap.set(t.gisjoin, t);
	}
	const transitM = transitDistanceMiToMetres(thresholdMi);
	const minMf = Math.min(1, Math.max(0, (Number(devOpts.minDevMultifamilyRatioPct) || 0) / 100));
	const tractTodMetrics = aggregateTractTodMetrics(
		windowDevs,
		tractMap,
		tractList,
		universePanel.timePeriod,
		transitM,
		'massbuilds',
		minMf
	);
	const sig = sigDevPct ?? 2;
	const cut = Number.isFinite(Number(todFractionCutoff)) ? todFractionCutoff : 0.5;
	const out = new Map();
	for (const t of tractList) {
		const gj = t.gisjoin;
		if (!gj) continue;
		const m = tractTodMetrics.get(gj);
		if (!m) continue;
		out.set(gj, classifyTractDevelopment(m, sig, cut));
	}
	return out;
}

export function buildProjectRowsWithGisjoin(developments, yearStart, yearEnd, thresholdMi, devOpts = {}) {
	const devs = filterDevelopmentsByYearRange(developments, yearStart, yearEnd, devOpts);
	const transitM = transitDistanceMiToMetres(thresholdMi);
	const minMf = Math.min(1, Math.max(0, (Number(devOpts.minDevMultifamilyRatioPct) || 0) / 100));
	const rows = [];
	for (const d of devs) {
		const gj = d.gisjoin;
		if (!gj) continue;
		const y = Number(d.completion_year);
		if (!Number.isFinite(y)) continue;
		const hu = Number(d.hu) || 0;
		if (hu <= 0) continue;
		const { todUnits, nonTodUnits } = classifyDevTodUnits(d, transitM, minMf);
		rows.push({
			gisjoin: gj,
			year: y,
			units: hu,
			affordableUnits: developmentAffordableUnitsCapped(d),
			todUnits,
			nonTodUnits
		});
	}
	return rows;
}
