## TOD D3 Explorer (GitHub Pages ready)

This folder is a self-contained build of the D3 proof-of-concept.

### Files

- `index.html`: the visualization
- `data/`: CSV inputs the viz loads (copied from the project)
- `data/muni_simplified.geojson`: simplified municipal boundaries for the choropleth (keeps this folder publishable)

### Run locally

From the repo root:

```bash
python3 -m http.server
```

Then open:

- `http://localhost:8000/tod-d3-poc/`

### Publish on GitHub Pages

Option A (recommended): set GitHub Pages to serve from the repository root (or `/docs`) and keep this folder as-is.

Option B: copy the entire `tod-d3-poc/` folder into whatever directory you publish (e.g. `docs/`), preserving the `data/` subfolder.

