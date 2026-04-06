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
        │   ├── ChoroplethMap.svelte
        │   └── ScrollNarrative.svelte
        └── utils/
            ├── stepManager.js
            └── tractStoryModel.js
```

## What each module does

- `+page.svelte`: page shell, loading state, story copy, and writeup sections.
- `ChoroplethMap.svelte`: sticky choropleth, legend, hover interactions, tract category overlays, and project points.
- `ScrollNarrative.svelte`: scrollytelling text blocks that drive the active map step.
- `stepManager.js`: IntersectionObserver action for step activation.
- `tractStoryModel.js`: focused data loading and local TOD classification logic for the story.

## Scope decisions

- Kept: tract geometry, tract attributes, MassBuilds projects, scrollytelling layout, tooltip hierarchy, writeup sections.
- Removed: all other charts, dashboard controls, panel state stores, experimental map variants, municipal analytics, and unused assets.
