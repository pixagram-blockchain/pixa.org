/* pixa.org — shared script. No dependencies, no build step. */
(function () {
  "use strict";

  /* ---------- site configuration (edit here, nothing else) ---------- */
  var CONFIG = {
    node: "https://api.pixagram.com",
    nodes: [
      { url: "https://api.pixagram.com", where: "Warsaw", note: "also the P2P seed, port 2001" },
      { url: "https://merlion.surf", where: "Singapore", note: "" },
      { url: "https://blockforge.lol", where: "France", note: "" },
      { url: "https://pixarex.net", where: "Iowa, United States", note: "" }
    ],
    github: "https://github.com/pixagram-blockchain",
    githubOrg: "pixagram-blockchain",
    linkedin: "https://www.linkedin.com/company/pixagram",   // ← confirm the company page slug
    app: "https://pixagram.com",
    canary: "https://pixagram.dev",
    status: "https://pixagram.com/witness-status/",
    statusJson: "https://raw.githubusercontent.com/pixagram-blockchain/witness-status/data/status.json",
    skillRaw: "https://raw.githubusercontent.com/pixagram-blockchain/pixagram-skill/main/SKILL.md",
    hfSpace: "https://huggingface.co/spaces/primerz/face-to-pixel-art-4K"
  };

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
    if (sec == null || isNaN(sec)) return "—";
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
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function $(id) { return document.getElementById(id); }

  /* ---------- copy buttons on every <pre> ---------- */
  function copyButtons() {
    document.querySelectorAll("pre").forEach(function (pre) {
      if (pre.querySelector("button.copy")) return;
      var b = document.createElement("button");
      b.type = "button"; b.className = "copy"; b.textContent = "Copy";
      b.addEventListener("click", function () {
        var t = pre.querySelector("code") ? pre.querySelector("code").innerText : pre.innerText;
        (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(function () {
          b.textContent = "Copied"; setTimeout(function () { b.textContent = "Copy"; }, 1500);
        }, function () { b.textContent = "Select and copy"; setTimeout(function () { b.textContent = "Copy"; }, 2000); });
      });
      pre.appendChild(b);
    });
  }

  /* ---------- current page in the menu ---------- */
  function markNav() {
    var here = location.pathname.split("/").pop() || "index.html";
    document.querySelectorAll(".top nav a").forEach(function (a) {
      var href = (a.getAttribute("href") || "").split("#")[0];
      if (href === here || (here === "index.html" && (href === "" || href === "./" || href === "index.html"))) a.setAttribute("aria-current", "page");
    });
  }

  /* ---------- mobile contents + current section ---------- */
  function contents() {
    var tocm = $("tocm"), toc = document.querySelector("aside.toc ol");
    if (tocm && toc && !tocm.firstChild) tocm.appendChild(toc.cloneNode(true));
    var links = document.querySelectorAll("aside.toc a");
    if ("IntersectionObserver" in window && links.length) {
      var map = {}; links.forEach(function (a) { map[a.getAttribute("href").slice(1)] = a; });
      var current = null;
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) { if (e.isIntersecting) current = e.target.id; });
        if (current && map[current]) { links.forEach(function (a) { a.classList.remove("on"); }); map[current].classList.add("on"); }
      }, { rootMargin: "-20% 0px -60% 0px", threshold: 0 });
      document.querySelectorAll("main section[id]").forEach(function (s) { io.observe(s); });
    }
  }

  /* ---------- footer: one live line on every page ---------- */
  function footerLive() {
    var el = $("footlive"); if (!el) return;
    var head = null, time = null;
    function paint() {
      if (head == null) return;
      var sec = (Date.now() - parseUtc(time)) / 1000;
      el.textContent = "Block " + fmtInt(head) + ", " + ago(sec) + " ago";
      el.classList.toggle("ok", sec < 30);
    }
    function tick() {
      rpc("condenser_api.get_dynamic_global_properties", []).then(function (d) { head = d.head_block_number; time = d.time; paint(); }).catch(function () { el.textContent = "api.pixagram.com not reachable from this page"; el.classList.remove("ok"); });
    }
    tick(); setInterval(tick, 6000); setInterval(paint, 1000);
    document.addEventListener("visibilitychange", function () { if (!document.hidden) tick(); });
  }

  document.addEventListener("DOMContentLoaded", function () { markNav(); copyButtons(); contents(); footerLive(); });

  window.PIXA = { CONFIG: CONFIG, rpc: rpc, rpcBatch: rpcBatch, parseAsset: parseAsset, parseUtc: parseUtc, isEpoch: isEpoch, fmtInt: fmtInt, fmtNum: fmtNum, fmtBytes: fmtBytes, fmtDate: fmtDate, ago: ago, esc: esc, $: $ };
})();
