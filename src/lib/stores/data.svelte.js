import { base } from '$app/paths';

const MISSING_NEAREST_STOP =
	'developments.json must include a numeric nearest_stop_dist_m for every MassBuilds project. ' +
	'Run the data pipeline on your machine and copy outputs into static/data, e.g.: ' +
	'conda activate ./.conda && python scripts/process_data.py';

/**
 * Shared tract/policy dashboard data loaded on demand (``/tract``, ``/policy``) from ``static/data``
 * (served under ``{base}/data/`` for GitHub Pages).
 *
 * Notes
 * -----
 * Svelte does not allow reassigning exported ``$state`` bindings; ``loadAllData`` mutates
 * these values in place (arrays via ``length`` / ``push``, objects via key updates).
 */

export const tractData = $state([]);
export const tractGeo = $state({ type: 'FeatureCollection', features: [] });
export const developments = $state([]);
export const mbtaStops = $state([]);
export const mbtaLines = $state({ type: 'FeatureCollection', features: [] });
export const meta = $state({ yVariables: [], xVariables: [], controlAverages: {} });

/**
 * Replace enumerable own properties on ``target`` with those from ``source``.
 */
function replaceObjectProps(target, source) {
	for (const k of Object.keys(target)) {
		delete target[k];
	}
	Object.assign(target, source);
}

/**
 * Fail fast if the pipeline did not attach per-project nearest-stop distances.
 *
 * Parameters
 * ----------
 * devs : Array<object>
 *
 * Returns
 * -------
 * void
 */
function assertDevelopmentsHaveNearestStopDist(devs) {
	if (!Array.isArray(devs) || devs.length === 0) return;
	for (let i = 0; i < devs.length; i++) {
		const v = devs[i].nearest_stop_dist_m;
		if (v == null || !Number.isFinite(Number(v))) {
			throw new Error(MISSING_NEAREST_STOP);
		}
	}
}

/** @type {Promise<void> | null} */
let loadAllDataPromise = null;

/**
 * Fetch all dashboard JSON assets in parallel and assign module state.
 *
 * Notes
 * -----
 * Concurrent callers await the same in-flight promise so navigation and effects
 * cannot trigger duplicate fetches. On failure, the guard is cleared so a later
 * call can retry.
 */
export async function loadAllData() {
	if (loadAllDataPromise) return loadAllDataPromise;
	loadAllDataPromise = (async () => {
		const p = (/** @type {string} */ path) => `${base}${path}`;
		const [tractDataRes, tractGeoRes, devsRes, mbtaStopsRes, mbtaLinesRes, metaRes] =
			await Promise.all([
				fetch(p('/data/tract_data.json')),
				fetch(p('/data/tracts.geojson')),
				fetch(p('/data/developments.json')),
				fetch(p('/data/mbta_stops.json')),
				fetch(p('/data/mbta_lines.geojson')),
				fetch(p('/data/meta.json')),
			]);

		const [tractDataJson, tractGeoJson, devsJson, mbtaStopsJson, mbtaLinesJson, metaJson] =
			await Promise.all([
				tractDataRes.json(),
				tractGeoRes.json(),
				devsRes.json(),
				mbtaStopsRes.json(),
				mbtaLinesRes.json(),
				metaRes.json()
			]);

		assertDevelopmentsHaveNearestStopDist(devsJson);

		tractData.length = 0;
		tractData.push(...tractDataJson);
		replaceObjectProps(tractGeo, tractGeoJson);
		developments.length = 0;
		developments.push(...devsJson);
		mbtaStops.length = 0;
		mbtaStops.push(...mbtaStopsJson);
		replaceObjectProps(mbtaLines, mbtaLinesJson);
		replaceObjectProps(meta, metaJson);
	})().catch((e) => {
		loadAllDataPromise = null;
		throw e;
	});
	return loadAllDataPromise;
}
