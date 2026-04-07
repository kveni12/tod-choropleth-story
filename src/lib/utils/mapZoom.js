/**
 * D3 wheel/drag zoom for choropleth map SVGs (shared by municipal + POC tract maps).
 */
import * as d3 from 'd3';

/**
 * Append a clipped group; map paths should be drawn into the returned layer.
 * Scroll/pinch zooms, drag pans, double-click resets the view.
 *
 * Parameters
 * ----------
 * svg : d3.Selection
 *     Parent SVG selection.
 * width : number
 *     Clip rect width (viewBox units).
 * height : number
 *     Clip rect height (viewBox units).
 * opts : { maxScale?: number }
 *     Optional max zoom scale (default 24).
 *
 * Returns
 * -------
 * d3.Selection
 *     Group to append ``path`` elements into.
 */
export function createMapZoomLayer(svg, width, height, opts = {}) {
	const maxScale = opts.maxScale ?? 24;
	let defs = svg.select('defs');
	if (defs.empty()) defs = svg.append('defs');
	const clipId = `map-clip-${Math.random().toString(36).slice(2, 11)}`;
	defs
		.append('clipPath')
		.attr('id', clipId)
		.append('rect')
		.attr('x', 0)
		.attr('y', 0)
		.attr('width', width)
		.attr('height', height);
	const mapRoot = svg.append('g').attr('clip-path', `url(#${clipId})`);
	const zoomLayer = mapRoot.append('g').attr('class', 'map-zoom-layer');
	const zoom = d3
		.zoom()
		.scaleExtent([1, maxScale])
		.on('zoom', (event) => {
			zoomLayer.attr('transform', event.transform);
		});
	svg.call(zoom).on('dblclick.zoom', null).style('touch-action', 'none');
	svg.on('dblclick', (event) => {
		event.preventDefault();
		svg.transition().duration(200).call(zoom.transform, d3.zoomIdentity);
	});
	return zoomLayer;
}
