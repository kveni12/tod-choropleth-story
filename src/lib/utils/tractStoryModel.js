import * as d3 from 'd3';

export const STORY_CONFIG = {
	titlePeriod: '2000–2020',
	todRadiusMiles: 0.5,
	todRadiusMeters: 804.672,
	significantStockPct: 2,
	todShareCutoff: 0.5,
	focusRegionLabel: 'Greater Boston transit corridor',
	focusCounties: new Set([
		'Suffolk County',
		'Middlesex County',
		'Norfolk County',
		'Essex County'
	])
};

export async function loadStoryData(base = '') {
	const path = (value) => `${base}${value}`;
	const [tractRowsRes, tractGeoRes, developmentsRes] = await Promise.all([
		fetch(path('/data/tract_data.json')),
		fetch(path('/data/tracts.geojson')),
		fetch(path('/data/developments.json'))
	]);

	const [tractRows, tractGeo, developments] = await Promise.all([
		tractRowsRes.json(),
		tractGeoRes.json(),
		developmentsRes.json()
	]);

	return buildStoryModel({ tractRows, tractGeo, developments });
}

function projectInWindow(project) {
	const year = Number(project.completion_year);
	return Number.isFinite(year) && year >= 2000 && year <= 2020;
}

function cappedAffordableUnits(project) {
	const hu = Number(project.hu) || 0;
	const affordable = Number(project.affrd_unit) || 0;
	if (hu <= 0) return 0;
	return Math.min(hu, affordable);
}

function stockIncreasePct(totalUnits, tractRow) {
	const base = Number(tractRow?.total_hu_2000) || 0;
	if (base <= 0) return null;
	return (totalUnits / base) * 100;
}

function classifyTract(totalUnits, todUnits, tractRow) {
	const increasePct = stockIncreasePct(totalUnits, tractRow);
	if (!Number.isFinite(increasePct) || increasePct < STORY_CONFIG.significantStockPct || totalUnits <= 0) {
		return 'minimal';
	}
	const todShare = totalUnits > 0 ? todUnits / totalUnits : 0;
	return todShare >= STORY_CONFIG.todShareCutoff ? 'tod_dominated' : 'nontod_dominated';
}

function tractTitle(row, gisjoin) {
	const geoid = row?.geoid ? String(row.geoid) : gisjoin?.replace(/^G25/, '') ?? gisjoin ?? 'Unknown tract';
	if (row?.county && String(row.county).trim()) {
		return `Tract in ${row.county}`;
	}
	return `Tract: ${geoid}`;
}

function extentWithPadding(values) {
	const filtered = values.filter((value) => Number.isFinite(value));
	if (!filtered.length) return [-1, 0, 1];
	const abs98 = d3.quantile(filtered.map((value) => Math.abs(value)).sort(d3.ascending), 0.98) ?? 1;
	const maxAbs = Math.max(1, abs98);
	return [-maxAbs, 0, maxAbs];
}

