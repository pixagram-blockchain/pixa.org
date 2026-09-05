#!/usr/bin/env python3
"""Assemble the pixa.org pages: _src/pages/*.html + _src/partials → ./*.html
Run `python3 build.py` after editing a page or a partial. No dependencies."""
import pathlib, re
ROOT = pathlib.Path(__file__).parent
SRC, PART = ROOT / "_src" / "pages", ROOT / "_src" / "partials"
NAV = [("index.html", "Home"), ("witness.html", "Witness setup"), ("library.html", "Library"), ("interface.html", "Interface"), ("activity.html", "Activity")]
mark = (PART / "mark.svg").read_text().strip()
header = (PART / "header.html").read_text()
footer = (PART / "footer.html").read_text()
for page in sorted(SRC.glob("*.html")):
    html = page.read_text()
    nav = "\n".join(f'      <a href="{h}"{" aria-current=\"page\"" if h == page.name else ""}>{t}</a>' for h, t in NAV)
    out = html.replace("{{HEADER}}", header.replace("{{NAV}}", nav)).replace("{{FOOTER}}", footer).replace("{{MARK}}", mark)
    assert "{{" not in out, f"unreplaced token in {page.name}: {re.findall(r'{{[A-Z_:]+}}', out)}"
    (ROOT / page.name).write_text(out)
    print(f"built {page.name} ({len(out):,} bytes)")
