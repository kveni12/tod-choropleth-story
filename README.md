# TOD Choropleth Story

A standalone SvelteKit app focused on one task: a scroll-driven tract-level choropleth story about TOD, housing growth, and project concentration in Massachusetts.

## File structure

```text
tod-choropleth-story/
├── package.json
├── svelte.config.js
├── vite.config.js
├── static/data/
│   ├── developments.json
│   ├── mbta_lines.geojson
│   ├── mbta_stops.json
│   ├── meta.json
│   ├── tract_data.json
│   └── tracts.geojson
└── src/
    ├── app.css
    ├── app.html
    ├── routes/
    │   ├── +layout.js
    │   └── +page.svelte
    └── lib/
        ├── components/
        │   └── PocNhgisTractMap.svelte
        ├── stores/
        │   ├── data.svelte.js
        │   └── panelState.svelte.js
        └── utils/
            ├── derived.js
            ├── mainPocTractModel.js
            ├── mbtaColors.js
            └── periods.js
```

## What each module does

- `+page.svelte`: the story framing, loading state, and writeup sections around the map.
- `PocNhgisTractMap.svelte`: the exact tract scrollytelling map carried over from `tod-d3-poc`.
- `data.svelte.js`: shared tract, MBTA, and development data loading.
- `panelState.svelte.js`: the map state object needed by the original tract component.
- `mainPocTractModel.js`: tract filtering and TOD/non-TOD classification logic reused from the original project.
- `derived.js`, `periods.js`, and `mbtaColors.js`: the minimal supporting utilities the exact map depends on.

## Scope decisions

- Kept: the original tract scrollytelling map, tract geometry, tract attributes, MBTA overlays, MassBuilds projects, tooltip hierarchy, and the writeup sections that frame the map.
- Removed: unrelated charts, municipal analytics, sandbox/dashboard controls outside the map component, experimental alternatives, and unused assets.