export function buildStoryModel({ tractRows, tractGeo, developments }) {
	const tractByGisjoin = new Map(tractRows.map((row) => [row.gisjoin, row]));
	const projectAgg = new Map();
	const storyProjects = [];

	for (const project of developments) {
		if (!projectInWindow(project)) continue;
		if (!project.gisjoin || !tractByGisjoin.has(project.gisjoin)) continue;

		const hu = Number(project.hu) || 0;
		const isTodProject = Number(project.nearest_stop_dist_m) <= STORY_CONFIG.todRadiusMeters;
		const agg = projectAgg.get(project.gisjoin) ?? {
			totalUnits: 0,
			todUnits: 0,
			affordableUnits: 0,
			projectCount: 0,
			todProjectCount: 0
		};

		agg.totalUnits += hu;
		agg.affordableUnits += cappedAffordableUnits(project);
		agg.projectCount += 1;
		if (isTodProject) {
			agg.todUnits += hu;
			agg.todProjectCount += 1;
		}
		projectAgg.set(project.gisjoin, agg);

		storyProjects.push({
			...project,
			hu,
			affordableUnits: cappedAffordableUnits(project),
			isTodProject
		});
	}

	const enrichedFeatures = tractGeo.features
		.map((feature) => {
			const gisjoin = feature.properties?.gisjoin;
			const row = tractByGisjoin.get(gisjoin);
			if (!row) return null;

			const agg = projectAgg.get(gisjoin) ?? {
				totalUnits: 0,
				todUnits: 0,
				affordableUnits: 0,
				projectCount: 0,
				todProjectCount: 0
			};
			const housingChange = (Number(row.total_hu_2020) || 0) - (Number(row.total_hu_2000) || 0);
			const category = classifyTract(agg.totalUnits, agg.todUnits, row);
			const todShare = agg.totalUnits > 0 ? agg.todUnits / agg.totalUnits : 0;
			const affordableShare = agg.totalUnits > 0 ? agg.affordableUnits / agg.totalUnits : 0;
			const isFocusRegion = STORY_CONFIG.focusCounties.has(row.county);

			return {
				...feature,
				properties: {
					...feature.properties,
					...row,
					housingChange,
					category,
					totalUnits: agg.totalUnits,
					todUnits: agg.todUnits,
					todShare,
					affordableShare,
					projectCount: agg.projectCount,
					todProjectCount: agg.todProjectCount,
					stockIncreasePct: stockIncreasePct(agg.totalUnits, row),
					isFocusRegion,
					tooltipTitle: tractTitle(row, gisjoin)
				}
			};
		})
		.filter(Boolean);

	const featuresByCategory = d3.rollup(
		enrichedFeatures,
		(values) => values.length,
		(feature) => feature.properties.category
	);

	const focusFeatureCollection = {
		type: 'FeatureCollection',
		features: enrichedFeatures.filter((feature) => feature.properties.isFocusRegion)
	};
	const focusBounds = focusFeatureCollection.features.length
		? d3.geoBounds(focusFeatureCollection)
		: null;

	const allChanges = enrichedFeatures.map((feature) => Number(feature.properties.housingChange));
	const colorDomain = extentWithPadding(allChanges);
	const totalProjects = storyProjects.length;
	const todProjects = storyProjects.filter((project) => project.isTodProject).length;
	const focusProjects = storyProjects.filter((project) =>
		STORY_CONFIG.focusCounties.has(tractByGisjoin.get(project.gisjoin)?.county)
	).length;

	const topTodTracts = enrichedFeatures
		.filter((feature) => feature.properties.category === 'tod_dominated')
		.sort((a, b) => d3.descending(a.properties.housingChange, b.properties.housingChange))
		.slice(0, 3)
		.map((feature) => ({
			gisjoin: feature.properties.gisjoin,
			county: feature.properties.county,
			housingChange: feature.properties.housingChange,
			projectCount: feature.properties.projectCount
		}));

	return {
		config: STORY_CONFIG,
		featureCollection: {
			type: 'FeatureCollection',
			features: enrichedFeatures
		},
		projects: storyProjects,
		focusBounds,
		colorDomain,
		summary: {
			tractCount: enrichedFeatures.length,
			todDominatedCount: featuresByCategory.get('tod_dominated') ?? 0,
			nonTodDominatedCount: featuresByCategory.get('nontod_dominated') ?? 0,
			minimalCount: featuresByCategory.get('minimal') ?? 0,
			totalProjects,
			todProjects,
			todProjectShare: totalProjects > 0 ? todProjects / totalProjects : 0,
			focusProjectShare: totalProjects > 0 ? focusProjects / totalProjects : 0,
			topTodTracts
		},
		sources: [
			{
				label: 'NHGIS tract-level census data crosswalked to common tract boundaries',
				url: 'https://www.nhgis.org/'
			},
			{
				label: 'MassBuilds housing development projects',
				url: 'https://www.massbuilds.com/map'
			},
			{
				label: 'Transit accessibility based on project distance to the nearest MBTA stop from the cleaned project pipeline'
			}
		]
	};
}
