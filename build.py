#!/usr/bin/env python3
"""Build pixa.org.

    python3 build.py                  the two pages, the redirects and the wiki
    python3 build.py --pages          only index.html, witness.html and the redirects
    python3 build.py --docs DIR       build the wiki from a local copy of pixagram-blockchain/information
    python3 build.py --snapshot       refresh _src/chain-snapshot.json from api.pixagram.com first

Pages:  _src/pages/*.html + _src/partials/   ->  ./index.html, ./witness.html
Wiki:   the Markdown in pixagram-blockchain/information  ->  ./wiki/

The pages need nothing but Python 3. The wiki needs the packages in requirements.txt;
Mermaid diagrams are drawn with `mmdc` (@mermaid-js/mermaid-cli) and cached in
_src/mermaid/cache/, so a build without mmdc reuses the drawings it already has.
"""
from __future__ import annotations

import argparse
import hashlib
import html
import json
import os
import posixpath
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SRC, PART = ROOT / "_src" / "pages", ROOT / "_src" / "partials"
SNAPSHOT = ROOT / "_src" / "chain-snapshot.json"
MERMAID = ROOT / "_src" / "mermaid"
WIKI_OUT = ROOT / "wiki"
SITE = "https://pixa.org"
DOCS_REPO = "https://github.com/pixagram-blockchain/information"
DOCS_BRANCH = "main"
NODE = "https://api.pixagram.com"

TABS = [("index.html", "Home"), ("wiki/index.html", "Wiki"), ("witness.html", "Witness setup")]

# Pages that used to exist. Each becomes a small redirect so old links keep working.
REDIRECTS = {
    "library.html": ("wiki/developers/sdks-and-libraries.html", "The library index moved to the wiki: SDKs and Libraries.",
                     {"dpixa": "dpixa", "install": "install-and-load", "surface": "what-it-covers", "specifics": "quirks-in-154",
                      "more": "other-pixagram-packages", "storage": "other-pixagram-packages", "rendering": "other-pixagram-packages",
                      "safety": "other-pixagram-packages", "security": "other-pixagram-packages", "similarity": "other-pixagram-packages",
                      "other": "hive-libraries"}),
    "interface.html": ("wiki/product/index.html", "The notes on the app moved to the wiki: Pixagram product.", {}),
    "activity.html": ("https://pixagram.com/witness-status/", "Live witness status now lives on pixagram.com/witness-status, and blocks on pixablocks.org.", {}),
}

ICONS = "assets/icons.svg"


# ============================================================================ shared

def read(p: Path) -> str:
    return p.read_text(encoding="utf-8")


def write(p: Path, text: str) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text, encoding="utf-8")


def icon(name: str, root: str, cls: str = "") -> str:
    c = f"icon {cls}".strip()
    return f'<svg class="{c}" aria-hidden="true"><use href="{root}{ICONS}#{name}"/></svg>'


def esc(s: str) -> str:
    return html.escape(s, quote=True)


MARK = read(PART / "mark.svg").strip()
HEADER = read(PART / "header.html")
FOOTER = read(PART / "footer.html")


def chrome(text: str, root: str, active: str, wiki: bool = False) -> str:
    """Fill the shared tokens of a page."""
    tabs = "\n".join(
        f'      <a href="{root}{h}"{" aria-current=\"page\"" if h == active else ""}>{t}</a>' for h, t in TABS)
    drawer_btn = (f'<button class="icon-btn drawer-btn" type="button" aria-label="Open the wiki menu" aria-controls="drawer" '
                  f'aria-expanded="false">{icon("menu", root)}</button>') if wiki else ""
    header = HEADER.replace("{{TABS}}", tabs).replace("{{DRAWER_BTN}}", drawer_btn)
    out = text.replace("{{HEADER}}", header).replace("{{FOOTER}}", FOOTER).replace("{{MARK}}", MARK)
    out = re.sub(r"\{\{ICON:([a-z_]+)\}\}", lambda m: icon(m.group(1), root), out)
    out = out.replace("{{ROOT}}", root)
    return out


# ============================================================================ chain snapshot

