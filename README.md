# pixa.org

Static developer site for the Pixa blockchain: five pages, no backend, no build
server. Everything live on the pages (chain figures, witness status, npm versions,
GitHub activity, app build numbers) is read by the visitor's browser from public
endpoints that allow cross-origin requests.

| Page | What it is |
|---|---|
| `index.html` | Home: clickable component map, quick links, `SKILL.md` download, repository index, endpoints |
| `witness.html` | The node operator guide (witness and API node), content unchanged |
| `library.html` | `@pixagram/dpixa` and the other fourteen `@pixagram` packages |
| `interface.html` | pixagram.com (the app) and pixagram.dev (the canary build) |
| `activity.html` | Live witness status computed in the browser, recent blocks, health findings, GitHub activity |

## Editing

The five pages are assembled from `_src/pages/*.html` plus the shared partials in
`_src/partials/` (header with the menu, footer, inline logo). Edit there, then run

```bash
python3 build.py
```

which rewrites the root `*.html` files. Anything else (`assets/`, `skill/`) is served as-is.

Shared configuration — RPC nodes, GitHub organisation, LinkedIn URL, app and canary
addresses, snapshot URL — is the `CONFIG` object at the top of `assets/site.js`.

## Fonts

- Normative Pro is bundled: `assets/fonts/NormativePro.woff2` (variable weight).
- Industry is referenced but **not bundled**: copy `IndustryBold.ttf` and
  `IndustryBook.ttf` into `assets/fonts/` and every heading switches over. Until
  then the fallback stack in `assets/site.css` applies.

## The skill file

`skill/SKILL.md` and `skill/README.md` are copies of
[pixagram-blockchain/pixagram-skill](https://github.com/pixagram-blockchain/pixagram-skill)
at commit `6f8a817` (4 September 2026). Re-copy when the skill changes.

## Data sources

| Page | Source | Notes |
|---|---|---|
| all | `https://api.pixagram.com` (selectable on the activity page) | JSON-RPC, CORS `*` |
| activity | `https://api.github.com/orgs/pixagram-blockchain/{events,repos}` | 60 anonymous requests/hour per address; responses cached in `localStorage` with ETags so repeat loads cost nothing |
| activity | `raw.githubusercontent.com/pixagram-blockchain/witness-status/data/status.json` | fallback when the node is unreachable |
| library | `https://registry.npmjs.org/@pixagram%2F<pkg>/latest` | live versions |
| interface | `https://pixagram.com/manifest.json`, `https://pixagram.dev/manifest.json` | build version and `Last-Modified` |
| home | `https://huggingface.co/api/spaces/primerz/face-to-pixel-art-4K` | Space runtime state |

The activity page implements the formulas and health thresholds documented in
[witness-status/AGENT.md](https://github.com/pixagram-blockchain/witness-status/blob/main/AGENT.md);
keep the two in step if the thresholds change.

## Deployment

Any static host. For GitHub Pages, publish the repository root (`.nojekyll` keeps
the `_src/` folder and everything else as-is) and point the `pixa.org` DNS at it.
