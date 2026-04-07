/**
 * Round a housing-unit count for legend labels (compact, readable ticks).
 *
 * Parameters
 * ----------
 * n : number
 *
 * Returns
 * -------
 * number
 */
export function niceHousingUnitsLabel(n) {
	if (!Number.isFinite(n) || n <= 0) return 0;
	const abs = Math.abs(n);
	if (abs < 10) return Math.round(n);
	if (abs < 100) return Math.round(n / 5) * 5;
	if (abs < 1000) return Math.round(n / 10) * 10;
	if (abs < 10000) return Math.round(n / 100) * 100;
	return Math.round(n / 500) * 500;
}
