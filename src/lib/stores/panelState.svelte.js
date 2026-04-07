/**
 * Factory for per-panel reactive state (left/right panes).
 */

/**
 * Build an isolated panel state object with Svelte 5 runes and selection helpers.
 *
 * Parameters
 * ----------
 * id : string
 *     Panel id, e.g. ``'left'`` or ``'right'``.
 *
 * Returns
 * -------
 * PanelState
 */
export function createPanelState(id) {
	class PanelState {
		id = id;

		// ── Time ───────────────────────────────────────────────
		timePeriod = $state('10_20');
		xVar = $state('pct_stock_increase');
		yVar = $state('minority_pct_change');

		/** Min. share of MassBuilds new units that are affordable (0–100%); 0 = off. */
		todMinAffordableSharePct = $state(0);
		nonTodMinAffordableSharePct = $state(0);
		/** Min. tract housing stock increase (%): MassBuilds new units / census HU at period start; 0 = off. */
		todMinStockIncreasePct = $state(0);
		nonTodMinStockIncreasePct = $state(0);

		// ── Overall census tract universe ───────────────────────
		/** Min. MBTA stops in tract + buffer (count); 0 = no floor. */
		minStops = $state(0);
		minPopulation = $state(0);
		// Tract-universe defaults (same floors as Policy Insights).
		minPopDensity = $state(200);

		// ── Development filters ────────────────────────────────
		minUnitsPerProject = $state(0);
		/** Min. share of units that are multifamily (small + large MF) / ``hu``; 0 = off. */
		minDevMultifamilyRatioPct = $state(0);
		/** Min. share of units that are affordable / ``hu``; 0 = off. */
		minDevAffordableRatioPct = $state(0);
		includeRedevelopment = $state(true);

		// ── Map overlays ──────────────────────────────────────
		showDevelopments = $state(false);
		showBusLines = $state(false);
		showRailLines = $state(true);
		showCommuterRailLines = $state(true);
		showBusStops = $state(false);
		showRailStops = $state(false);
		showCommuterRailStops = $state(false);
		/** When true, tint choropleth tracts classified as TOD-dominated (MassBuilds TOD share). */
		showMapTodCohortShade = $state(false);
		/** When true, tint tracts with significant non-TOD-dominated development. */
		showMapControlCohortShade = $state(false);

		// ── TOD Analysis (development-level TOD; see TodIntensityScatter) ──
		/** Miles from development to nearest MBTA stop to count as transit-accessible. */
		transitDistanceMi = $state(0.5);
		/** Min. % housing stock increase (census or MassBuilds per ``huChangeSource``) for "significant" tracts. */
		sigDevMinPctStockIncrease = $state(2);
		/** TOD fraction of new dev units at/above which a tract is "TOD-dominated". */
		todFractionCutoff = $state(0.5);
		/** ``census`` = decennial HU change %; ``massbuilds`` = filtered dev units / base stock. */
		huChangeSource = $state('massbuilds');

		// ── Chart options ─────────────────────────────────────
		trimOutliers = $state(true);
		/** When true, binned bar chart draws a second bar per bin for non-TOD-dominated (significant dev) tracts. */
		showNonTodBinnedBars = $state(true);

		// ── Selection / interaction ────────────────────────────
		selectedTracts = $state(new Set());
		hoveredTract = $state(null);
		/** GISJOIN of the tract most recently toggled (map/scatter click); used for “latest tract” sidebar focus. */
		lastInteractedGisjoin = $state(/** @type {string | null} */ (null));

		toggleTract(gisjoin) {
			const next = new Set(this.selectedTracts);
			if (next.has(gisjoin)) next.delete(gisjoin);
			else next.add(gisjoin);
			this.selectedTracts = next;
			this.lastInteractedGisjoin = gisjoin;
		}

		clearSelection() {
			this.selectedTracts = new Set();
			this.lastInteractedGisjoin = null;
		}

		/**
		 * Replace the entire selection with the given set of gisjoins.
		 *
		 * Parameters
		 * ----------
		 * gisjoins : Iterable<string>
		 */
		selectAll(gisjoins) {
			this.selectedTracts = new Set(gisjoins);
			this.lastInteractedGisjoin = null;
		}

		/**
		 * Record which tract the user last interacted with when selection changes outside ``toggleTract``
		 * (e.g. scatter brush). Does not modify ``selectedTracts``.
		 *
		 * Parameters
		 * ----------
		 * gisjoin : string | null
		 *     Tract to mark as focused, or ``null`` to clear.
		 */
		setLastInteracted(gisjoin) {
			this.lastInteractedGisjoin = gisjoin;
		}

		/**
		 * Parameters
		 * ----------
		 * gisjoin : string | null
		 */
		setHovered(gisjoin) {
			this.hoveredTract = gisjoin;
		}
	}

	return new PanelState();
}
