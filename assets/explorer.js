/* pixa.org — the explorer.

     /explorer/                      the live chain and the latest blocks
     /explorer/{block}               one block, its transactions and virtual operations
     /explorer/{block}/{trx_id}      one transaction in that block
     /explorer/{trx_id}              finds the block, then shows the transaction

   A static host has no routes: a deep link lands on 404.html, which hands the path to
   /explorer/?r=…; this script puts the address back and renders it. Everything shown is
   read from api.pixagram.com by the browser and treated as untrusted text. */
(function () {
  "use strict";
  var P = window.PIXA, esc = P.esc, fmtInt = P.fmtInt, $ = P.$;
  var BASE = "/explorer/";
  var view = $("xp-view"), titleEl = $("xp-title"), leadEl = $("xp-lead"), crumbsEl = $("xp-crumbs"), actionsEl = $("xp-actions");
  var form = $("xp-search"), input = $("xp-q"), msg = $("xp-msg");
  var chainSec = document.querySelector("[data-chain]");
  var S = { dgp: null, schedule: null, token: 0, latest: [], latestBusy: false, ops: null, copies: {}, copyN: 0 };

  /* ---------- routes ---------- */
  function parse(path) {
    path = path.replace(/\/index\.html$/, "/");
    var m = path.match(/^\/explorer\/?(?:([0-9a-fA-F]{40})|([0-9]{1,10})(?:\/([0-9a-fA-F]{40}))?)?\/?$/);
    if (!m) return { kind: "bad" };
    if (m[1]) return { kind: "find", id: m[1].toLowerCase() };
    if (!m[2]) return { kind: "home" };
    var n = parseInt(m[2], 10);
    return m[3] ? { kind: "tx", block: n, id: m[3].toLowerCase() } : { kind: "block", block: n };
  }
  (function restore() {  // 404.html sent us here with ?r=<the rest of the path>
    var q = new URLSearchParams(location.search), r = q.get("r");
    if (r != null) history.replaceState(null, "", BASE + r.replace(/^\/+|\/+$/g, "") + location.hash);
  })();
  function go(url, replace) {
    history[replace ? "replaceState" : "pushState"](null, "", url);
    render();
    var html = document.documentElement, was = html.style.scrollBehavior;
    html.style.scrollBehavior = "auto"; window.scrollTo(0, 0); html.style.scrollBehavior = was;
  }
  P.navigate = function (url) { go(url); };
  document.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest("a[href]");
    if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || a.target || a.hasAttribute("download")) return;
    var u = new URL(a.getAttribute("href"), location.href);
    if (u.origin !== location.origin || !/^\/explorer(\/|$)/.test(u.pathname) || /\.(json|svg)$/.test(u.pathname)) return;
    e.preventDefault();
    go(u.pathname + u.hash);
  });
  window.addEventListener("popstate", render);

  /* ---------- search ---------- */
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var q = input.value.trim().replace(/[\s,_']/g, "");
    say("");
    if (!q) { say("Enter a block number, such as " + fmtInt(S.dgp ? S.dgp.head_block_number : 1000000) + ", or a transaction id."); return; }
    if (/^#?\d{1,10}$/.test(q)) { go(BASE + q.replace("#", "")); return; }
    if (/^[0-9a-fA-F]{40}$/.test(q)) { go(BASE + q.toLowerCase()); return; }
    var acct = q.replace(/^@/, "").toLowerCase();
    if (/^[a-z][a-z0-9.-]{2,15}$/.test(acct)) {
      say('The explorer looks up blocks and transactions. To see the account ' + esc(acct) + ', open <a href="https://pixagram.com/@' + esc(acct) + '">pixagram.com/@' + esc(acct) + "</a>.", true);
      return;
    }
    say("Enter a block number, or a transaction id of 40 hexadecimal characters.");
  });
  function say(text, html) { msg[html ? "innerHTML" : "textContent"] = text; }

  /* ---------- data ---------- */
  function batch(calls) {
    return P.rpcBatch(calls).then(function (r) { return r.results; });
  }
  function loadOps() {  // what each operation does, from the wiki's Operations Reference
    if (S.ops) return Promise.resolve(S.ops);
    return fetch("/wiki/ops.json").then(function (r) { return r.ok ? r.json() : {}; }).catch(function () { return {}; })
      .then(function (o) { S.ops = o || {}; return S.ops; });
  }
  P.on("dgp", function (d) { S.dgp = d; onHead(); });
  P.on("schedule", function (s) { S.schedule = s; });

  /* ---------- formatting ---------- */
  var ACCOUNT = /^[a-z][a-z0-9.-]{2,15}$/;
  function acct(name) {
    if (typeof name !== "string" || !name) return "";
    return ACCOUNT.test(name) ? '<a class="acct" href="https://pixagram.com/@' + esc(name) + '">' + esc(name) + "</a>" : esc(name);
  }
  function post(author, permlink) { return acct(author) + "/" + esc(cut(String(permlink || ""), 48)); }
  function cut(s, n) { s = String(s); return s.length > n ? s.slice(0, n - 1) + "…" : s; }
  function amt(a) {
    if (a == null) return "";
    if (typeof a === "object" && a.amount != null) { var x = P.parseAsset(a); return esc(x.amount.toFixed(a.precision) + " " + x.symbol); }
    return '<span class="num">' + esc(String(a)) + "</span>";
  }
  function zero(a) { return a == null || parseFloat(typeof a === "object" ? a.amount : a) === 0; }
  function blockHref(n) { return BASE + n; }
  function utc(ts) { return esc(String(ts || "").replace("T", " ")) + " UTC"; }
  function ago(ts) { return P.ago((Date.now() - P.parseUtc(ts)) / 1000) + " ago"; }
  function icon(name) { return '<svg class="icon" aria-hidden="true"><use href="/assets/icons.svg#' + name + '"/></svg>'; }
  function copyBtn(text, label) {
    var k = "c" + (++S.copyN); S.copies[k] = text;
    return '<button class="icon-btn xp-copy" type="button" data-copy-key="' + k + '" aria-label="' + esc(label || "Copy") + '" title="' + esc(label || "Copy") + '">' + icon("content_copy") + "</button>";
  }
  view.addEventListener("click", function (e) {
    var b = e.target.closest("[data-copy-key]"); if (!b) return;
    var text = S.copies[b.getAttribute("data-copy-key")], use = b.querySelector("use"), href = use.getAttribute("href");
    (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(function () {
      use.setAttribute("href", href.replace(/#.*/, "#check"));
      setTimeout(function () { use.setAttribute("href", href); }, 1400);
    }, function () {});
  });
  function json(obj) {  // pretty JSON for reading: long strings are shortened, the copy keeps them whole
    return JSON.stringify(obj, function (k, v) {
      if (typeof v === "string" && v.length > 320) return v.slice(0, 120) + "… (" + fmtInt(v.length) + " characters)";
      return v;
    }, 2);
  }
  function jsonBlock(label, obj) {
    var full = JSON.stringify(obj, null, 2);
    return '<details class="xp-json"><summary>' + icon("code") + "<span>" + esc(label) + "</span>" + icon("keyboard_arrow_down") + "</summary>" +
      '<div class="xp-json-body"><div class="xp-json-bar"><span>' + fmtInt(full.length) + ' characters</span><button class="btn text small" type="button" data-copy-key="' +
      (function () { var k = "c" + (++S.copyN); S.copies[k] = full; return k; })() + '">' + icon("content_copy") + "Copy JSON</button></div>" +
      '<pre class="no-copy" tabindex="0" aria-label="' + esc(label) + '"><code>' + esc(json(obj)) + "</code></pre></div></details>";
  }

  /* ---------- artworks: the checks the app applies before it shows one ---------- */
  // Spec: wiki/developers/artwork-encoding-spec.html#reading-an-artwork
  function artwork(body) {
    if (typeof body !== "string") return null;
    var b = body.trim(), m = b.match(/^data:image\/(webp|png|gif);base64,([A-Za-z0-9+/]+={0,2})$/);
    if (!m || b.length > 7000000 || m[2].length % 4) return null;
    var head;
    try { head = atob(m[2].slice(0, 44)); } catch (e) { return null; }
    var bytes = function (i, n) { var s = ""; for (var k = 0; k < n; k++) s += head.charAt(i + k); return s; };
    var u8 = function (i) { return head.charCodeAt(i) & 255; };
    var w = 0, h = 0, kind = m[1];
    if (kind === "webp") {
      if (bytes(0, 4) !== "RIFF" || bytes(8, 4) !== "WEBP") return null;
      var chunk = bytes(12, 4);
      if (chunk === "VP8L") { var bits = u8(21) | (u8(22) << 8) | (u8(23) << 16) | (u8(24) << 24); w = (bits & 0x3FFF) + 1; h = ((bits >>> 14) & 0x3FFF) + 1; kind = "lossless WebP"; }
      else if (chunk === "VP8X") { w = 1 + (u8(24) | (u8(25) << 8) | (u8(26) << 16)); h = 1 + (u8(27) | (u8(28) << 8) | (u8(29) << 16)); kind = "WebP"; }
      else if (chunk === "VP8 ") { w = (u8(26) | (u8(27) << 8)) & 0x3FFF; h = (u8(28) | (u8(29) << 8)) & 0x3FFF; kind = "lossy WebP"; }
      else return null;
    } else if (kind === "png") {
      if (bytes(1, 3) !== "PNG") return null;
      w = (u8(16) << 24 | u8(17) << 16 | u8(18) << 8 | u8(19)) >>> 0; h = (u8(20) << 24 | u8(21) << 16 | u8(22) << 8 | u8(23)) >>> 0; kind = "PNG";
    } else {
      if (bytes(0, 4) !== "GIF8") return null;
      w = u8(6) | (u8(7) << 8); h = u8(8) | (u8(9) << 8); kind = "GIF";
    }
    if (!w || !h || w * h > 40000000) return null;
    var size = Math.floor(m[2].length * 3 / 4) - (m[2].match(/=*$/)[0].length);
    return { src: b, w: w, h: h, kind: kind, bytes: size };
  }
  function deleted(v) {
    var meta = {}; try { meta = JSON.parse(v.json_metadata || "{}") || {}; } catch (e) {}
    return meta.deleted === true || meta.deleted === "true" || meta.deleted === 1 || (Array.isArray(meta.tags) && meta.tags.indexOf("deleted") >= 0) || (v.body || "").trim() === "deleted";
  }
  function artImg(a, maxPx) {  // whole-number scaling keeps the pixels square
    var scale = Math.max(1, Math.min(8, Math.floor(maxPx / Math.max(a.w, a.h)))), w = a.w * scale;
    return '<img src="' + a.src + '" width="' + w + '" height="' + (a.h * scale) + '" alt="" style="width:' + w + 'px" decoding="async">';
  }
  function kb(n) { return n < 1024 ? fmtInt(n) + " bytes" : (n / 1024).toFixed(n < 10240 ? 1 : 0) + " KB"; }

  /* ---------- what each operation says, in one line ---------- */
  var SUM = {
    vote: function (v) { var w = (v.weight || 0) / 100; return w === 0 ? acct(v.voter) + " removed a vote on " + post(v.author, v.permlink) : acct(v.voter) + (w < 0 ? " downvoted " : " voted ") + Math.abs(w) + "% on " + post(v.author, v.permlink); },
    comment: function (v) {
      var art = !deleted(v) && artwork(v.body);
      if (!v.parent_author) return acct(v.author) + (art ? " published the artwork “" : " published “") + esc(cut(v.title || v.permlink, 80)) + "”" + (v.parent_permlink ? " in " + esc(cut(v.parent_permlink, 40)) : "");
      return acct(v.author) + " replied to " + post(v.parent_author, v.parent_permlink);
    },
    comment_options: function (v) { return acct(v.author) + " set the payout options of " + esc(cut(v.permlink, 48)); },
    delete_comment: function (v) { return acct(v.author) + " deleted " + esc(cut(v.permlink, 48)); },
    transfer: function (v) { return acct(v.from) + " sent " + amt(v.amount) + " to " + acct(v.to); },
    transfer_to_vesting: function (v) { return acct(v.from) + " powered up " + amt(v.amount) + (v.to && v.to !== v.from ? " for " + acct(v.to) : ""); },
    withdraw_vesting: function (v) { return zero(v.vesting_shares) ? acct(v.account) + " stopped its power-down" : acct(v.account) + " started a power-down of " + amt(v.vesting_shares); },
    delegate_vesting_shares: function (v) { return zero(v.vesting_shares) ? acct(v.delegator) + " removed its delegation to " + acct(v.delegatee) : acct(v.delegator) + " delegated " + amt(v.vesting_shares) + " to " + acct(v.delegatee); },
    claim_reward_balance: function (v) {
      var parts = Object.keys(v).filter(function (k) { return /^reward_/.test(k) && !zero(v[k]); }).map(function (k) { return amt(v[k]); });
      return acct(v.account) + " claimed " + (parts.length ? parts.join(", ") : "its rewards");
    },
    custom_json: function (v) {
      var who = (v.required_posting_auths || [])[0] || (v.required_auths || [])[0];
      return acct(who) + " sent custom JSON “" + esc(cut(v.id, 40)) + "”";
    },
    feed_publish: function (v) { var r = v.exchange_rate || {}; return acct(v.publisher) + " published a price feed of " + amt(r.quote) + " per " + amt(r.base); },
    witness_update: function (v) { return acct(v.owner) + " updated its witness registration"; },
    witness_set_properties: function (v) { return acct(v.owner) + " set its witness properties"; },
    account_witness_vote: function (v) { return acct(v.account) + (v.approve ? " voted for the witness " : " withdrew its vote for the witness ") + acct(v.witness); },
    account_witness_proxy: function (v) { return v.proxy ? acct(v.account) + " made " + acct(v.proxy) + " its voting proxy" : acct(v.account) + " cleared its voting proxy"; },
    account_create: function (v) { return acct(v.creator) + " opened the account " + acct(v.new_account_name); },
    create_claimed_account: function (v) { return acct(v.creator) + " opened the account " + acct(v.new_account_name) + " with a ticket"; },
    claim_account: function (v) { return acct(v.creator) + " claimed an account ticket"; },
    account_update: function (v) { return acct(v.account) + " updated its account"; },
    account_update2: function (v) { return acct(v.account) + " updated its account"; },
    convert: function (v) { return acct(v.owner) + " asked to convert " + amt(v.amount); },
    collateralized_convert: function (v) { return acct(v.owner) + " asked to convert " + amt(v.amount) + " against collateral"; },
    limit_order_create: function (v) { return acct(v.owner) + " placed an order selling " + amt(v.amount_to_sell); },
    limit_order_create2: function (v) { return acct(v.owner) + " placed an order selling " + amt(v.amount_to_sell); },
    limit_order_cancel: function (v) { return acct(v.owner) + " cancelled order " + esc(String(v.orderid)); },
    transfer_to_savings: function (v) { return acct(v.from) + " moved " + amt(v.amount) + " into savings" + (v.to && v.to !== v.from ? " for " + acct(v.to) : ""); },
    transfer_from_savings: function (v) { return acct(v.from) + " asked to withdraw " + amt(v.amount) + " from savings"; },
    recurrent_transfer: function (v) { return acct(v.from) + " set a recurring transfer of " + amt(v.amount) + " to " + acct(v.to); },
    create_proposal: function (v) { return acct(v.creator) + " created the proposal “" + esc(cut(v.subject, 80)) + "”"; },
    update_proposal_votes: function (v) { return acct(v.voter) + (v.approve ? " supported " : " withdrew support from ") + "proposal " + esc((v.proposal_ids || []).join(", ")); },
    remove_proposal: function (v) { return acct(v.proposal_owner) + " removed proposal " + esc((v.proposal_ids || []).join(", ")); },
    change_recovery_account: function (v) { return acct(v.account_to_recover) + " named " + acct(v.new_recovery_account) + " as its recovery partner"; },
    producer_reward: function (v) { return acct(v.producer) + " earned " + amt(v.vesting_shares) + " for producing the block"; },
    author_reward: function (v) { return acct(v.author) + " earned author rewards for " + esc(cut(v.permlink, 48)); },
    curation_reward: function (v) { return acct(v.curator) + " earned " + amt(v.reward) + " for curating " + post(v.comment_author || v.author, v.comment_permlink || v.permlink); },
    comment_reward: function (v) { return post(v.author, v.permlink) + " paid out"; },
    comment_payout_update: function (v) { return "The payout of " + post(v.author, v.permlink) + " changed state"; },
    comment_benefactor_reward: function (v) { return acct(v.benefactor) + " earned a beneficiary reward from " + post(v.author, v.permlink); },
    effective_comment_vote: function (v) { return "The vote of " + acct(v.voter) + " on " + post(v.author, v.permlink) + " took effect"; },
    fill_vesting_withdraw: function (v) { return acct(v.from_account) + " received " + amt(v.deposited) + " from its power-down"; },
    transfer_to_vesting_completed: function (v) { return acct(v.to_account) + " received " + amt(v.vesting_shares_received); },
    account_created: function (v) { return acct(v.creator) + " opened the account " + acct(v.new_account_name); },
    proposal_pay: function (v) { return acct(v.receiver) + " received " + amt(v.payment) + " from proposal " + esc(String(v.proposal_id)); },
    producer_missed: function (v) { return acct(v.producer) + " missed its block"; },
    hardfork: function (v) { return "Hardfork " + esc(String(v.hardfork_id)) + " applied"; },
    delayed_voting: function (v) { return acct(v.voter) + " gained governance weight"; },
    fill_order: function (v) { return acct(v.current_owner) + " and " + acct(v.open_owner) + " traded on the internal market"; },
    fill_convert_request: function (v) { return acct(v.owner) + " received " + amt(v.amount_out) + " from a conversion"; },
    return_vesting_delegation: function (v) { return amt(v.vesting_shares) + " of delegated stake returned to " + acct(v.account); }
  };
  function summary(type, v) {
    try { if (SUM[type]) return SUM[type](v || {}); } catch (e) { /* fall through */ }
    // anything else: the accounts and amounts it names
    var bits = [];
    Object.keys(v || {}).forEach(function (k) {
      var x = v[k];
      if (bits.length < 3 && typeof x === "string" && x && x.length < 60 && (ACCOUNT.test(x) || /^\d+\.\d+ [A-Z]+$/.test(x))) bits.push(esc(k.replace(/_/g, " ")) + " " + (ACCOUNT.test(x) ? acct(x) : amt(x)));
    });
    return bits.join(", ") || "No account or amount named";
  }
  function opChip(type, virtual) {
    return '<span class="chip op-chip' + (virtual ? " fill" : "") + '">' + esc(type) + "</span>";
  }
  function opDesc(type) { return S.ops && S.ops[type] ? '<p class="desc">' + esc(S.ops[type]) + "</p>" : ""; }

  /* ---------- the views ---------- */
  function setHead(opts) {
    titleEl.textContent = opts.title;
    leadEl.hidden = !opts.lead;
    crumbsEl.innerHTML = opts.crumbs || "";
    crumbsEl.hidden = !opts.crumbs;
    actionsEl.innerHTML = opts.actions || "";
    document.title = opts.doc ? opts.doc + " — Pixa explorer" : "Explorer — Pixa";
    if (chainSec) {
      var show = !!opts.chain;
      if (chainSec.hidden === show) { chainSec.hidden = !show; if (show) window.dispatchEvent(new Event("resize")); }
    }
  }
  function crumbs(items) {
    return items.map(function (it, i) {
      return (i ? icon("chevron_right") : "") + (it.href ? '<a href="' + esc(it.href) + '">' + esc(it.text) + "</a>" : '<span aria-current="page">' + esc(it.text) + "</span>");
    }).join("");
  }
  function problem(title, text, actions) {
    view.innerHTML = '<div class="xp-error"><p class="h">' + esc(title) + "</p><p>" + text + "</p>" + (actions ? '<p class="btnrow">' + actions + "</p>" : "") + "</div>";
  }
  function offline(retry) {
    problem("api.pixagram.com did not answer", "The explorer reads the chain from your browser. Check your connection and try again; the public node may also be busy for a moment.",
      '<button class="btn" type="button" id="xp-retry">' + icon("history") + "Try again</button>");
    $("xp-retry").addEventListener("click", retry);
  }
  function loading(what) { view.innerHTML = '<p class="xp-loading" role="status">' + esc(what) + "</p>"; }

  function render() {
    var r = parse(location.pathname), t = ++S.token;
    say("");
    if (r.kind === "home") return home(t);
    if (r.kind === "block") return block(r.block, t);
    if (r.kind === "tx") return tx(r.block, r.id, t);
    if (r.kind === "find") return find(r.id, t);
    setHead({ title: "Not an explorer address", crumbs: crumbs([{ text: "Explorer", href: BASE }, { text: "Address" }]), doc: "Not found" });
    problem("This address is not a block or a transaction", "Explorer addresses look like <code>/explorer/1709092</code> or <code>/explorer/1709092/</code> followed by a transaction id. Search above, or start from the latest blocks.",
      '<a class="btn" href="' + BASE + '">Latest blocks</a>');
  }

  /* home: the live chain and the latest blocks */
  function home(t) {
    setHead({ title: "Explorer", lead: true, chain: true });
    view.innerHTML = '<section class="xp-section" aria-labelledby="latest-h"><div class="xp-titlebar"><h2 id="latest-h">Latest blocks</h2><span class="muted xp-live" id="xp-live"></span></div>' +
      '<div class="table-wrap"><table class="latest"><thead><tr><th>Block</th><th>Signed</th><th>Witness</th><th class="num">Transactions</th><th>Operations</th></tr></thead><tbody id="xp-rows">' +
      '<tr><td colspan="5" class="xp-loading">Reading the latest blocks…</td></tr></tbody></table></div></section>';
    S.latest = [];
    if (S.dgp) fillLatest(t);
  }
  function rowHtml(b) {
    var counts = {};
    (b.transactions || []).forEach(function (tr) { (tr.operations || []).forEach(function (op) { var n = (op.type || op[0] || "").replace(/_operation$/, ""); counts[n] = (counts[n] || 0) + 1; }); });
    var ops = Object.keys(counts).map(function (k) { return esc(k) + (counts[k] > 1 ? " ×" + counts[k] : ""); }).join(", ");
    return '<tr><td><a href="' + blockHref(b.num) + '">' + fmtInt(b.num) + "</a></td><td class=\"nowrap\" data-ts=\"" + esc(b.timestamp) + '">' + ago(b.timestamp) + "</td><td>" + acct(b.witness) +
      '</td><td class="num">' + (b.transactions || []).length + "</td><td>" + (ops || '<span class="muted">none</span>') + "</td></tr>";
  }
  function paintLatest() {
    var body = $("xp-rows"); if (!body) return;
    body.innerHTML = S.latest.slice(0, 20).map(rowHtml).join("") || '<tr><td colspan="5" class="xp-loading">Reading the latest blocks…</td></tr>';
  }
  function fillLatest(t) {
    if (S.latestBusy || !S.dgp) return;
    var head = S.dgp.head_block_number, last = S.latest.length ? S.latest[0].num : head - 20;
    if (head <= last) return;
    var from = Math.max(last + 1, head - 19);
    S.latestBusy = true;
    P.rpc("block_api.get_block_range", { starting_block_num: from, count: head - from + 1 }).then(function (r) {
      if (t !== S.token) return;
      (r.blocks || []).forEach(function (b, i) { b.num = from + i; S.latest.unshift(b); });
      S.latest.sort(function (a, b) { return b.num - a.num; });
      S.latest = S.latest.slice(0, 20);
      paintLatest();
      var live = $("xp-live"); if (live) live.textContent = "Updates as blocks arrive";
    }).catch(function () {
      if (t === S.token && !S.latest.length) { var body = $("xp-rows"); if (body) body.innerHTML = '<tr><td colspan="5">api.pixagram.com did not answer. The table fills in as soon as it does.</td></tr>'; }
    }).then(function () { S.latestBusy = false; });
  }
  setInterval(function () { document.querySelectorAll("#xp-rows [data-ts]").forEach(function (td) { td.textContent = ago(td.getAttribute("data-ts")); }); }, 1000);

  /* block */
  function block(n, t) {
    setHead({ title: "Block " + fmtInt(n), crumbs: crumbs([{ text: "Explorer", href: BASE }, { text: "Block " + fmtInt(n) }]), doc: "Block " + fmtInt(n) });
    loading("Reading block " + fmtInt(n) + "…");
    Promise.all([batch([
      { method: "condenser_api.get_block", params: [n] },
      { method: "condenser_api.get_ops_in_block", params: [n, true] },
      { method: "condenser_api.get_dynamic_global_properties", params: [] },
      { method: "condenser_api.get_witness_schedule", params: [] }
    ]), loadOps()]).then(function (all) {
      if (t !== S.token) return;
      var res = all[0], b = res[0].result, vops = res[1].result || [], d = res[2].result, sch = res[3].result;
      if (d) S.dgp = d; if (sch) S.schedule = sch;
      if (!b) {
        var head = S.dgp ? S.dgp.head_block_number : null;
        problem(n > (head || 0) ? "Block " + fmtInt(n) + " has not been produced yet" : "Block " + fmtInt(n) + " was not found",
          head ? "The chain is at block " + fmtInt(head) + " and adds one every three seconds." : "The public node did not return it.",
          head ? '<a class="btn" href="' + blockHref(head) + '">Open block ' + fmtInt(head) + '</a><a class="btn outlined" href="' + BASE + '">Latest blocks</a>' : "");
        return;
      }
      var head = S.dgp ? S.dgp.head_block_number : n;
      actionsEl.innerHTML = (n > 1 ? '<a class="btn outlined small" href="' + blockHref(n - 1) + '" rel="prev">' + icon("chevron_left") + "Previous</a>" : "") +
        '<a class="btn outlined small" id="xp-next" href="' + blockHref(n + 1) + '" rel="next"' + (n >= head ? ' aria-disabled="true" tabindex="-1"' : "") + ">Next" + icon("chevron_right") + "</a>";
      view.innerHTML = blockHtml(n, b, vops);
      upgradeHead(n);
    }).catch(function () { if (t === S.token) offline(function () { block(n, t); }); });
  }
  function versionOf(ext) {
    var out = [];
    (ext || []).forEach(function (e) {
      var type = Array.isArray(e) ? e[0] : e.type, val = Array.isArray(e) ? e[1] : e.value;
      if (type === "version" || type === 1) out.push("runs " + val);
      else if (type === "hardfork_version_vote" || type === 2) out.push("votes for hardfork " + (val && (val.hf_version || val.hardfork_version) || ""));
    });
    return out.join("; ");
  }
  function irreversible(n) { return S.dgp && n <= S.dgp.last_irreversible_block_num; }
  function blockHtml(n, b, vops) {
    var txs = b.transactions || [], nOps = txs.reduce(function (s, x) { return s + (x.operations || []).length; }, 0);
    var head = S.dgp ? S.dgp.head_block_number : n;
    var rows = [
      ["Status", '<span id="xp-status">' + statusChip(n) + "</span>"],
      ["Signed", utc(b.timestamp) + ' <span class="muted" data-ago="' + esc(b.timestamp) + '">(' + ago(b.timestamp) + ")</span>"],
      ["Witness", acct(b.witness)],
      ["Transactions", fmtInt(txs.length) + (txs.length ? ', with ' + fmtInt(nOps) + " operation" + (nOps === 1 ? "" : "s") : "") + "; " + fmtInt(vops.length) + " virtual operation" + (vops.length === 1 ? "" : "s")],
      ["Block id", '<span class="hash">' + esc(b.block_id) + "</span>" + copyBtn(b.block_id, "Copy the block id")],
      ["Previous", n > 1 ? '<a class="hash" href="' + blockHref(n - 1) + '">' + esc(b.previous) + "</a>" : '<span class="hash">' + esc(b.previous) + "</span>"],
      ["Transaction root", '<span class="hash">' + esc(b.transaction_merkle_root) + "</span>"],
      ["Signing key", '<span class="hash">' + esc(b.signing_key || "") + "</span>"],
      ["Signature", '<span class="hash">' + esc(cut(b.witness_signature || "", 48)) + "</span>" + (b.witness_signature ? copyBtn(b.witness_signature, "Copy the signature") : "")]
    ];
    var ver = versionOf(b.extensions); if (ver) rows.push(["Witness node", esc(ver)]);
    var html = '<div class="table-wrap"><table class="kv xp-facts"><tbody>' + rows.map(function (r) { return "<tr><td>" + r[0] + "</td><td>" + r[1] + "</td></tr>"; }).join("") + "</tbody></table></div>";
    html += nearby(n, head);
    html += '<section class="xp-section" aria-labelledby="tx-h"><h2 id="tx-h">Transactions <span class="muted">' + fmtInt(txs.length) + "</span></h2>";
    if (!txs.length) html += '<p class="muted">This block carries no transactions: the witness signed it on schedule with nothing to include.</p>';
    else html += '<ol class="txs">' + txs.map(function (tr, i) { return txCard(n, tr, i, txs.length, (b.transaction_ids || [])[i] || tr.transaction_id); }).join("") + "</ol>";
    html += "</section>";
    html += '<section class="xp-section" aria-labelledby="vop-h"><h2 id="vop-h">Virtual operations <span class="muted">' + fmtInt(vops.length) + "</span></h2>" +
      '<p class="muted xp-note">Written by the chain itself when a rule applies, with no signature.</p>';
    html += vops.length ? '<ul class="ops vops">' + vops.map(function (o) { return opLine(o.op[0], o.op[1], true); }).join("") + "</ul>" : '<p class="muted">None in this block.</p>';
    html += "</section>";
    html += '<section class="xp-section">' + jsonBlock("Block " + fmtInt(n) + " as JSON", b) + "</section>";
    return html;
  }
  function statusChip(n) {
    if (!S.dgp) return '<span class="chip quiet">Unknown</span>';
    return irreversible(n) ? '<span class="chip fill">Irreversible</span>' : '<span class="chip dashed">Not yet irreversible</span>';
  }
  function upgradeHead(n) {  // as the chain moves on: the Next button and the status
    var next = $("xp-next");
    if (next && S.dgp && S.dgp.head_block_number > n) { next.removeAttribute("aria-disabled"); next.removeAttribute("tabindex"); }
    var st = $("xp-status"); if (st) st.innerHTML = statusChip(n);
  }
  function onHead() {
    var r = parse(location.pathname);
    if (r.kind === "home") fillLatest(S.token);
    if (r.kind === "block") upgradeHead(r.block);
  }
  setInterval(function () { document.querySelectorAll("#xp-view [data-ago]").forEach(function (el) { var a = ago(el.getAttribute("data-ago")); el.textContent = el.tagName === "SPAN" && el.classList.contains("muted") ? "(" + a + ")" : a; }); }, 5000);

  function nearby(n, head) {  // the blocks around this one, coloured like the ribbon
    var N = (S.schedule && S.schedule.num_scheduled_witnesses) || 21, sh = (S.schedule && S.schedule.next_shuffle_block_num) || 0, cells = [];
    for (var k = n - 10; k <= n + 10; k++) {
      if (k < 1) continue;
      var pos = ((k - sh) % N + N) % N, c = P.spectrum ? P.spectrum(pos, N) : "#888";
      if (k > head) cells.push('<span class="cell future" title="Block ' + fmtInt(k) + ', not produced yet"></span>');
      else cells.push('<a class="cell' + (k === n ? " here" : "") + '" href="' + blockHref(k) + '" style="--c:' + c + '" title="Block ' + fmtInt(k) + '"' + (k === n ? ' aria-current="page"' : "") + '><span class="sr-only">Block ' + fmtInt(k) + "</span></a>");
    }
    return '<div class="near-row"><span class="muted">Blocks around it</span><nav class="near" aria-label="Blocks around it">' + cells.join("") + "</nav></div>";
  }
  function txCard(n, tr, i, total, id) {
    var ops = tr.operations || [];
    return '<li class="tx"><div class="tx-head"><span class="pos">#' + (i + 1) + "</span>" +
      '<a class="hash" href="' + BASE + n + "/" + esc(id) + '">' + esc(id) + "</a>" +
      '<span class="muted">' + fmtInt(ops.length) + " operation" + (ops.length === 1 ? "" : "s") + "</span></div>" +
      '<ul class="ops">' + ops.map(function (op) { return opLine(op[0], op[1], false); }).join("") + "</ul></li>";
  }
  function opLine(type, v, virtual) {
    var art = type === "comment" && !v.parent_author && !deleted(v) && artwork(v.body);
    return "<li>" + opChip(type, virtual) + '<span class="op-sum">' + summary(type, v) + "</span>" +
      (art ? '<span class="thumb">' + artImg(art, 72) + "</span>" : "") + "</li>";
  }

  /* transaction */
  function tx(n, id, t) {
    var short = id.slice(0, 8) + "…";
    setHead({ title: "Transaction", crumbs: crumbs([{ text: "Explorer", href: BASE }, { text: "Block " + fmtInt(n), href: blockHref(n) }, { text: "Transaction " + short }]), doc: "Transaction " + short });
    loading("Reading the transaction in block " + fmtInt(n) + "…");
    Promise.all([batch([
      { method: "condenser_api.get_block", params: [n] },
      { method: "condenser_api.get_ops_in_block", params: [n, true] },
      { method: "condenser_api.get_dynamic_global_properties", params: [] }
    ]), loadOps()]).then(function (all) {
      if (t !== S.token) return;
      var res = all[0], b = res[0].result, vops = res[1].result || [];
      if (res[2].result) S.dgp = res[2].result;
      if (!b) { problem("Block " + fmtInt(n) + " was not found", "The transaction is looked up inside its block, and the public node did not return this block.", '<a class="btn" href="' + BASE + id + '">Find the transaction by its id</a>'); return; }
      var ids = b.transaction_ids || (b.transactions || []).map(function (x) { return x.transaction_id; }), i = ids.indexOf(id);
      if (i < 0) {
        problem("Block " + fmtInt(n) + " has no transaction " + short, "The id may belong to another block. The explorer can look it up by id alone.",
          '<a class="btn" href="' + BASE + id + '">' + icon("search") + 'Find it by id</a><a class="btn outlined" href="' + blockHref(n) + '">Open block ' + fmtInt(n) + "</a>");
        return;
      }
      view.innerHTML = txHtml(n, b, b.transactions[i], i, id, vops.filter(function (o) { return o.trx_id === id; }));
    }).catch(function () { if (t === S.token) offline(function () { tx(n, id, t); }); });
  }
  function txHtml(n, b, tr, i, id, vops) {
    var ops = tr.operations || [], sigs = tr.signatures || [];
    var rows = [
      ["Block", '<a href="' + blockHref(n) + '">' + fmtInt(n) + "</a>, transaction " + (i + 1) + " of " + (b.transactions || []).length],
      ["Status", statusChip(n)],
      ["Signed", utc(b.timestamp) + ' <span class="muted">(' + ago(b.timestamp) + ")</span>"],
      ["Expiration", utc(tr.expiration)],
      ["Reference block", fmtInt(tr.ref_block_num) + ", prefix " + esc(String(tr.ref_block_prefix))],
      ["Signatures", sigs.length ? sigs.map(function (s) { return '<span class="hash">' + esc(cut(s, 48)) + "</span>" + copyBtn(s, "Copy the signature"); }).join("<br>") : '<span class="muted">none</span>'],
      ["Extensions", tr.extensions && tr.extensions.length ? esc(JSON.stringify(tr.extensions)) : '<span class="muted">none</span>']
    ];
    var html = '<div class="xp-idline"><span class="hash big">' + esc(id) + "</span>" + copyBtn(id, "Copy the transaction id") + "</div>";
    html += '<div class="table-wrap"><table class="kv xp-facts"><tbody>' + rows.map(function (r) { return "<tr><td>" + r[0] + "</td><td>" + r[1] + "</td></tr>"; }).join("") + "</tbody></table></div>";
    html += '<section class="xp-section" aria-labelledby="ops-h"><h2 id="ops-h">Operations <span class="muted">' + fmtInt(ops.length) + "</span></h2>" +
      ops.map(function (op, k) { return opCard(op[0], op[1], k, false); }).join("") + "</section>";
    if (vops.length) html += '<section class="xp-section" aria-labelledby="vops-h"><h2 id="vops-h">What the chain wrote back <span class="muted">' + fmtInt(vops.length) + "</span></h2>" +
      vops.map(function (o, k) { return opCard(o.op[0], o.op[1], k, true); }).join("") + "</section>";
    html += '<section class="xp-section">' + jsonBlock("Transaction as JSON", tr) + "</section>";
    return html;
  }
  var ACCOUNT_KEYS = /^(author|voter|from|to|account|owner|creator|publisher|producer|delegator|delegatee|curator|witness|new_account_name|parent_author|proxy|receiver|benefactor|from_account|to_account|agent|who|challenger|reset_account|recovery_account|new_recovery_account|account_to_recover|current_owner|open_owner|proposal_owner|comment_author)$/;
  function fieldValue(k, x) {
    if (typeof x === "string") {
      if (ACCOUNT_KEYS.test(k)) return x ? acct(x) : '<span class="muted">none</span>';
      if (/^\d+\.\d+ [A-Z]+$/.test(x)) return amt(x);
      if (!x) return '<span class="muted">empty</span>';
      if ((k === "json" || k === "json_metadata" || k === "posting_json_metadata") && /^[\[{]/.test(x.trim())) {
        try { return '<pre class="field-json no-copy" tabindex="0" aria-label="JSON value"><code>' + esc(json(JSON.parse(x))) + "</code></pre>"; } catch (e) { /* show as text */ }
      }
      return '<span class="txt">' + esc(cut(x, 400)) + "</span>" + (x.length > 400 ? ' <span class="muted">(' + fmtInt(x.length) + " characters)</span>" : "");
    }
    if (typeof x === "number" || typeof x === "boolean") return '<span class="num">' + esc(String(x)) + "</span>";
    if (x && typeof x === "object" && x.amount != null && x.nai) return amt(x);
    if (Array.isArray(x) && x.every(function (y) { return typeof y === "string" && ACCOUNT.test(y); })) return x.length ? x.map(acct).join(", ") : '<span class="muted">none</span>';
    return '<pre class="field-json no-copy" tabindex="0" aria-label="JSON value"><code>' + esc(json(x)) + "</code></pre>";
  }
  function opCard(type, v, k, virtual) {
    v = v || {};
    var art = type === "comment" && !deleted(v) && artwork(v.body), link = "";
    if (type === "comment" && !v.parent_author && v.parent_permlink && ACCOUNT.test(v.author || ""))
      link = '<a class="btn text small" href="https://pixagram.com/' + encodeURIComponent(v.parent_permlink) + "/@" + esc(v.author) + "/" + encodeURIComponent(v.permlink || "") + '">' + icon("north_east") + "Open in Pixagram</a>";
    var fields = Object.keys(v).map(function (key) {
      if (key === "body" && art) return "<tr><td>body</td><td>" + esc(art.kind) + " image, " + fmtInt(art.w) + " × " + fmtInt(art.h) + " px, " + kb(art.bytes) + "</td></tr>";
      return "<tr><td>" + esc(key) + "</td><td>" + fieldValue(key, v[key]) + "</td></tr>";
    }).join("");
    return '<article class="opcard"><div class="opcard-head">' + opChip(type, virtual) + '<span class="op-sum">' + summary(type, v) + "</span></div>" + opDesc(type) +
      (art ? '<figure class="art">' + artImg(art, 480) + "<figcaption>" + esc(art.kind) + ", " + fmtInt(art.w) + " × " + fmtInt(art.h) + " pixels, " + kb(art.bytes) + " in the block" + (link ? link : "") + "</figcaption></figure>" : (link ? '<p class="btnrow">' + link + "</p>" : "")) +
      '<div class="table-wrap"><table class="kv fields"><tbody>' + fields + "</tbody></table></div></article>";
  }

  /* find: a transaction id alone */
  function find(id, t) {
    var short = id.slice(0, 8) + "…";
    setHead({ title: "Transaction", crumbs: crumbs([{ text: "Explorer", href: BASE }, { text: "Transaction " + short }]), doc: "Transaction " + short });
    loading("Looking for transaction " + short + "…");
    P.rpc("condenser_api.get_transaction", [id]).then(function (tr) {
      if (t !== S.token) return;
      if (tr && tr.block_num) { go(BASE + tr.block_num + "/" + id, true); return; }
      throw new Error("not found");
    }).catch(function (e) {
      if (t !== S.token) return;
      if (/not found|unknown|Unable|Assert/i.test(String(e && e.message))) problem("No transaction with this id", "The public node knows no transaction " + esc(short) + ". Check the id, or open the block it is in.", '<a class="btn" href="' + BASE + '">Latest blocks</a>');
      else offline(function () { find(id, t); });
    });
  }

  render();
})();
