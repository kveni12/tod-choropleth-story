// Relative import: some tooling fails to resolve the bare specifier `@sveltejs/adapter-static`
// even when the package is installed; loading `index.js` from this repo's `node_modules` is equivalent.
import adapter from './node_modules/@sveltejs/adapter-static/index.js';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
		adapter: adapter({ fallback: '404.html' }),
		paths: {
			// GitHub Pages project site: set BASE_PATH=/repo-name in CI. Must start with /, no trailing /.
			base: (() => {
				if (process.argv.includes('dev')) return '';
				const b = String(process.env.BASE_PATH ?? '').trim().replace(/\/+$/, '');
				return b && b.startsWith('/') ? b : '';
			})(),
		},
	},
};

export default config;
