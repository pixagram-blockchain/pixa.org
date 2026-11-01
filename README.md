# pixa.org

Static developer site for the Pixa blockchain: a home page, the node operator guide, and a wiki
built from [pixagram-blockchain/information](https://github.com/pixagram-blockchain/information).
There is no backend. Everything live on the pages (chain figures, the block ribbon, the state of
the Hugging Face Space) is read by the visitor's browser from public endpoints that allow
cross-origin requests.

| Path | What it is |
|---|---|
| `index.html` | Home: the live chain, a clickable component map, quick links, the `SKILL.md` download, the repository index and the public endpoints |
| `witness.html` | The node operator guide, witness and API node |
| `wiki/` | The documentation, generated from the `information` repository: every section and page, the contents, and search |
| `library.html`, `interface.html`, `activity.html` | Redirects, so old links keep working: to the wiki, and to the witness status dashboard |

## Design

Material 3 with the Pixa scheme: primary is white, secondary is black, the greys carry no tint,
and there is no accent hue. The only colour on the site is the spectrum, and it always means
that the chain is live: the block ribbon (one square per block, coloured by its place in the
witness schedule, so that one spectrum is one round), the indicator under the current tab, and
the **Live** status chips in the wiki. The tokens are at the top of `assets/site.css`.

- **Type.** Normative Pro, bundled as `assets/fonts/NormativePro.woff2` (one regular weight).
  Industry takes the display and headline roles once `IndustryBold.ttf` and `IndustryBook.ttf`
  are copied into `assets/fonts/`, or when it is installed on the visitor's machine. Until then
  the browser logs a 404 for `IndustryBook.ttf`; it is harmless.
- **Icons.** Material Symbols Rounded (Apache License 2.0), as one sprite, `assets/icons.svg`.
- **Shapes.** Pills for actions, 16 px for tables, code and cards, 28 px for the large containers.
  Shadows only on floating layers: the search dialog and the wiki drawer on small screens.

## Building

```bash
pip install -r requirements.txt        # the wiki only; the pages need nothing but Python 3
python3 build.py                       # the pages, the redirects and the wiki
python3 build.py --pages               # the pages and the redirects only
python3 build.py --docs ../information # build the wiki from a local checkout of the docs
python3 build.py --snapshot            # first refresh the chain snapshot from api.pixagram.com
```

Without `--docs`, the build looks for the documentation in `_cache/information`, `../information`
and `../pixagram-blockchain/information`, and clones it into `_cache/` if none is there.

### The pages

`index.html` and `witness.html` are assembled from `_src/pages/*.html` and the partials in
`_src/partials/` (header with the tabs, footer, inline logo). Edit there and rebuild; the root
`*.html` files are rewritten. `{{ICON:name}}` places an icon from the sprite.

`_src/chain-snapshot.json` holds what the pages show before their own requests land: the head
block, the witnesses, the feed and the last 160 block headers for the ribbon. Refresh it with
`--snapshot` before a release so the first paint is close to the truth.

Shared configuration (RPC node, GitHub organisation, LinkedIn, X, Telegram, explorer, app and
canary addresses) is the `CONFIG` object at the top of `assets/site.js`.

### The wiki

Every Markdown file in the documentation becomes a page under `wiki/`, with the section number
dropped from the folder name: `05-pixa-supra/pxs-at-a-glance.md` is
`wiki/pixa-supra/pxs-at-a-glance.html`, and each folder's `README.md` is that section's
`index.html`. The structure comes from the documentation itself:

- **Parts and sections** from the `## Contents` list of the root `README.md`.
- **Page order** from the table in each section's `README.md`; titles in plain text there are
  listed as planned.
- **Anchors** from the same slug function as `information/.github/scripts/check_docs.py`, so every
  link that passes the docs' own check resolves here too.
- **Links** between pages are rewritten to the generated files; links to files that are not pages
  (`LICENSE`, `.github/…`) point at GitHub, and links to `pixa.org` become relative.
- **Status lines** (`> **Status: Live.** …`) become a banner with a chip.
- **Mermaid diagrams** are drawn at build time by `mmdc` with `_src/mermaid/config.json`, and kept
  in `_src/mermaid/cache/` by content hash. Commit new files there; a build without `mmdc` reuses
  them and shows the source of any diagram it cannot draw. `mmdc` measures text with the fonts
  installed on the machine, so install Normative Pro first (the workflow shows how).
- **Search** runs in the browser on `wiki/search-index.json`, loaded the first time someone opens
  it (`/` or Ctrl+K on any page).

Each page links to its Markdown and to GitHub's editor. To change the content, change the
documentation, not this repository.

## Keeping the wiki current

The deploy workflow rebuilds the wiki from the latest `main` of the documentation on every push
here, every six hours, and on demand (Actions → Deploy pixa.org → Run workflow). The committed
`wiki/` is the last local build, for previews and other hosts; the deployed one can be newer.

To publish a documentation change within a minute instead, let the `information` repository
notify this one. Add a fine-grained token that can write to `pixa.org` as the secret
`PIXA_ORG_DISPATCH`, then this step to its workflow on `main`:

```yaml
- run: >
    curl -sf -X POST https://api.github.com/repos/pixagram-blockchain/pixa.org/dispatches
    -H "Authorization: Bearer ${{ secrets.PIXA_ORG_DISPATCH }}" -H "Accept: application/vnd.github+json"
    -d '{"event_type":"docs-updated"}'
```

GitHub pauses scheduled workflows in a repository with no activity for 60 days; a push or a manual
run starts them again.

## The skill file

`skill/SKILL.md` and `skill/README.md` are copies of
[pixagram-blockchain/pixagram-skill](https://github.com/pixagram-blockchain/pixagram-skill)
at commit `6f8a817` (4 September 2026). Re-copy when the skill changes.

## Data sources

| Page | Source | Notes |
|---|---|---|
| all | `https://api.pixagram.com` | JSON-RPC, CORS `*`: the head block every three seconds (six on pages without the chain card) |
| home, witness | `block_api.get_block_header` in batches | the ribbon; one batch on load, then only the new blocks |
| witness | `block_api.get_block_range`, `condenser_api.get_account_history` | chain size and witness pay |
| home | `https://huggingface.co/api/spaces/primerz/face-to-pixel-art-4K` | Space runtime state |
| wiki | `wiki/search-index.json` | built with the wiki, fetched on first search |

## Deployment

Any static host. On GitHub Pages, `.github/workflows/static.yml` builds and publishes the
repository root on every push to `main`. Point the `pixa.org` DNS at it.
