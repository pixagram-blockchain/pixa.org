/* pixa.org — shared script. No dependencies, no build step.
   Live figures, the block ribbon, copy buttons, contents tracking, the wiki drawer and
   the site-wide search. Everything degrades to the static page when a request fails. */
(function () {
  "use strict";

  /* ---------- site configuration (edit here, nothing else) ---------- */
  var CONFIG = {
    node: "https://api.pixagram.com",
    github: "https://github.com/pixagram-blockchain",
    githubOrg: "pixagram-blockchain",
    docsRepo: "https://github.com/pixagram-blockchain/information",
    linkedin: "https://www.linkedin.com/company/pixagram-blockchain/",
    x: "https://x.com/pixagram_omni",
    telegram: "https://t.me/omnibus_pixagram/1",
    explorer: "https://pixablocks.org/",
    app: "https://pixagram.com",
    canary: "https://pixagram.dev",
    status: "https://pixagram.com/witness-status/",
    statusJson: "https://raw.githubusercontent.com/pixagram-blockchain/witness-status/data/status.json",
    skillRaw: "https://raw.githubusercontent.com/pixagram-blockchain/pixagram-skill/main/SKILL.md",
    hfSpace: "https://huggingface.co/spaces/primerz/face-to-pixel-art-4K"
  };

  function $(id) { return document.getElementById(id); }
  var ROOT = (document.body && document.body.getAttribute("data-root")) || "";

  /* ---------- tiny event hub: one poller, many listeners ---------- */
  var hub = {};
  function on(name, fn) { (hub[name] = hub[name] || []).push(fn); }
  function emit(name, data) { (hub[name] || []).forEach(function (fn) { try { fn(data); } catch (e) { /* keep going */ } }); }

  /* ---------- JSON-RPC ---------- */
  function rpc(method, params, node) {
    return fetch(node || CONFIG.node, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: method, params: params == null ? [] : params, id: 1 })
    }).then(function (r) { return r.json(); })
      .then(function (j) { if (j.error) throw new Error(j.error.message); return j.result; });
  }
  // calls: [{method, params}] → results in call order ({result} | {error}); also returns latency
  function rpcBatch(calls, node, timeoutMs) {
    var body = calls.map(function (c, i) { return { jsonrpc: "2.0", method: c.method, params: c.params == null ? [] : c.params, id: i + 1 }; });
    var ctrl = ("AbortController" in window) ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, timeoutMs || 15000) : null;
    var t0 = Date.now();
    return fetch(node || CONFIG.node, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: ctrl ? ctrl.signal : undefined })
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (j) {
        var arr = Array.isArray(j) ? j : [j], byId = {};
        arr.forEach(function (r) { byId[r.id] = r; });
        var results = body.map(function (req) {
          var r = byId[req.id];
          if (!r) return { error: { message: "no response for " + req.method } };
          return r.error ? { error: r.error } : { result: r.result };
        });
        return { results: results, latencyMs: Date.now() - t0 };
      })
      .finally(function () { if (timer) clearTimeout(timer); });
  }

  /* ---------- parsing and formatting ---------- */
  var NAI = { "@@000000021": "PIXA", "@@000000013": "PXS", "@@000000037": "VESTS" };
  function parseAsset(a) {
    if (a == null) return null;
    if (typeof a === "string") { var p = a.trim().split(/\s+/); return { amount: Number(p[0]), symbol: p[1] }; }
    return { amount: Number(a.amount) / Math.pow(10, a.precision), symbol: NAI[a.nai] || a.nai };
  }
  function parseUtc(ts) { if (!ts) return NaN; return Date.parse(/Z$/.test(ts) ? ts : ts + "Z"); }
  function isEpoch(ts) { return !ts || ts.indexOf("1970-01-01") === 0; }
  function fmtInt(n) { return Math.round(n).toLocaleString("en-US"); }
  function fmtNum(n, d) { return Number(n).toLocaleString("en-US", { minimumFractionDigits: d == null ? 0 : d, maximumFractionDigits: d == null ? 2 : d }); }
  function ago(sec) {
    if (sec == null || isNaN(sec)) return "a moment";
    if (sec < 1) return "1 s";
    if (sec < 60) return Math.round(sec) + " s";
    if (sec < 3600) return Math.round(sec / 60) + " min";
    if (sec < 86400 * 2) return (sec / 3600).toFixed(sec < 36000 ? 1 : 0).replace(/\.0$/, "") + " h";
    return Math.round(sec / 86400) + " d";
  }
  function fmtBytes(b) {
    if (b < 1e9) { var mb = b / 1e6; return (mb < 10 ? mb.toFixed(1).replace(/\.0$/, "") : Math.round(mb)) + " MB"; }
    if (b < 1e12) { var g = b / 1e9; return (g < 10 ? g.toFixed(1) : Math.round(g)) + " GB"; }
    return (b / 1e12).toFixed(1) + " TB";
  }
  function fmtDate(iso) {
    var d = new Date(parseUtc(iso)); if (isNaN(d)) return "—";
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) + ", " + d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) + " local";
  }
  function fmtUtcTime(ms) { var d = new Date(ms); return d.toISOString().slice(11, 19) + " UTC"; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function icon(name, cls) { return '<svg class="icon' + (cls ? " " + cls : "") + '" aria-hidden="true"><use href="' + ROOT + 'assets/icons.svg#' + name + '"/></svg>'; }

  /* ---------- copy buttons on every code block ---------- */
  function copyButtons() {
    document.querySelectorAll("pre").forEach(function (pre) {
      if (pre.querySelector("button.copy") || pre.closest(".no-copy")) return;
      var b = document.createElement("button");
      b.type = "button"; b.className = "copy";
      b.innerHTML = icon("content_copy") + "<span>Copy</span>";
      var label = b.querySelector("span");
      b.addEventListener("click", function () {
        var code = pre.querySelector("code"), t = (code || pre).innerText;
        if (!code) t = t.replace(/\s*Copy(ied)?\s*$/, "");
        (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(function () {
          label.textContent = "Copied"; b.querySelector("use").setAttribute("href", ROOT + "assets/icons.svg#check");
          setTimeout(function () { label.textContent = "Copy"; b.querySelector("use").setAttribute("href", ROOT + "assets/icons.svg#content_copy"); }, 1600);
        }, function () { label.textContent = "Select and copy"; setTimeout(function () { label.textContent = "Copy"; }, 2000); });
      });
      pre.classList.add("has-copy");
      pre.appendChild(b);
    });
  }

  /* ---------- app bar: a hairline once the page scrolls ---------- */
  function appbar() {
    var bar = $("appbar"); if (!bar) return;
    var f = function () { bar.classList.toggle("scrolled", window.scrollY > 4); };
    window.addEventListener("scroll", f, { passive: true }); f();
  }

  /* ---------- contents: mobile copy + current section ---------- */
  function contents() {
    var tocm = $("tocm"), rail = document.querySelector(".rail ol");
    if (tocm && rail && !tocm.firstChild) tocm.appendChild(rail.cloneNode(true));
    var links = document.querySelectorAll(".rail a[href^='#'], .otp a[href^='#']");
    if (!("IntersectionObserver" in window) || !links.length) return;
    var map = {}; links.forEach(function (a) { var id = decodeURIComponent(a.getAttribute("href").slice(1)); (map[id] = map[id] || []).push(a); });
    var targets = Object.keys(map).map(function (id) { return document.getElementById(id); }).filter(Boolean);
    var visible = {};
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { visible[e.target.id] = e.isIntersecting; });
      var current = null;
      for (var i = 0; i < targets.length; i++) { if (visible[targets[i].id]) { current = targets[i].id; break; } }
      if (!current) return;
      links.forEach(function (a) { a.classList.remove("on"); });
      map[current].forEach(function (a) { a.classList.add("on"); });
    }, { rootMargin: "-80px 0px -55% 0px", threshold: 0 });
    targets.forEach(function (t) { io.observe(t); });
  }

  /* ---------- one poller for the chain head ---------- */
  var dgpTimer = null;
  function startPolling(every) {
    function tick() {
      rpc("condenser_api.get_dynamic_global_properties").then(function (d) { emit("dgp", d); }).catch(function (e) { emit("dgp-error", e); });
    }
    tick(); dgpTimer = setInterval(function () { if (!document.hidden) tick(); }, every);
    document.addEventListener("visibilitychange", function () { if (!document.hidden) tick(); });
  }

  /* ---------- footer: one live line on every page ---------- */
  function footerLive() {
    var el = $("footlive"); if (!el) return;
    var txt = el.querySelector("span"), head = null, time = null;
    function paint() {
      if (head == null) return;
      var sec = (Date.now() - parseUtc(time)) / 1000;
      txt.textContent = "Block " + fmtInt(head) + ", " + ago(sec) + " ago";
      el.classList.toggle("ok", sec < 30);
    }
    on("dgp", function (d) { head = d.head_block_number; time = d.time; paint(); });
    on("dgp-error", function () { if (head == null) { txt.textContent = "api.pixagram.com is not reachable from this page"; el.classList.remove("ok"); } });
    setInterval(paint, 1000);
  }

  /* ---------- the live chain card: one pixel per block ----------
     Colour is the block's place in the witness schedule, so one spectrum is one round
     and every witness signs once in it. A hollow pixel is a slot nobody filled. */
  // the seven colours of the spectrum in site.css (--s1 … --s7), blended for N places
  var SPECTRUM = [[255, 59, 71], [255, 138, 31], [255, 210, 31], [43, 212, 107], [31, 200, 232], [61, 107, 255], [166, 77, 255]];
  function hueFor(pos, n) {
    var f = (n > 1 ? pos / (n - 1) : 0) * (SPECTRUM.length - 1), i = Math.min(SPECTRUM.length - 2, Math.floor(f)), t = f - i;
    var a = SPECTRUM[i], b = SPECTRUM[i + 1];
    return "rgb(" + [0, 1, 2].map(function (k) { return Math.round(a[k] + (b[k] - a[k]) * t); }).join(",") + ")";
  }
  function chainCard(el) {
    var ribbon = el.querySelector(".ribbon"), tip = el.querySelector(".ribbon-tip");
    var F = {}; el.querySelectorAll("[data-k]").forEach(function (n) { F[n.getAttribute("data-k")] = n; });
    var snap = {}; try { snap = JSON.parse(el.querySelector("script[type='application/json']").textContent); } catch (e) {}
    var S = { head: snap.head || 0, time: snap.time, witness: snap.witness, n: snap.n || 21, shuffle: snap.shuffle || 0, feed: snap.feed, items: [], ok: false, last: 0 };
    // snapshot blocks: [first block number, first timestamp, names[], sequence of name indexes, -1 = missed slot]
    if (snap.blocks) {
      var b = snap.blocks, num = b[0], t = parseUtc(b[1]);
      b[3].forEach(function (k) {
        if (k < 0) { S.items.push({ miss: true, t: t }); t += 3000; return; }
        S.items.push({ num: num, w: b[2][k], t: t }); num++; t += 3000;
      });
      S.last = num - 1;
    }
    function set(k, v) { if (F[k]) F[k].textContent = v; }
    function capacity() {
      var cs = getComputedStyle(ribbon), px = parseFloat(cs.getPropertyValue("--px")) || 20, gap = parseFloat(cs.getPropertyValue("--gap")) || 4;
      var per = Math.max(1, Math.floor((ribbon.clientWidth + gap) / (px + gap)));
      return per * (+ribbon.getAttribute("data-rows") || 3);
    }
    function cell(it) {
      var s = document.createElement("span");
      s.className = "b" + (it.miss ? " miss" : "");
      if (!it.miss) { s.style.setProperty("--c", hueFor(((it.num - S.shuffle) % S.n + S.n) % S.n, S.n)); s.dataset.num = it.num; s.dataset.w = it.w; }
      s.dataset.t = it.t;
      return s;
    }
    function render(fresh) {
      var cap = capacity(), list = S.items.slice(-cap);
      if (!fresh || ribbon.children.length !== Math.min(cap, S.items.length - fresh) ) {
        ribbon.textContent = "";
        list.forEach(function (it) { ribbon.appendChild(cell(it)); });
      } else {
        list.slice(-fresh).forEach(function (it) { var c = cell(it); c.classList.add("fresh"); ribbon.appendChild(c); });
        while (ribbon.children.length > cap) ribbon.removeChild(ribbon.firstChild);
      }
      var prev = ribbon.querySelector(".head"); if (prev) prev.classList.remove("head");
      var last = ribbon.lastElementChild; if (last && !last.classList.contains("miss")) last.classList.add("head");
      ribbon.setAttribute("aria-label", "The last " + list.length + " slots of the chain, one square per block, newest last.");
    }
    function paint() {
      set("head", fmtInt(S.head)); set("witness", S.witness || "—"); set("n", S.n);
      if (S.feed != null) set("feed", S.feed);
      if (S.time) set("age", ago((Date.now() - parseUtc(S.time)) / 1000));
    }
    // tooltip
    function point(e) {
      var c = e.target.closest(".b"); if (!c || !tip) { if (tip) tip.classList.remove("on"); return; }
      var t = +c.dataset.t;
      tip.textContent = c.classList.contains("miss") ? "Missed slot, " + fmtUtcTime(t) : "Block " + fmtInt(+c.dataset.num) + ", signed by " + c.dataset.w + " at " + fmtUtcTime(t);
      var r = ribbon.getBoundingClientRect(), cr = c.getBoundingClientRect();
      var x = cr.left - r.left + cr.width / 2, w = tip.offsetWidth / 2;
      tip.style.left = Math.max(w, Math.min(r.width - w, x)) + "px"; tip.style.top = (cr.top - r.top) + "px";
      tip.classList.add("on");
    }
    ribbon.addEventListener("pointermove", point);
    ribbon.addEventListener("pointerdown", point);
    ribbon.addEventListener("pointerleave", function (e) { if (tip && e.pointerType === "mouse") tip.classList.remove("on"); });
    document.addEventListener("pointerdown", function (e) { if (tip && !ribbon.contains(e.target)) tip.classList.remove("on"); });

    function addHeaders(from, to) {
      var calls = [];
      for (var k = from; k <= to; k++) calls.push({ method: "block_api.get_block_header", params: { block_num: k } });
      return rpcBatch(calls).then(function (res) {
        var added = 0;
        res.results.forEach(function (r, i) {
          if (!r.result || !r.result.header) return;
          var h = r.result.header, t = parseUtc(h.timestamp), prev = S.items[S.items.length - 1];
          if (prev && prev.t) {
            var missed = Math.min(12, Math.round((t - prev.t) / 3000) - 1);
            for (var m = 1; m <= missed; m++) { S.items.push({ miss: true, t: prev.t + m * 3000 }); added++; }
          }
          S.items.push({ num: from + i, w: h.witness, t: t }); added++;
        });
        S.last = to;
        if (S.items.length > 600) S.items.splice(0, S.items.length - 600);
        return added;
      });
    }
    var busy = false;
    on("dgp", function (d) {
      S.head = d.head_block_number; S.time = d.time; S.witness = d.current_witness;
      if (!S.ok) { S.ok = true; set("stamp", "Live from api.pixagram.com: a new block every three seconds."); }
      paint();
      if (busy || S.head <= S.last) return;
      busy = true;
      var cap = capacity(), from = Math.max(S.last + 1, S.head - cap - 4 + 1);
      if (S.head - S.last > cap + 4) S.items = [];   // far behind the snapshot: start over
      addHeaders(from, S.head).then(function (added) { render(S.items.length > added ? added : 0); })
        .catch(function () {}).then(function () { busy = false; });
    });
    function slow() {
      rpc("condenser_api.get_witness_schedule").then(function (s) {
        var changed = s.num_scheduled_witnesses !== S.n || s.next_shuffle_block_num % s.num_scheduled_witnesses !== S.shuffle % S.n;
        S.n = s.num_scheduled_witnesses || S.n; S.shuffle = s.next_shuffle_block_num || S.shuffle;
        emit("schedule", s); paint(); if (changed) render(0);
      }).catch(function () {});
      rpc("condenser_api.get_current_median_history_price").then(function (p) {
        var q = parseFloat(p.quote), b = parseFloat(p.base); if (q && b) { S.feed = fmtNum(q / b, 3).replace(/\.?0+$/, ""); paint(); }
      }).catch(function () {});
    }
    var rw = 0;
    window.addEventListener("resize", function () { var w = ribbon.clientWidth; if (w !== rw) { rw = w; render(0); } });
    render(0); paint(); slow();
    setInterval(slow, 60000);
    setInterval(function () { if (S.time) set("age", ago((Date.now() - parseUtc(S.time)) / 1000)); }, 1000);
  }

  /* ---------- wiki: drawer, current page, wide diagrams ---------- */
  function wiki() {
    var btn = document.querySelector(".drawer-btn"), drawer = $("drawer"), scrim = document.querySelector(".scrim");
    if (drawer) {
      var cur = drawer.querySelector("[aria-current='page']");
      if (cur && drawer.scrollHeight > drawer.clientHeight) drawer.scrollTop = Math.max(0, cur.offsetTop - drawer.clientHeight / 3);
    }
    function close() { document.body.classList.remove("drawer-open"); if (btn) { btn.setAttribute("aria-expanded", "false"); } }
    if (btn && drawer) {
      btn.addEventListener("click", function () {
        var open = !document.body.classList.contains("drawer-open");
        document.body.classList.toggle("drawer-open", open); btn.setAttribute("aria-expanded", String(open));
        if (open) { var f = drawer.querySelector("[aria-current='page']") || drawer.querySelector("a"); if (f) f.focus({ preventScroll: false }); }
      });
      if (scrim) scrim.addEventListener("click", close);
      drawer.querySelectorAll(".drawer-close").forEach(function (b) { b.addEventListener("click", function () { close(); btn.focus(); }); });
      document.addEventListener("keydown", function (e) { if (e.key === "Escape" && document.body.classList.contains("drawer-open")) { close(); btn.focus(); } });
    }
    function wide(first) {
      document.querySelectorAll(".diagram").forEach(function (d) {
        var over = d.scrollWidth > d.clientWidth + 2;
        d.classList.toggle("wide", over);
        if (over && first === true) d.scrollLeft = (d.scrollWidth - d.clientWidth) / 2;  // start from the middle
      });
    }
    wide(true); window.addEventListener("resize", wide);
  }

  /* ---------- a region that scrolls sideways can be scrolled from the keyboard ---------- */
  function scrollers() {
    function heading(el) { // the nearest heading before el, for a label people can tell apart
      for (var n = el; n && n !== document.body; n = n.parentElement) {
        for (var p = n.previousElementSibling; p; p = p.previousElementSibling) {
          if (/^H[1-4]$/.test(p.tagName)) return p.textContent.trim();
          var h = p.querySelectorAll && p.querySelectorAll("h1, h2, h3, h4"); if (h && h.length) return h[h.length - 1].textContent.trim();
        }
      }
      return "";
    }
    function mark() {
      var used = {};
      document.querySelectorAll(".table-wrap, .diagram").forEach(function (el) {
        var over = el.scrollWidth > el.clientWidth + 2;
        if (over) {
          var kind = el.classList.contains("diagram") ? "Diagram" : "Table", base = kind + (heading(el) ? ": " + heading(el) : ""), label = base, k = 2;
          while (used[label]) label = base + " (" + (k++) + ")";
          used[label] = 1;
          el.setAttribute("tabindex", "0"); el.setAttribute("aria-label", label + ", scrolls sideways");
          if (kind === "Table") el.setAttribute("role", "region");   // a figure keeps its own role
          el.dataset.scroller = "1";
        } else if (el.dataset.scroller) { el.removeAttribute("tabindex"); el.removeAttribute("role"); el.removeAttribute("aria-label"); delete el.dataset.scroller; }
      });
    }
    mark(); window.addEventListener("resize", mark);
  }

  /* ---------- search: the whole wiki, in the browser ---------- */
  var SR = { data: null, loading: null, sel: 0, hits: [], el: null };
  function norm(s) { return String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, ""); }
  function loadIndex() {
    if (SR.loading) return SR.loading;
    SR.loading = fetch(ROOT + "wiki/search-index.json").then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); }).then(function (d) {
      d.pages.forEach(function (p) { p.nt = norm(p[0]); });
      d.chunks = d.chunks.map(function (c) { return { p: c[0], h: c[1], a: c[2], x: c[3], nh: norm(c[1]), nx: norm(c[3]) }; });
      SR.data = d; return d;
    });
    SR.loading.catch(function () { SR.loading = null; });
    return SR.loading;
  }
  function startsWord(s, i) { return i === 0 || /[^a-z0-9]/.test(s.charAt(i - 1)); }
  function find(q) {
    var d = SR.data, terms = norm(q).split(/[^a-z0-9_.@]+/).map(function (t) { return t.replace(/^[._@]+|[._@]+$/g, ""); }).filter(function (t) { return t.length > 0; });
    if (!terms.length) return [];
    var phrase = norm(q).trim(), scored = [];
    d.chunks.forEach(function (c, ci) {
      var title = d.pages[c.p].nt, score = 0;
      for (var k = 0; k < terms.length; k++) {
        var t = terms[k], s = 0, i;
        if ((i = title.indexOf(t)) >= 0) s += 6 + (startsWord(title, i) ? 4 : 0);
        if ((i = c.nh.indexOf(t)) >= 0) s += 5 + (startsWord(c.nh, i) ? 3 : 0);
        if ((i = c.nx.indexOf(t)) >= 0) {
          var n = 0, j = i; while (j >= 0 && n < 6) { n++; j = c.nx.indexOf(t, j + t.length); }
          s += 1 + n * .5 + (startsWord(c.nx, i) ? 1 : 0);
        }
        if (!s) return;
        score += s;
      }
      if (terms.length > 1 && (c.nx.indexOf(phrase) >= 0 || c.nh.indexOf(phrase) >= 0 || title.indexOf(phrase) >= 0)) score += 10;
      if (!c.a) score += 1.5;
      scored.push({ ci: ci, s: score });
    });
    scored.sort(function (a, b) { return b.s - a.s; });
    var per = {}, out = [];
    for (var i = 0; i < scored.length && out.length < 24; i++) {
      var c = d.chunks[scored[i].ci]; per[c.p] = (per[c.p] || 0) + 1;
      if (per[c.p] <= 2) out.push(c);
    }
    return { hits: out, terms: terms };
  }
  function highlight(text, terms) {
    var re = new RegExp("(" + terms.map(function (t) { return t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }).join("|") + ")", "gi");
    return text.split(re).map(function (part, i) { return i % 2 ? "<mark>" + esc(part) + "</mark>" : esc(part); }).join("");
  }
  function snippet(text, terms) {
    var low = text.toLowerCase(), at = -1;
    terms.forEach(function (t) { var i = low.indexOf(t); if (i >= 0 && (at < 0 || i < at)) at = i; });
    if (at < 0) at = 0;
    var start = Math.max(0, at - 70), end = Math.min(text.length, start + 200);
    if (start > 0) { var sp = text.indexOf(" ", start); if (sp > 0 && sp < at) start = sp + 1; }
    return (start > 0 ? "…" : "") + text.slice(start, end).trim() + (end < text.length ? "…" : "");
  }
  function buildSearch() {
    var wrap = document.createElement("div");
    wrap.className = "search"; wrap.setAttribute("role", "dialog"); wrap.setAttribute("aria-modal", "true"); wrap.setAttribute("aria-label", "Search the wiki");
    wrap.innerHTML = '<div class="search-scrim"></div><div class="search-box">' +
      '<div class="search-field">' + icon("search") + '<input type="search" id="search-q" placeholder="Search the wiki" autocomplete="off" spellcheck="false" aria-controls="search-results" aria-autocomplete="list"><button type="button" class="icon-btn search-close" aria-label="Close search">' + icon("close") + '</button></div>' +
      '<div class="search-results" id="search-results" role="listbox" aria-label="Results"></div>' +
      '<div class="search-foot"><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>Enter</kbd> open</span><span><kbd>Esc</kbd> close</span></div></div>';
    document.body.appendChild(wrap);
    var input = wrap.querySelector("input"), list = wrap.querySelector(".search-results");
    function hint(html) { list.innerHTML = '<div class="search-empty">' + html + '</div>'; }
    function run() {
      var q = input.value.trim();
      if (!SR.data) { hint("<p>Loading the index…</p>"); return; }
      if (!q) { hint("<p>Type a word or an API method, for example <b>witness</b>, <b>haircut</b> or <b>get_accounts</b>.</p><p>" + SR.data.pages.length + " pages, searched in your browser.</p>"); SR.hits = []; return; }
      var r = find(q); SR.hits = r.hits || []; SR.sel = 0;
      if (!SR.hits.length) { hint("<p>Nothing in the wiki matches <b>" + esc(q) + "</b>.</p><p>Try one word, or browse from <a href=\"" + ROOT + "wiki/index.html\">the wiki home</a>.</p>"); return; }
      list.innerHTML = SR.hits.map(function (c, i) {
        var p = SR.data.pages[c.p], url = ROOT + "wiki/" + p[2] + (c.a ? "#" + c.a : "");
        return '<a class="r' + (i === 0 ? " sel" : "") + '" role="option" id="sr-' + i + '" href="' + esc(url) + '"><span class="t">' + highlight(c.h || p[0], r.terms) + '</span><span class="p">' + esc(p[1]) + (c.h ? " › " + esc(p[0]) : "") + '</span><span class="x">' + highlight(snippet(c.x, r.terms), r.terms) + "</span></a>";
      }).join("");
      input.setAttribute("aria-activedescendant", "sr-0");
    }
    function move(dir) {
      var items = list.querySelectorAll(".r"); if (!items.length) return;
      items[SR.sel].classList.remove("sel");
      SR.sel = (SR.sel + dir + items.length) % items.length;
      items[SR.sel].classList.add("sel"); items[SR.sel].scrollIntoView({ block: "nearest" });
      input.setAttribute("aria-activedescendant", "sr-" + SR.sel);
    }
    input.addEventListener("input", run);
    input.addEventListener("keydown", function (e) {
      if (e.key === "ArrowDown") { e.preventDefault(); move(1); }
      else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
      else if (e.key === "Enter") { var a = list.querySelectorAll(".r")[SR.sel]; if (a) { e.preventDefault(); closeSearch(); location.href = a.href; } }
    });
    list.addEventListener("click", function (e) { if (e.target.closest("a")) closeSearch(); });
    wrap.querySelector(".search-scrim").addEventListener("click", closeSearch);
    wrap.querySelector(".search-close").addEventListener("click", closeSearch);
    wrap.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { e.preventDefault(); closeSearch(); }
      if (e.key === "Tab") { // keep focus inside the dialog
        var f = wrap.querySelectorAll("input, button, a.r"), first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });
    SR.el = wrap; SR.run = run; SR.input = input;
    return wrap;
  }
  var lastFocus = null;
  function openSearch() {
    var w = SR.el || buildSearch();
    lastFocus = document.activeElement;
    w.classList.add("open"); document.documentElement.style.overflow = "hidden";
    SR.input.focus(); SR.input.select(); SR.run();
    loadIndex().then(function () { SR.run(); }, function () {
      SR.el.querySelector(".search-results").innerHTML = '<div class="search-empty"><p>The search index did not load.</p><p>Check your connection and reload the page, or browse from <a href="' + ROOT + 'wiki/index.html">the wiki home</a>.</p></div>';
    });
  }
  function closeSearch() {
    if (!SR.el) return;
    SR.el.classList.remove("open"); document.documentElement.style.overflow = "";
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  function searchKeys() {
    document.querySelectorAll("[data-search-open]").forEach(function (b) { b.addEventListener("click", function (e) { e.preventDefault(); openSearch(); }); });
    document.addEventListener("keydown", function (e) {
      var t = e.target, typing = t && (t.isContentEditable || /^(input|textarea|select)$/i.test(t.tagName));
      if ((e.key === "/" && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k")) {
        if (SR.el && SR.el.classList.contains("open")) return;
        e.preventDefault(); openSearch();
      }
    });
    if (/[?&]search=1/.test(location.search)) openSearch();
  }

  document.addEventListener("DOMContentLoaded", function () {
    appbar(); copyButtons(); contents(); footerLive(); wiki(); scrollers(); searchKeys();
    var cards = document.querySelectorAll("[data-chain]");
    cards.forEach(chainCard);
    startPolling(cards.length ? 3000 : 6000);
  });

  window.PIXA = { CONFIG: CONFIG, rpc: rpc, rpcBatch: rpcBatch, on: on, emit: emit, parseAsset: parseAsset, parseUtc: parseUtc, isEpoch: isEpoch, fmtInt: fmtInt, fmtNum: fmtNum, fmtBytes: fmtBytes, fmtDate: fmtDate, ago: ago, esc: esc, $: $, openSearch: openSearch };
})();
