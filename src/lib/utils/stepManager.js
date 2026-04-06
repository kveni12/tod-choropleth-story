export function stepObserver(node, params) {
	let observer;
	let options = params;

	function buildObserver() {
		observer?.disconnect();
		observer = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					if (entry.isIntersecting && entry.intersectionRatio >= (options.threshold ?? 0.55)) {
						options.onEnter?.(options.index);
					}
				}
			},
			{
				threshold: [0.25, 0.55, 0.8],
				rootMargin: options.rootMargin ?? '-10% 0px -28% 0px'
			}
		);
		observer.observe(node);
	}

	buildObserver();

	return {
		update(next) {
			options = next;
			buildObserver();
		},
		destroy() {
			observer?.disconnect();
		}
	};
}