def rpc(method, params=None, batch=None):
    body = batch if batch is not None else {"jsonrpc": "2.0", "method": method, "params": params if params is not None else [], "id": 1}
    req = urllib.request.Request(NODE, data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        data = json.loads(r.read())
    if batch is not None:
        return data
    if "error" in data:
        raise RuntimeError(data["error"])
    return data["result"]


def refresh_snapshot() -> None:
    """Read the chain once and store what the pages show before their own requests land."""
    d = rpc("condenser_api.get_dynamic_global_properties")
    s = rpc("condenser_api.get_witness_schedule")
    p = rpc("condenser_api.get_current_median_history_price")
    head = d["head_block_number"]
    count = 160
    batch = [{"jsonrpc": "2.0", "method": "block_api.get_block_header", "params": {"block_num": head - count + 1 + i}, "id": i}
             for i in range(count)]
    headers = sorted(rpc(None, batch=batch), key=lambda x: x["id"])
    names, seq, prev_t = [], [], None
    for h in headers:
        hd = h["result"]["header"]
        t = datetime.fromisoformat(hd["timestamp"]).replace(tzinfo=timezone.utc).timestamp()
        if prev_t is not None:
            seq += [-1] * max(0, min(12, round((t - prev_t) / 3) - 1))
        prev_t = t
        if hd["witness"] not in names:
            names.append(hd["witness"])
        seq.append(names.index(hd["witness"]))
    first = headers[0]["result"]["header"]["timestamp"]
    # average block on disk (~160 B for an empty block plus ~60 % of the JSON of its transactions)
    rng = rpc("block_api.get_block_range", {"starting_block_num": head - 999, "count": 1000})
    tx = sum(len(json.dumps(b.get("transactions", []), separators=(",", ":"))) for b in rng["blocks"])
    bpb = round(160 + 0.6 * tx / max(1, len(rng["blocks"])), 1)
    reward = None
    for _, op in reversed(rpc("condenser_api.get_account_history", [d["current_witness"], -1, 30])):
        if op["op"][0] == "producer_reward":
            reward = float(op["op"][1]["vesting_shares"].split()[0])
            break
    q, b = float(p["quote"].split()[0]), float(p["base"].split()[0])
    snap = {
        "taken": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "head": head, "time": d["time"], "witness": d["current_witness"],
        "n": s["num_scheduled_witnesses"], "shuffle": s["next_shuffle_block_num"],
        "feed": f"{q / b:.3f}".rstrip("0").rstrip("."),
        "bpb": bpb, "reward": reward,
        "blocks": [head - count + 1, first, names, seq],
    }
    write(SNAPSHOT, json.dumps(snap, separators=(",", ":")) + "\n")
    print(f"snapshot: block {head:,}, {s['num_scheduled_witnesses']} witnesses, feed {snap['feed']}")


def snapshot_tokens(text: str) -> str:
    snap = json.loads(read(SNAPSHOT))
    taken = datetime.strptime(snap["taken"], "%Y-%m-%dT%H:%M:%SZ")
    stamp = f"{taken.day} {taken:%B %Y}, {taken:%H:%M} UTC"
    reps = {
        "{{SNAP_HEAD}}": f"{snap['head']:,}", "{{SNAP_HEAD_RAW}}": str(snap["head"]), "{{SNAP_WITNESS}}": snap["witness"], "{{SNAP_N}}": str(snap["n"]),
        "{{SNAP_FEED}}": snap["feed"], "{{SNAP_DATE}}": stamp, "{{SNAP_BPB}}": str(snap["bpb"]),
        "{{SNAP_REWARD}}": f"{snap['reward']:.3f}" if snap.get("reward") else "0.370",
        "{{CHAIN_SNAPSHOT}}": json.dumps({k: snap[k] for k in ("head", "time", "witness", "n", "shuffle", "feed", "blocks")}, separators=(",", ":")),
    }
    for k, v in reps.items():
        text = text.replace(k, v)
    return text


# ============================================================================ pages

def build_pages() -> None:
    for page in sorted(SRC.glob("*.html")):
        out = chrome(read(page), "", page.name)
        out = snapshot_tokens(out)
        out = re.sub(r"<pre>", '<pre class="has-copy">', out)
        assert "{{" not in out, f"unreplaced token in {page.name}: {re.findall(r'{{[A-Z_:a-z]+}}', out)}"
        write(ROOT / page.name, out)
        print(f"built {page.name} ({len(out):,} bytes)")
    for name, (target, why, anchors) in REDIRECTS.items():
        external = target.startswith("http")
        amap = json.dumps(anchors)
        body = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Moved — Pixa</title>
<link rel="canonical" href="{target if external else SITE + '/' + target}">
<meta http-equiv="refresh" content="0; url={target}">
<link rel="icon" href="assets/logo.svg" type="image/svg+xml">
<link rel="stylesheet" href="assets/site.css">
<script>
(function(){{var m={amap},h=location.hash.slice(1),t="{target}";
if(h&&m[h]){{t=/\\.html$/.test(m[h])?t.replace(/[^/]+$/,"")+m[h]:t+"#"+m[h];}}else if(h&&!/^https?:/.test(t)){{t+="#"+h;}}
location.replace(t);}})();
</script>
</head>
<body data-root="">
<main class="page moved" id="content">
<h1 class="display-s">This page moved</h1>
<p class="lead">{esc(why)}</p>
<p class="btnrow"><a class="btn" href="{target}">Go there now</a><a class="btn outlined" href="index.html">Home</a></p>
</main>
</body>
</html>
"""
        write(ROOT / name, body)
    print(f"built {len(REDIRECTS)} redirects")
    # GitHub Pages serves this for any missing path, so its links start at the site root
    notfound = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Not found — Pixa</title>
<link rel="icon" href="/assets/logo.svg" type="image/svg+xml">
<link rel="stylesheet" href="/assets/site.css">
</head>
<body data-root="/">
{{{{HEADER}}}}
<main class="page moved" id="content">
<h1 class="display-s">Nothing at this address</h1>
<p class="lead">The page may have moved when the documentation became the wiki. Search the wiki, or start from the home page.</p>
<p class="btnrow"><button class="btn" type="button" data-search-open>{{{{ICON:search}}}}Search the wiki</button><a class="btn outlined" href="/index.html">Home</a></p>
</main>
{{{{FOOTER}}}}
<script src="/assets/site.js"></script>
</body>
</html>
"""
    write(ROOT / "404.html", chrome(notfound, "/", ""))


# ============================================================================ wiki: loading

SECTION = re.compile(r"^(\d\d)-([a-z0-9-]+)$")


def slugify(text: str) -> str:
    """GitHub's heading anchor, exactly as information/.github/scripts/check_docs.py computes it."""
    text = re.sub(r"!?\[([^\]]*)\]\([^)]*\)", r"\1", text)
    text = re.sub(r"<[^>]+>", "", text)
    text = text.strip().lower()
    text = re.sub(r"[^\w\- ]", "", text, flags=re.UNICODE)
    return text.replace(" ", "-")


def find_docs(arg: str | None) -> Path:
    if arg:
        p = Path(arg).resolve()
        if not (p / "README.md").exists():
            sys.exit(f"--docs {arg}: no README.md there")
        return p
    for cand in (ROOT / "_cache" / "information", ROOT.parent / "information", ROOT.parent / "pixagram-blockchain" / "information"):
        if (cand / "README.md").exists():
            return cand
    dest = ROOT / "_cache" / "information"
    print(f"cloning {DOCS_REPO} into {dest.relative_to(ROOT)}")
    dest.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(["git", "clone", "--depth", "1", "--branch", DOCS_BRANCH, DOCS_REPO, str(dest)], check=True)
    return dest


def docs_commit(docs: Path) -> tuple[str, str]:
    try:
        out = subprocess.run(["git", "-C", str(docs), "log", "-1", "--format=%H %cs"], capture_output=True, text=True, check=True).stdout.split()
        return out[0], out[1]
    except Exception:
        return "", ""


class Docs:
    """The repository read into memory: parts, sections, pages, and where each goes on the site."""

    def __init__(self, path: Path, md):
        self.path, self.md = path, md
        self.commit, self.date = docs_commit(path)
        self.sections = []          # [{folder, slug, num, title, readme, pages:[...], planned:[...], part}]
        self.out = {}               # repo path -> site path
        self.titles = {}            # repo path -> title
        for d in sorted(p for p in path.iterdir() if p.is_dir() and SECTION.match(p.name)):
            num, slug = SECTION.match(d.name).groups()
            self.sections.append({"folder": d.name, "slug": slug, "num": num})
            self.out[f"{d.name}/README.md"] = f"wiki/{slug}/index.html"
            for f in sorted(d.glob("*.md")):
                if f.name != "README.md":
                    self.out[f"{d.name}/{f.name}"] = f"wiki/{slug}/{f.stem}.html"
        self.out["README.md"] = "wiki/index.html"
        for rel in self.out:
            self.titles[rel] = self.h1(rel)
        self.titles["README.md"] = "Wiki"
        for s in self.sections:
            self.read_section(s)
        self.read_parts()

    def text(self, rel: str) -> str:
        return read(self.path / rel)

    def h1(self, rel: str) -> str:
        for line in self.text(rel).splitlines():
            if line.startswith("# "):
                return plain_inline(self.md, line[2:].strip())
        return Path(rel).stem.replace("-", " ").title()

    def read_section(self, s) -> None:
        rel = f"{s['folder']}/README.md"
        s["title"] = self.titles[rel]
        tokens = self.md.parse(self.text(rel))
        s["intro"] = ""
        for i, t in enumerate(tokens):  # first paragraph that is not the status line
            if t.type == "paragraph_open" and (i == 0 or tokens[i - 1].type != "blockquote_open"):
                s["intro"] = plain_tokens(tokens[i + 1].children)
                break
        s["rows"], listed = [], set()
        table = rows_of_first_table(tokens)
        for cells in table:
            first, desc = cells[0], (cells[1] if len(cells) > 1 else None)
            link = next((c for c in first.children or [] if c.type == "link_open"), None)
            href = link.attrGet("href") if link else None
            target = posixpath.normpath(posixpath.join(s["folder"], href.split("#")[0])) if href and not re.match(r"^[a-z]+:", href) else None
            if target in self.out and target.startswith(s["folder"] + "/"):
                s["rows"].append({"page": target, "desc": desc})
                listed.add(target)
            else:
                s["rows"].append({"planned": plain_tokens(first.children), "desc": desc})
        for rel_page in self.out:  # pages missing from the index still get published, at the end
            if rel_page.startswith(s["folder"] + "/") and not rel_page.endswith("README.md") and rel_page not in listed:
                s["rows"].append({"page": rel_page, "desc": None})
        s["pages"] = [r["page"] for r in s["rows"] if "page" in r]

    def read_parts(self) -> None:
        """Parts from the '## Contents' of the root README: '### Part' then one bullet per section."""
        tokens = self.md.parse(self.text("README.md"))
        part, in_contents = None, False
        by_folder = {s["folder"]: s for s in self.sections}
        self.parts = []
        for i, t in enumerate(tokens):
            if t.type == "heading_open" and t.tag == "h2":
                in_contents = tokens[i + 1].content.strip().lower() == "contents"
            elif in_contents and t.type == "heading_open" and t.tag == "h3":
                part = {"name": tokens[i + 1].content.strip(), "sections": []}
                self.parts.append(part)
            elif in_contents and part is not None and t.type == "inline":
                for c in t.children or []:
                    if c.type == "link_open":
                        folder = (c.attrGet("href") or "").split("/")[0]
                        if folder in by_folder and folder not in [x["folder"] for x in part["sections"]]:
                            part["sections"].append(by_folder[folder])
                            by_folder[folder]["part"] = part["name"]
                        break
        orphans = [s for s in self.sections if "part" not in s]
        if orphans:
            self.parts.append({"name": "More", "sections": orphans})
            for s in orphans:
                s["part"] = "More"
        # the voice of each part, from the table in "How the pages are written"
        self.voices = {}
        for cells in rows_of_table_after(tokens, "how the pages are written"):
            name = plain_tokens(cells[0].children)
            if len(cells) >= 3:
                self.voices[name] = plain_tokens(cells[-1].children)

    def order(self) -> list[str]:
        """Reading order: the wiki home, then each section's index followed by its pages."""
        seq = ["README.md"]
        for s in self.sections:
            seq.append(f"{s['folder']}/README.md")
            seq += s["pages"]
        return seq

    def section_of(self, rel: str):
        folder = rel.split("/")[0]
        return next((s for s in self.sections if s["folder"] == folder), None)


# ============================================================================ wiki: Markdown helpers

def plain_tokens(children) -> str:
    out = []
    for c in children or []:
        if c.type in ("text", "code_inline"):
            out.append(c.content)
        elif c.type in ("softbreak", "hardbreak"):
            out.append(" ")
        elif c.type == "html_inline" and re.match(r"<br\s*/?>", c.content, re.I):
            out.append(" ")
    return re.sub(r"\s+", " ", "".join(out)).strip()


def plain_inline(md, src: str) -> str:
    toks = md.parseInline(src)
    return plain_tokens(toks[0].children if toks else [])


def rows_of_first_table(tokens):
    rows, in_body, row = [], False, None
    for t in tokens:
        if t.type == "tbody_open":
            in_body = True
        elif t.type == "tbody_close":
            return rows
        elif in_body and t.type == "tr_open":
            row = []
        elif in_body and t.type == "inline" and row is not None:
            row.append(t)
        elif in_body and t.type == "tr_close":
            rows.append(row)
            row = None
    return rows


def rows_of_table_after(tokens, heading: str):
    for i, t in enumerate(tokens):
        if t.type == "heading_open" and tokens[i + 1].content.strip().lower() == heading:
            return rows_of_first_table(tokens[i:])
    return []


def make_md():
    try:
        from markdown_it import MarkdownIt
        from mdit_py_plugins.tasklists import tasklists_plugin
    except ImportError:
        sys.exit("The wiki needs: pip install -r requirements.txt   (or run `python3 build.py --pages`)")
    md = MarkdownIt("gfm-like", {"html": True, "linkify": True, "typographer": False})
    md.use(tasklists_plugin, enabled=True)
    return md


# ============================================================================ wiki: diagrams

MERMAID_CONFIG = MERMAID / "config.json"
PUPPETEER = MERMAID / "puppeteer.json"
DIAGRAM_CACHE = MERMAID / "cache"


def diagram_key(src: str) -> str:
    cfg = read(MERMAID_CONFIG) if MERMAID_CONFIG.exists() else ""
    return hashlib.sha256((cfg + "\n" + src.strip()).encode()).hexdigest()[:16]


_mmdc_warned = False


def draw_diagram(src: str, key: str) -> Path | None:
    global _mmdc_warned
    out = DIAGRAM_CACHE / f"{key}.svg"
    if out.exists():
        return out
    mmdc = shutil.which("mmdc")
    if not mmdc:
        if not _mmdc_warned:
            print("warning: mmdc not found; new Mermaid diagrams are shown as source. npm i -g @mermaid-js/mermaid-cli")
            _mmdc_warned = True
        return None
    DIAGRAM_CACHE.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        inp, svg = Path(tmp) / "in.mmd", Path(tmp) / "out.svg"
        inp.write_text(src, encoding="utf-8")
        cmd = [mmdc, "-i", str(inp), "-o", str(svg), "-c", str(MERMAID_CONFIG), "-b", "transparent", "-I", f"d{key}", "-q"]
        if PUPPETEER.exists():
            cmd += ["-p", str(PUPPETEER)]
        r = subprocess.run(cmd, capture_output=True, text=True)
        if r.returncode != 0 or not svg.exists():
            print(f"warning: mmdc failed on diagram {key}: {r.stderr.strip()[:300]}")
            return None
        out.write_text(svg.read_text(encoding="utf-8"), encoding="utf-8")
    print(f"  drew diagram {key}")
    return out


def diagram_labels(src: str) -> str:
    labels = re.findall(r'[\[\(\{]+"([^"]+)"[\]\)\}]+', src)
    labels = [re.sub(r"<br\s*/?>", " ", l) for l in labels]
    return "; ".join(dict.fromkeys(l.strip() for l in labels if l.strip()))


# ============================================================================ wiki: rendering

class Renderer:
    def __init__(self, docs: Docs, md):
        self.docs, self.md = docs, md
        self.diagrams = {}
        self.assets = set()
        md.add_render_rule("fence", self.fence)
        md.add_render_rule("code_block", self.code_block)
        md.add_render_rule("table_open", lambda *a: '<div class="table-wrap"><table>\n')
        md.add_render_rule("table_close", lambda *a: "</table></div>\n")
        md.add_render_rule("html_inline", self.html_inline)
        md.add_render_rule("html_block", self.html_block)
        md.add_render_rule("heading_close", self.heading_close)
        md.add_render_rule("blockquote_open", self.blockquote_open)
        md.add_render_rule("blockquote_close", self.blockquote_close)

    # --- raw HTML: <br>, comments (dropped), and the figure markup the docs' style guide asks for
    #     (<picture>, <source>, <img> with their files copied); anything else is shown as text
    FIGURE_TAG = re.compile(r"</?(picture|source|img)\b[^>]*>", re.I)

    def figure_html(self, c: str, env) -> str | None:
        rest = re.sub(r"<!--.*?-->", "", self.FIGURE_TAG.sub("", c), flags=re.S)
        rest = re.sub(r"<br\s*/?>", "", rest, flags=re.I)
        if rest.strip():
            return None
        def tag(m):
            t = m.group(0)
            if re.search(r"\son\w+\s*=|javascript:", t, re.I):
                return ""
            t = re.sub(r'(\ssrc\s*=\s*")([^"]+)(")', lambda a: a.group(1) + esc(self.asset(html.unescape(a.group(2)), env)) + a.group(3), t)
            t = re.sub(r'(\ssrcset\s*=\s*")([^"]+)(")', lambda a: a.group(1) + ", ".join(
                " ".join([esc(self.asset(html.unescape(part.split()[0]), env))] + part.split()[1:]) for part in a.group(2).split(",") if part.strip()) + a.group(3), t)
            if t.lower().startswith("<img") and "loading=" not in t.lower():
                t = t[:4] + ' loading="lazy"' + t[4:]
            return t
        out = re.sub(r"<!--.*?-->", "", c, flags=re.S)
        return self.FIGURE_TAG.sub(tag, out)

    def html_inline(self, tokens, idx, options, env):
        c = tokens[idx].content
        if tokens[idx].meta.get("raw"):
            return c
        if re.fullmatch(r"<br\s*/?>", c.strip(), re.I):
            return "<br>"
        if c.strip().startswith("<!--"):
            return ""
        fig = self.figure_html(c, env)
        return fig if fig is not None else esc(c)

    def html_block(self, tokens, idx, options, env):
        c = tokens[idx].content.strip()
        if c.startswith("<!--") and c.endswith("-->"):
            return ""
        fig = self.figure_html(c, env)
        if fig is not None:
            return f'<figure class="figure">{fig}</figure>\n'
        return f"<p>{esc(c)}</p>\n"

    # --- files the pages show (images): copied next to the wiki, linked relatively
    def asset(self, src: str, env) -> str:
        if not src or re.match(r"^[a-zA-Z][a-zA-Z0-9+.-]*:", src) or src.startswith("//") or src.startswith("#"):
            return src
        path = src.split("#")[0].split("?")[0]
        target = posixpath.normpath(posixpath.join(posixpath.dirname(env["rel"]), path))
        if target.startswith("..") or not (self.docs.path / target).is_file() or target.endswith(".md"):
            return src
        self.assets.add(target)
        return posixpath.relpath(f"wiki/_files/{target}", posixpath.dirname(env["out"]))

    # --- headings get GitHub's anchors and a link button
    def heading_close(self, tokens, idx, options, env):
        tok = tokens[idx]
        anchor = tok.meta.get("anchor")
        if anchor and tok.tag in ("h2", "h3", "h4"):
            return f'<a class="anchor" href="#{anchor}" aria-label="Link to this section">{icon("link", env["root"])}</a></{tok.tag}>\n'
        return f"</{tok.tag}>\n"

    # --- the status line becomes a banner
    def blockquote_open(self, tokens, idx, options, env):
        if tokens[idx].meta.get("status"):
            return f'<div class="status">{tokens[idx].meta["status"]}<div class="status-text">\n'
        return "<blockquote>\n"

    def blockquote_close(self, tokens, idx, options, env):
        # find the matching open
        depth = 0
        for j in range(idx, -1, -1):
            t = tokens[j]
            if t.type == "blockquote_close":
                depth += 1
            elif t.type == "blockquote_open":
                depth -= 1
                if depth == 0:
                    return "</div></div>\n" if t.meta.get("status") else "</blockquote>\n"
        return "</blockquote>\n"

    # --- code
    def code_block(self, tokens, idx, options, env):
        return f'<pre class="hl has-copy"><code>{esc(tokens[idx].content)}</code></pre>\n'

    LANGS = {"bash": "Shell", "sh": "Shell", "shell": "Shell", "js": "JavaScript", "javascript": "JavaScript", "json": "JSON",
             "yaml": "YAML", "yml": "YAML", "python": "Python", "py": "Python", "ini": "INI", "html": "HTML", "markdown": "Markdown",
             "md": "Markdown", "ts": "TypeScript", "typescript": "TypeScript", "sql": "SQL", "go": "Go", "rust": "Rust", "cpp": "C++", "toml": "TOML"}

    def fence(self, tokens, idx, options, env):
        tok = tokens[idx]
        info = (tok.info or "").strip().split()[0].lower() if (tok.info or "").strip() else ""
        code = tok.content
        if info == "mermaid":
            return self.diagram(code, env)
        body = esc(code)
        if info and info not in ("text", "txt", "plain", "console"):
            try:
                from pygments import highlight
                from pygments.formatters import HtmlFormatter
                from pygments.lexers import get_lexer_by_name
                body = highlight(code, get_lexer_by_name(info), HtmlFormatter(nowrap=True))
            except Exception:
                pass
        label = self.LANGS.get(info, "")
        lab = f'<span class="lang">{label}</span>' if label else ""
        return f'<pre class="hl has-copy">{lab}<code>{body.rstrip()}</code></pre>\n'

    def diagram(self, src: str, env) -> str:
        key = diagram_key(src)
        path = draw_diagram(src, key)
        if not path:
            return f'<pre class="hl has-copy"><span class="lang">Mermaid</span><code>{esc(src.rstrip())}</code></pre>\n'
        svg = read(path)
        svg = re.sub(r"<\?xml[^>]*>\s*", "", svg)
        vb = re.search(r'viewBox="([-\d.\s]+)"', svg)
        width = float(vb.group(1).split()[2]) if vb else 800
        svg = re.sub(r'(<svg\b[^>]*?)\swidth="[^"]*"', r"\1", svg, count=1)
        svg = re.sub(r'(<svg\b[^>]*?)\sstyle="[^"]*"', r"\1", svg, count=1)
        label = diagram_labels(src)
        svg = re.sub(r"<svg\b", f'<svg aria-label="{esc("Diagram: " + label) if label else "Diagram"}" focusable="false"', svg, count=1)
        self.diagrams[key] = (read(path), width)
        full = posixpath.relpath(f"wiki/diagrams/{key}.svg", posixpath.dirname(env["out"]))
        return (f'<figure class="diagram" style="--w:{width:.0f}px">{svg}'
                f'<figcaption class="diagram-foot"><span class="hint">Scroll sideways to see the whole diagram.</span>'
                f'<a href="{full}">Open full size</a></figcaption></figure>\n')

    # --- the pass over the tokens before rendering: anchors, links, status
    def prepare(self, tokens, rel: str, out: str):
        seen, toc = {}, []
        first_bq = True
        for i, t in enumerate(tokens):
            if t.type == "heading_open":
                inline = tokens[i + 1]
                slug = slugify(inline.content)
                n = seen.get(slug, 0)
                seen[slug] = n + 1
                anchor = slug if n == 0 else f"{slug}-{n}"
                t.attrSet("id", anchor)
                tokens[i + 2].meta["anchor"] = anchor
                if t.tag in ("h2", "h3"):
                    toc.append((t.tag, plain_tokens(inline.children), anchor))
            elif t.type == "blockquote_open" and first_bq:
                first_bq = False
                inline = tokens[i + 2] if i + 2 < len(tokens) and tokens[i + 1].type == "paragraph_open" else None
                if inline is not None and inline.content.startswith("**Status"):
                    t.meta["status"] = self.status_chip(inline) or '<span class="chip">Status</span>'
            if t.type == "th_open" and i + 1 < len(tokens) and not tokens[i + 1].content.strip():
                from markdown_it.token import Token
                label = Token("html_inline", "", 0)
                label.content, label.meta["raw"] = '<span class="sr-only">Aspect</span>', True
                tokens[i + 1].children = [label]
            if t.type == "inline" and t.children:
                for c in t.children:
                    if c.type == "link_open":
                        c.attrSet("href", self.link(c.attrGet("href") or "", rel, out))
                    elif c.type == "image":
                        c.attrSet("src", self.asset(c.attrGet("src") or "", {"rel": rel, "out": out}))
                        c.attrSet("loading", "lazy")
        return toc

    def status_chip(self, inline) -> str | None:
        """'**Status: Live.** text' -> the chip's HTML; the label is removed from the text."""
        ch = [c for c in inline.children if not (c.type == "text" and not c.content)]
        if not (len(ch) >= 3 and ch[0].type == "strong_open"):
            return
        close = next((k for k, c in enumerate(ch) if c.type == "strong_close"), None)
        if close is None:
            return
        label = plain_tokens(ch[1:close])
        m = re.match(r"Status:?\s*(.*?)\.?$", label)
        kind = (m.group(1) if m else "").strip()
        rest = ch[close + 1:]
        if not kind:  # '**Status:** Live items run…'
            kind = "Status"
        low = kind.lower()
        sr = '<span class="sr-only">Status: </span>' if kind != "Status" else ""
        if low.startswith("live"):
            chip = f'<span class="chip"><span class="px-live" aria-hidden="true"></span>{sr}{esc(kind)}</span>'
        elif low.startswith("planned"):
            chip = f'<span class="chip dashed">{sr}{esc(kind)}</span>'
        elif low.startswith("proposed"):
            chip = f'<span class="chip dashed quiet">{sr}{esc(kind)}</span>'
        elif low.startswith("historical"):
            chip = f'<span class="chip fill">{sr}{esc(kind)}</span>'
        else:
            chip = f'<span class="chip">{sr}{esc(kind)}</span>'
        if rest and rest[0].type == "text":  # drop the space after the label
            rest[0].content = rest[0].content.lstrip()
        inline.children = rest
        return chip

    def link(self, href: str, rel: str, out: str) -> str:
        if not href or href.startswith("#") or href.startswith("mailto:"):
            return href
        here = posixpath.dirname(out)
        m = re.match(r"^https?://(?:www\.)?pixa\.org(/[^#?]*)?(\?[^#]*)?(#.*)?$", href)
        if m:
            path = (m.group(1) or "/").lstrip("/") or "index.html"
            frag = (m.group(3) or "")[1:]
            if path in REDIRECTS:  # a page that no longer exists: keep the citation; its redirect does the rest
                return href
            return posixpath.relpath(path, here) + (f"#{frag}" if frag else "")
        m = re.match(r"^https://github\.com/pixagram-blockchain/information/(?:blob|tree)/[^/]+/([^#?]*)(#.*)?$", href)
        if m:
            href = "/" + m.group(1) + (m.group(2) or "")
        elif re.match(r"^[a-zA-Z][a-zA-Z0-9+.-]*:", href) or href.startswith("//"):
            return href
        path, _, frag = href.partition("#")
        if href.startswith("/"):
            target = posixpath.normpath(path.lstrip("/")) if path.strip("/") else "README.md"
        else:
            target = posixpath.normpath(posixpath.join(posixpath.dirname(rel), path)) if path else rel
        if target in self.docs.out or (target + "/README.md") in self.docs.out:
            dest = self.docs.out.get(target) or self.docs.out[target + "/README.md"]
            url = posixpath.relpath(dest, here) if dest != out else ""
            return (url or posixpath.basename(dest)) + (f"#{frag}" if frag else "")
        if target == ".":
            return posixpath.relpath("wiki/index.html", here)
        return f"{DOCS_REPO}/blob/{DOCS_BRANCH}/{target}" + (f"#{frag}" if frag else "")

    def render(self, rel: str, out: str, src: str | None = None):
        tokens = self.md.parse(src if src is not None else self.docs.text(rel))
        root = posixpath.relpath(".", posixpath.dirname(out)) + "/"
        env = {"root": root, "out": out, "rel": rel}
        toc = self.prepare(tokens, rel, out)
        return tokens, toc, env


# ============================================================================ wiki: search index

def search_chunks(tokens) -> list[tuple[str, str, str]]:
    """(heading, anchor, text) per h2/h3 section; the text before the first one has no heading."""
    chunks, head, anchor, buf = [], "", "", []
    skip_h1 = False
    for i, t in enumerate(tokens):
        if t.type == "heading_open":
            if t.tag == "h1":
                skip_h1 = True
                continue
            if t.tag in ("h2", "h3"):
                chunks.append((head, anchor, " ".join(buf)))
                head, anchor, buf = plain_tokens(tokens[i + 1].children), t.attrGet("id") or "", []
                skip_h1 = True  # the heading text is not body text
                continue
        if t.type == "inline":
            if skip_h1:
                skip_h1 = False
                continue
            txt = plain_tokens([c for c in t.children or [] if not c.meta.get("chip")])
            if txt:
                buf.append(txt)
        elif t.type == "fence" and (t.info or "").strip().lower() != "mermaid":
            buf.append(t.content[:600])
    chunks.append((head, anchor, " ".join(buf)))
    return [(h, a, re.sub(r"\s+", " ", x).strip()[:4000]) for h, a, x in chunks if x.strip() or h]


# ============================================================================ wiki: page templates

def head_html(title: str, desc: str, out: str, root: str) -> str:
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{esc(title)}</title>
<meta name="description" content="{esc(desc)}">
<link rel="canonical" href="{SITE}/{out}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="Pixa">
<meta property="og:title" content="{esc(title)}">
<meta property="og:description" content="{esc(desc)}">
<meta property="og:url" content="{SITE}/{out}">
<meta name="twitter:card" content="summary">
<link rel="icon" href="{root}assets/logo.svg" type="image/svg+xml">
<link rel="stylesheet" href="{root}assets/site.css">
</head>
"""


def drawer_html(docs: Docs, current: str, root: str) -> str:
    here_out = docs.out[current]
    def href(rel):
        return posixpath.relpath(docs.out[rel], posixpath.dirname(here_out))
    cur_section = docs.section_of(current) if current != "README.md" else None
    parts = [f'<nav class="drawer" id="drawer" aria-label="Wiki">',
             f'<div class="drawer-head"><span class="brand-word">Wiki</span>'
             f'<button class="icon-btn drawer-close" type="button" aria-label="Close the wiki menu">{icon("close", root)}</button></div>',
             f'<a class="nav-i home-link" href="{href("README.md")}"{" aria-current=\"page\"" if current == "README.md" else ""}>'
             f'{icon("menu_book", root, "sm")}<span>Wiki home</span></a>']
    for part in docs.parts:
        parts.append(f'<div class="part">{esc(part["name"])}</div>')
        for s in part["sections"]:
            idx = f"{s['folder']}/README.md"
            is_open = cur_section is s
            aria = ' aria-current="page"' if current == idx else ""
            parts.append(f'<details{" open" if is_open else ""}>')
            parts.append(f'<summary class="nav-i"><span class="n">{s["num"]}</span><span>{esc(s["title"])}</span>{icon("keyboard_arrow_down", root, "chev")}</summary>')
            parts.append('<ul class="nav-pages">')
            parts.append(f'<li><a class="nav-i" href="{href(idx)}"{aria}>Overview</a></li>')
            for p in s["pages"]:
                a = ' aria-current="page"' if current == p else ""
                parts.append(f'<li><a class="nav-i" href="{href(p)}"{a}>{esc(docs.titles[p])}</a></li>')
            parts.append("</ul></details>")
    parts.append("</nav>")
    return "\n".join(parts)


def otp_html(toc, rel: str, root: str) -> str:
    items = []
    for tag, text, anchor in toc:
        cls = ' class="sub"' if tag == "h3" else ""
        items.append(f'<li{cls}><a href="#{anchor}">{esc(text)}</a></li>')
    src = (f'<div class="src"><a href="{DOCS_REPO}/blob/{DOCS_BRANCH}/{rel}">{icon("code", root, "sm")}View the Markdown</a>'
           f'<a href="{DOCS_REPO}/edit/{DOCS_BRANCH}/{rel}">{icon("edit", root, "sm")}Suggest a change</a></div>')
    lst = f'<h2>On this page</h2><nav class="toc" aria-label="On this page"><ul>{"".join(items)}</ul></nav>' if len(items) > 1 else ""
    return f'<aside class="otp" aria-label="Page tools">{lst}{src}</aside>'


def pager_html(docs: Docs, rel: str) -> str:
    seq = docs.order()
    i = seq.index(rel)
    here = posixpath.dirname(docs.out[rel])
    out = ['<nav class="pager" aria-label="Previous and next page">']
    def label(r):
        if r == "README.md":
            return "Wiki home"
        if r.endswith("README.md"):
            return docs.titles[r]
        return docs.titles[r]
    if i > 0:
        p = seq[i - 1]
        out.append(f'<a class="prev" href="{posixpath.relpath(docs.out[p], here)}"><span class="k">Previous</span><span class="t">{esc(label(p))}</span></a>')
    if i + 1 < len(seq):
        n = seq[i + 1]
        out.append(f'<a class="next" href="{posixpath.relpath(docs.out[n], here)}"><span class="k">Next</span><span class="t">{esc(label(n))}</span></a>')
    out.append("</nav>")
    return "".join(out)


def page_shell(docs: Docs, rel: str, title: str, desc: str, body: str, otp: str = "") -> str:
    out = docs.out[rel]
    root = posixpath.relpath(".", posixpath.dirname(out)) + "/"
    full_title = "Pixagram wiki" if rel == "README.md" else f"{title} — Pixagram wiki"
    html_out = head_html(full_title, desc, out, root)
    html_out += f'<body class="wiki-page" data-root="{root}">\n{{{{HEADER}}}}\n<div class="scrim"></div>\n<div class="wiki">\n'
    html_out += drawer_html(docs, rel, root) + "\n"
    html_out += body + "\n" + otp + "\n</div>\n{{FOOTER}}\n"
    html_out += f'<script src="{root}assets/site.js"></script>\n</body>\n</html>\n'
    return chrome(html_out, root, "wiki/index.html", wiki=True)


def doc_footer(docs: Docs, rel: str, root: str) -> str:
    commit = docs.commit[:7]
    built = (f'Built from <a href="{DOCS_REPO}/tree/{docs.commit}">information@{commit}</a>'
             f'{", " + docs.date if docs.date else ""}. Text under the <a href="{DOCS_REPO}/blob/{DOCS_BRANCH}/LICENSE">MIT License</a>; '
             f'the Pixagram name and logo are not covered by it.') if commit else ""
    return (f'<footer class="doc-foot"><a class="btn text small" href="{DOCS_REPO}/edit/{DOCS_BRANCH}/{rel}">'
            f'{icon("edit", root)}Suggest a change</a><span>{built}</span></footer>')


def crumbs_html(docs: Docs, rel: str, root: str) -> str:
    here = posixpath.dirname(docs.out[rel])
    items = [f'<a href="{posixpath.relpath("wiki/index.html", here)}">Wiki</a>']
    s = docs.section_of(rel)
    if s and not rel.endswith("README.md"):
        items.append(icon("chevron_right", root))
        items.append(f'<a href="{posixpath.relpath(docs.out[s["folder"] + "/README.md"], here)}">{esc(s["title"])}</a>')
    return f'<nav class="crumbs" aria-label="Breadcrumb">{"".join(items)}</nav>'


def description_of(tokens) -> str:
    for i, t in enumerate(tokens):
        if t.type == "paragraph_open" and i > 0 and tokens[i - 1].type not in ("blockquote_open", "list_item_open"):
            txt = plain_tokens(tokens[i + 1].children)
            if txt:
                return (txt[:157] + "…") if len(txt) > 160 else txt
    return "Pixagram's documentation, on pixa.org."


def strip_h1(tokens):
    """Drop the first '# ' heading, which the page template prints itself."""
    for i, t in enumerate(tokens):
        if t.type == "heading_open" and t.tag == "h1":
            return tokens[:i] + tokens[i + 3:]
    return tokens


# ============================================================================ wiki: build

def build_wiki(docs_arg: str | None) -> None:
    md = make_md()
    docs = Docs(find_docs(docs_arg), md)
    R = Renderer(docs, md)
    if WIKI_OUT.exists():
        shutil.rmtree(WIKI_OUT)
    pages, chunks, sitemap = [], [], []

    def add_search(rel, title, section, tokens):
        url = posixpath.relpath(docs.out[rel], "wiki")
        pages.append([title, section, url])
        for h, a, x in search_chunks(tokens):
            chunks.append([len(pages) - 1, h, a, x])

    # --- pages
    for s in docs.sections:
        for rel in s["pages"]:
            out = docs.out[rel]
            tokens, toc, env = R.render(rel, out)
            root = env["root"]
            desc = description_of(tokens)
            body_tokens = strip_h1(tokens)
            content = md.renderer.render(body_tokens, md.options, env)
            body = (f'<main class="doc" id="content">{crumbs_html(docs, rel, root)}'
                    f'<h1>{esc(docs.titles[rel])}</h1><div class="prose-doc">{content}</div>'
                    f'{doc_footer(docs, rel, root)}{pager_html(docs, rel)}</main>')
            write(ROOT / out, page_shell(docs, rel, docs.titles[rel], desc, body, otp_html(toc, rel, root)))
            add_search(rel, docs.titles[rel], s["title"], tokens)
            sitemap.append(out)

    # --- section indexes
    for s in docs.sections:
        rel = f"{s['folder']}/README.md"
        out = docs.out[rel]
        tokens, toc, env = R.render(rel, out)
        root, here = env["root"], posixpath.dirname(out)
        # everything up to the first table is the introduction; the table becomes the list of pages
        body_tokens = strip_h1(tokens)
        t_start = next((i for i, t in enumerate(body_tokens) if t.type == "table_open"), None)
        t_end = next((i for i, t in enumerate(body_tokens) if t.type == "table_close"), None)
        intro = body_tokens[:t_start] if t_start is not None else body_tokens
        after = body_tokens[t_end + 1:] if t_end is not None else []
        # drop the trailing "[All sections](../README.md#contents)" paragraph
        cleaned, i = [], 0
        while i < len(after):
            t = after[i]
            if t.type == "paragraph_open" and i + 2 < len(after):
                kids = [c for c in after[i + 1].children or [] if c.type not in ("text",) or c.content.strip()]
                if kids and kids[0].type == "link_open" and plain_tokens(after[i + 1].children) == "All sections":
                    i += 3
                    continue
            cleaned.append(t)
            i += 1
        intro_html = md.renderer.render(intro, md.options, env)
        after_html = md.renderer.render(cleaned, md.options, env)
        items = []
        prepared = rows_of_first_table(tokens)  # the same rows, with their links rewritten
        for k, row in enumerate(s["rows"]):
            cell = prepared[k][1] if k < len(prepared) and len(prepared[k]) > 1 else None
            desc_html = md.renderer.render([cell], md.options, env).strip() if cell is not None else ""
            if "page" in row:
                href = posixpath.relpath(docs.out[row["page"]], here)
                items.append(f'<li><a href="{href}"><span class="t">{esc(docs.titles[row["page"]])}</span>'
                             f'<span class="d">{re.sub(r"<a [^>]*>|</a>", "", desc_html)}</span>{icon("chevron_right", root, "trail")}</a></li>')
            else:
                items.append(f'<li><div class="planned"><span class="t">{esc(row["planned"])}</span>'
                             f'<span class="d">{desc_html}</span><span class="chip dashed trail">Planned</span></div></li>')
        body = (f'<main class="doc" id="content">{crumbs_html(docs, rel, root)}'
                f'<h1>{esc(s["title"])}</h1><div class="prose-doc">{intro_html}'
                f'<ul class="pages">{"".join(items)}</ul>{after_html}</div>'
                f'{doc_footer(docs, rel, root)}{pager_html(docs, rel)}</main>')
        write(ROOT / out, page_shell(docs, rel, s["title"], s["intro"] or s["title"], body, otp_html([], rel, root)))
        add_search(rel, s["title"], s.get("part", "Wiki"), tokens)
        sitemap.append(out)

    # --- the wiki home
    build_wiki_home(docs, R, md, add_search)
    sitemap.insert(0, "wiki/index.html")

    # --- diagrams at full size, with the font they were measured with
    for key, (svg, width) in R.diagrams.items():
        svg = re.sub(r"<\?xml[^>]*>\s*", "", svg)
        svg = re.sub(r'(<svg\b[^>]*?)\swidth="[^"]*"', rf'\1 width="{width:.0f}"', svg, count=1)
        svg = re.sub(r'(<svg\b[^>]*?)\sstyle="[^"]*"', r'\1 style="background:#fff"', svg, count=1)
        svg = re.sub(r"(<svg\b[^>]*>)", r'\1<style>@font-face{font-family:"Normative Pro";src:url("../../assets/fonts/NormativePro.woff2") format("woff2")}</style>', svg, count=1)
        write(WIKI_OUT / "diagrams" / f"{key}.svg", svg)

    # --- files the pages show
    for a in sorted(R.assets):
        dest = WIKI_OUT / "_files" / a
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(docs.path / a, dest)

    # --- search index and sitemap
    write(WIKI_OUT / "search-index.json", json.dumps({"v": 1, "commit": docs.commit[:7], "pages": pages, "chunks": chunks},
                                                     ensure_ascii=False, separators=(",", ":")))
    urls = ["", "witness.html"] + sitemap
    write(ROOT / "sitemap.xml", '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
          + "".join(f"  <url><loc>{SITE}/{u}</loc></url>\n" for u in urls) + "</urlset>\n")
    n_pages = sum(len(s["pages"]) for s in docs.sections)
    print(f"built wiki: {n_pages} pages, {len(docs.sections)} sections, {len(R.diagrams)} diagrams, "
          f"search index {len(chunks)} chunks ({(WIKI_OUT / 'search-index.json').stat().st_size:,} bytes), from information@{docs.commit[:7]}")


def readme_blocks(tokens):
    """Split the root README into its intro and its '## ' sections: [(title, tokens)]."""
    blocks, title, cur = [], None, []
    for i, t in enumerate(tokens):
        if t.type == "heading_open" and t.tag == "h2":
            blocks.append((title, cur))
            title, cur = tokens[i + 1].content.strip(), []
        cur.append(t)
    blocks.append((title, cur))
    return blocks


def build_wiki_home(docs: Docs, R: Renderer, md, add_search) -> None:
    rel, out = "README.md", "wiki/index.html"
    tokens, toc, env = R.render(rel, out)
    root, here = env["root"], "wiki"
    blocks = readme_blocks(tokens)
    intro = strip_h1(blocks[0][1])

    def render(toks):
        return md.renderer.render(toks, md.options, env)

    # intro: the first paragraph leads, the status line becomes the banner, a disclaimer stays under the search
    paras, status, rest = [], [], []
    i = 0
    while i < len(intro):
        t = intro[i]
        if t.type == "blockquote_open":
            j = i
            depth = 0
            while j < len(intro):
                if intro[j].type == "blockquote_open":
                    depth += 1
                if intro[j].type == "blockquote_close":
                    depth -= 1
                    if depth == 0:
                        break
                j += 1
            status = intro[i:j + 1]
            i = j + 1
            continue
        if t.type == "paragraph_open":
            paras.append(intro[i:i + 3])
            i += 3
            continue
        rest.append(t)
        i += 1
    lead = render(paras[0]).replace("<p>", "", 1).replace("</p>", "", 1) if paras else ""
    disclaimer = ""
    about_repo = []
    for p in paras[1:]:
        txt = plain_tokens(p[1].children)
        if txt.lower().startswith("nothing here is"):
            disclaimer = render(p).replace("<p>", '<p class="disclaimer">', 1)
        else:
            about_repo.append(p)

    hero = (f'<section class="wiki-hero"><h1 class="display-s">Pixagram wiki</h1>'
            f'<p class="lead">{lead}</p>{render(status)}'
            f'<button class="bigsearch" type="button" data-search-open>{icon("search", root)}<span>Search {sum(len(s["pages"]) for s in docs.sections)} pages</span><kbd>/</kbd></button>'
            f'{disclaimer}</section>')

    sections_html = []
    for title, toks in blocks[1:]:
        low = (title or "").lower()
        anchor = slugify(title or "")
        body = toks[3:]  # without the h2
        if low == "at a glance":
            rows = rows_of_first_table(toks)
            cells = "".join(f'<div><dt>{esc(plain_tokens(r[0].children))}</dt><dd>{render([r[1]]).strip()}</dd></div>' for r in rows if len(r) > 1)
            t_end = next((k for k, t in enumerate(body) if t.type == "table_close"), -1)
            sections_html.append(f'<section class="home-block" id="{anchor}"><h2>{esc(title)}</h2><dl class="glance">{cells}</dl>{render(body[t_end + 1:])}</section>')
        elif low == "where to start":
            cards = []
            k = 0
            while k < len(body):
                if body[k].type == "list_item_open" and body[k].level == 1:
                    depth, j = 0, k
                    while j < len(body):
                        if body[j].type == "list_item_open":
                            depth += 1
                        elif body[j].type == "list_item_close":
                            depth -= 1
                            if depth == 0:
                                break
                        j += 1
                    item = body[k + 1:j]
                    head = ""
                    if item and item[0].type == "paragraph_open":
                        ch = [c for c in item[1].children or [] if not (c.type == "text" and not c.content)]
                        if len(ch) > 2 and ch[0].type == "strong_open":
                            close = next(n for n, c in enumerate(ch) if c.type == "strong_close")
                            head = plain_tokens(ch[1:close]).rstrip(":")
                            rest_ch = ch[close + 1:]
                            if rest_ch and rest_ch[0].type == "text":
                                rest_ch[0].content = rest_ch[0].content.lstrip()
                            item[1].children = rest_ch
                    cards.append(f'<div class="s"><span class="h">{esc(head)}</span>{render(item)}</div>')
                    k = j + 1
                    continue
                k += 1
            sections_html.append(f'<section class="home-block" id="{anchor}"><h2>{esc(title)}</h2><div class="starts">{"".join(cards)}</div></section>')
        elif low == "contents":
            lead_p = ""
            for k, t in enumerate(body):
                if t.type == "paragraph_open":
                    lead_p = render(body[k:k + 3])
                    break
                if t.type == "heading_open":
                    break
            parts_html = []
            for part in docs.parts:
                secs = []
                for s in part["sections"]:
                    idx = f"{s['folder']}/README.md"
                    lis = []
                    for row in s["rows"]:
                        if "page" in row:
                            lis.append(f'<li><a href="{posixpath.relpath(docs.out[row["page"]], here)}">{esc(docs.titles[row["page"]])}</a></li>')
                        else:
                            lis.append(f'<li><span class="planned">{esc(row["planned"])}, planned</span></li>')
                    first = ""
                    for sentence in re.split(r"(?<=[.!?])\s", s["intro"] or ""):
                        first = (first + " " + sentence).strip()
                        if len(first) >= 50:
                            break
                    secs.append(f'<div class="sec"><span class="no">{s["num"]}</span><h4><a href="{posixpath.relpath(docs.out[idx], here)}">{esc(s["title"])}</a></h4>'
                                f'{"<p>" + esc(first) + "</p>" if first else ""}<ul>{"".join(lis)}</ul></div>')
                voice = docs.voices.get(part["name"], "")
                parts_html.append(f'<div class="part-block"><div class="part-h"><h3>{esc(part["name"])}</h3>{"<p>" + esc(voice[:1].upper() + voice[1:]) + "</p>" if voice else ""}</div>'
                                  f'<div class="secs">{"".join(secs)}</div></div>')
            sections_html.append(f'<section class="home-block" id="{anchor}"><h2>{esc(title)}</h2>{lead_p}<div class="parts">{"".join(parts_html)}</div></section>')
        else:
            extra = ""
            if low == "about the project" and about_repo:
                extra = "".join(render(p) for p in about_repo)
            sections_html.append(f'<section class="home-block prose-doc" id="{anchor}"><h2>{esc(title)}</h2>{extra}{render(body)}</section>')

    body = (f'<main class="doc wiki-home" id="content">{hero}{"".join(sections_html)}'
            f'{doc_footer(docs, rel, root)}{pager_html(docs, rel)}</main>')
    desc = "Pixagram's documentation: what the network is, how to use it, how to build on it, and the figures behind it."
    toc_items = [("h2", t, slugify(t)) for t, _ in blocks[1:] if t]
    write(ROOT / out, page_shell(docs, rel, "Pixagram wiki", desc, body, otp_html(toc_items, rel, root)))
    add_search(rel, "Pixagram wiki", "Wiki", tokens)


# ============================================================================ main

def main() -> int:
    ap = argparse.ArgumentParser(description="Build pixa.org")
    ap.add_argument("--pages", action="store_true", help="build index.html, witness.html and the redirects only")
    ap.add_argument("--docs", help="path to a checkout of pixagram-blockchain/information")
    ap.add_argument("--snapshot", action="store_true", help="refresh the chain snapshot from api.pixagram.com first")
    a = ap.parse_args()
    if a.snapshot:
        refresh_snapshot()
    build_pages()
    if not a.pages:
        build_wiki(a.docs)
    return 0


if __name__ == "__main__":
    sys.exit(main())
