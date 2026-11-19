/* pixa.org — Big Mac prices. No dependencies, no build step.
   Reads the two price files of pixagram-blockchain/bigmac-feed (latest.csv: pick-up prices,
   delivery.csv: delivery-app prices) and converts them for display with Frankfurter.
   The table is drawn first from the copies built into the page, then from the repository,
   and stays as it is when a request fails. Everything read from the files is treated as text. */
(function () {
  "use strict";

  var CONFIG = (window.PIXA && window.PIXA.CONFIG) || {};
  var table = document.getElementById("bm-table");
  if (!table) return;
  var body = table.tBodies[0];
  var select = document.getElementById("bm-cur");
  var curName = document.getElementById("bm-curname");
  var fxNote = document.getElementById("bm-fx");
  var statusLine = document.getElementById("bm-status");
  var gapLine = document.getElementById("bm-gap");

  var REQUIRED = ["country_code", "currency_code", "low", "high", "median", "date"];
  var STORE_KEY = "pixa-bigmac-currency";
  var state = {
    pickup: [],        // rows of latest.csv
    delivery: {},      // rows of delivery.csv by country
    live: false,       // read from the repository, not from the copy built into the page
    target: "EUR",     // currency to convert to
    rates: null,       // units of each currency per one unit of target; null until read
    ratesDate: "",
    sort: "country",
    desc: false
  };

  /* ---------- CSV: quoted fields, doubled quotes, line breaks inside quotes ---------- */
  function parseCsv(text) {
    var rows = [], row = [], field = "", quoted = false, i = 0, c;
    text = String(text).replace(/^﻿/, "");
    while (i < text.length) {
      c = text.charAt(i);
      if (quoted) {
        if (c === '"') {
          if (text.charAt(i + 1) === '"') { field += '"'; i += 2; continue; }
          quoted = false;
        } else { field += c; }
      } else if (c === '"') { quoted = true; }
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text.charAt(i + 1) === "\n") i++;
        row.push(field); field = "";
        if (row.length > 1 || row[0] !== "") rows.push(row);
        row = [];
      } else { field += c; }
      i++;
    }
    row.push(field);
    if (row.length > 1 || row[0] !== "") rows.push(row);
    return rows;
  }

  /* How many decimals a price is written with: local prices are shown as the file has them. */
  function decimalsOf(s) {
    var m = /\.(\d+)\s*$/.exec(String(s));
    return m ? Math.min(m[1].length, 4) : 0;
  }

  /* A row that breaks the file's rules is left out, as the feed does. */
  function readPrices(text) {
    var rows = parseCsv(text), head = rows.shift() || [], at = {}, out = [], seen = {};
    head.forEach(function (h, i) { at[h.trim()] = i; });
    for (var k = 0; k < REQUIRED.length; k++) if (!(REQUIRED[k] in at)) return [];
    rows.forEach(function (r) {
      var country = (r[at.country_code] || "").trim().toUpperCase();
      var currency = (r[at.currency_code] || "").trim().toUpperCase();
      var low = Number(r[at.low]), high = Number(r[at.high]), median = Number(r[at.median]);
      var date = (r[at.date] || "").trim();
      if (!/^[A-Z]{2}$/.test(country) || seen[country] || !/^[A-Z]{3}$/.test(currency)) return;
      if (!(low > 0) || !(low <= median) || !(median <= high) || !isFinite(high)) return;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
      seen[country] = true;
      out.push({ country: country, currency: currency, low: low, high: high, median: median, date: date,
                 decimals: Math.max(decimalsOf(r[at.low]), decimalsOf(r[at.high]), decimalsOf(r[at.median])),
                 sources: at.sources == null ? "" : (r[at.sources] || "") });
    });
    return out;
  }

  /* ---------- formatting ---------- */
  var regionNames = null;
  try { regionNames = new Intl.DisplayNames(["en"], { type: "region" }); } catch (e) { /* codes will do */ }
  function countryName(code) {
    try { return (regionNames && regionNames.of(code)) || code; } catch (e) { return code; }
  }
  var digitsOf = {};
  function digits(currency) {
    if (!(currency in digitsOf)) {
      try { digitsOf[currency] = new Intl.NumberFormat("en", { style: "currency", currency: currency }).resolvedOptions().maximumFractionDigits; }
      catch (e) { digitsOf[currency] = 2; }
    }
    return digitsOf[currency];
  }
  function amount(n, currency, decimals) {
    var d = decimals == null ? digits(currency) : decimals;
    return n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  function money(n, currency, decimals) { return amount(n, currency, decimals) + " " + currency; }
  function day(iso) {
    var d = new Date(iso + "T00:00:00Z");
    return isNaN(d) ? iso : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  }
  function percent(x) { return (x >= 0 ? "+" : "−") + Math.abs(Math.round(x * 100)) + "%"; }

  /* ---------- conversion: rates[c] is how many c one unit of the target buys ---------- */
  function convert(n, currency) {
    if (currency === state.target) return n;
    var rate = state.rates && state.rates[currency];
    return rate > 0 ? n / rate : null;
  }

  /* ---------- drawing ---------- */
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  /* "note: https://… | https://…" becomes a list; only http(s) addresses become links. */
  function sourceList(text) {
    var ul = el("ul");
    String(text).split(" | ").forEach(function (item) {
      item = item.trim();
      if (!item) return;
      var li = el("li"), m = /https?:\/\/[^\s"<>]+/.exec(item);
      if (!m) { li.textContent = item; ul.appendChild(li); return; }
      var note = item.slice(0, m.index).replace(/[:\s]+$/, ""), a = el("a"), host = m[0];
      try { host = new URL(m[0]).hostname.replace(/^www\./, ""); a.href = m[0]; } catch (e) { li.textContent = item; ul.appendChild(li); return; }
      a.rel = "noopener nofollow";
      a.textContent = host;
      if (note) li.appendChild(document.createTextNode(note + ": "));
      li.appendChild(a);
      ul.appendChild(li);
    });
    return ul;
  }

  function priceCell(row, convertedInstead) {
    var td = el("td", "num");
    if (!row) { td.appendChild(el("span", "bm-sub", "none yet")); return td; }
    var show = function (n) { return convertedInstead ? money(convert(n, row.currency), state.target) : money(n, row.currency, row.decimals); };
    if (convertedInstead && convert(row.median, row.currency) == null) {
      td.textContent = "—";
      td.title = "No exchange rate for " + row.currency;
      return td;
    }
    td.appendChild(document.createTextNode(show(row.median)));
    if (row.low !== row.high && !convertedInstead) td.appendChild(el("span", "bm-sub", amount(row.low, row.currency, row.decimals) + " to " + amount(row.high, row.currency, row.decimals)));
    return td;
  }

  function render() {
    var byCountry = {}, rows = [];
    state.pickup.forEach(function (r) { byCountry[r.country] = { country: r.country, pickup: r, delivery: state.delivery[r.country] || null }; });
    Object.keys(state.delivery).forEach(function (c) { if (!byCountry[c]) byCountry[c] = { country: c, pickup: null, delivery: state.delivery[c] }; });
    Object.keys(byCountry).forEach(function (c) {
      var r = byCountry[c];
      r.name = countryName(c);
      r.converted = r.pickup ? convert(r.pickup.median, r.pickup.currency) : null;
      rows.push(r);
    });
    rows.sort(function (a, b) {
      if (state.sort === "converted") {
        // countries without a converted price go last, whichever way the column is sorted
        if ((a.converted == null) !== (b.converted == null)) return a.converted == null ? 1 : -1;
        if (a.converted != null && a.converted !== b.converted) return state.desc ? b.converted - a.converted : a.converted - b.converted;
      }
      var byName = a.name.localeCompare(b.name, "en");
      return state.sort === "country" && state.desc ? -byName : byName;
    });

    body.textContent = "";
    if (!rows.length) {
      var empty = el("tr", "bm-empty"), cell = el("td", "", "The prices could not be read. They are in latest.csv, linked above.");
      cell.colSpan = 6; empty.appendChild(cell); body.appendChild(empty);
    }
    rows.forEach(function (r) {
      var tr = el("tr"), th = el("th", "bm-country"), main = r.pickup || r.delivery;
      th.scope = "row";
      th.appendChild(document.createTextNode(r.name));
      th.appendChild(el("span", "bm-sub", r.country + " · " + main.currency));
      tr.appendChild(th);
      tr.appendChild(priceCell(r.pickup, false));
      tr.appendChild(r.pickup ? priceCell(r.pickup, true) : el("td", "num", "—"));

      var dtd = el("td", "num");
      if (r.delivery) {
        dtd.appendChild(document.createTextNode(money(r.delivery.median, r.delivery.currency, r.delivery.decimals)));
        if (r.pickup && r.pickup.currency === r.delivery.currency) dtd.appendChild(el("span", "bm-sub", percent(r.delivery.median / r.pickup.median - 1) + " on pick-up"));
      } else { dtd.appendChild(el("span", "bm-sub", "not read")); }
      tr.appendChild(dtd);

      tr.appendChild(el("td", "", day(main.date)));

      var std = el("td", "bm-src"), details = el("details"), n = 0;
      [r.pickup, r.delivery].forEach(function (p, i) {
        if (!p || !p.sources.trim()) return;
        var list = sourceList(p.sources);
        n += list.children.length;
        if (r.pickup && r.delivery) details.appendChild(el("p", "bm-sub", i === 0 ? "Pick-up" : "Delivery apps"));
        details.appendChild(list);
      });
      details.insertBefore(el("summary", "", n + (n === 1 ? " source" : " sources")), details.firstChild);
      std.appendChild(details);
      tr.appendChild(std);
      body.appendChild(tr);
    });

    // header state
    Array.prototype.forEach.call(table.tHead.rows[0].cells, function (th) {
      var key = th.getAttribute("data-sort");
      if (!key) return;
      if (key === state.sort) th.setAttribute("aria-sort", state.desc ? "descending" : "ascending");
      else th.removeAttribute("aria-sort");
    });
    if (curName) curName.textContent = state.target;

    // what was read, and from where
    var withDelivery = Object.keys(state.delivery).length;
    statusLine.textContent = state.pickup.length + (state.pickup.length === 1 ? " country" : " countries") + " with a pick-up price, " +
      withDelivery + " with a delivery price. " + (state.live ? "Read from the repository just now." : "Shown from the copy built into this page.");

    // the gap between the two prices, where both are known in the same currency
    var gaps = [];
    rows.forEach(function (r) { if (r.pickup && r.delivery && r.pickup.currency === r.delivery.currency) gaps.push(r.delivery.median / r.pickup.median - 1); });
    if (gapLine) {
      if (!gaps.length) gapLine.textContent = "";
      else {
        var lo = Math.round(Math.min.apply(null, gaps) * 100), hi = Math.round(Math.max.apply(null, gaps) * 100);
        gapLine.textContent = "In the " + gaps.length + (gaps.length === 1 ? " country" : " countries") + " where both are known, delivery apps list the Big Mac " +
          (lo === hi ? lo + "%" : lo + "% to " + hi + "%") + (hi >= 0 && lo >= 0 ? " above" : " away from") + " the pick-up price.";
      }
    }
  }

  /* ---------- the currency to convert to ---------- */
  function fileCurrencies() {
    var set = {};
    state.pickup.forEach(function (r) { set[r.currency] = true; });
    Object.keys(state.delivery).forEach(function (c) { set[state.delivery[c].currency] = true; });
    return set;
  }
  function fillSelect(list) {
    // list: [{code, name}] ; keeps the current choice selected
    select.textContent = "";
    list.forEach(function (c) {
      var o = el("option", "", c.name ? c.code + " — " + c.name : c.code);
      o.value = c.code;
      if (c.code === state.target) o.selected = true;
      select.appendChild(o);
    });
  }
  function basicList() {
    var set = fileCurrencies();
    ["CHF", "EUR", "GBP", "JPY", "USD"].forEach(function (c) { set[c] = true; });
    set[state.target] = true;
    return Object.keys(set).sort().map(function (c) { return { code: c, name: "" }; });
  }
  function defaultTarget() {
    try { var saved = localStorage.getItem(STORE_KEY); if (saved && /^[A-Z]{3}$/.test(saved)) return saved; } catch (e) { /* private mode */ }
    // the currency of the visitor's own country, when the files have that country
    var m = /[-_]([A-Za-z]{2})\b/.exec(navigator.language || "");
    if (m) {
      var region = m[1].toUpperCase();
      for (var i = 0; i < state.pickup.length; i++) if (state.pickup[i].country === region) return state.pickup[i].currency;
      if (state.delivery[region]) return state.delivery[region].currency;
    }
    return "EUR";
  }

  function loadRates() {
    var target = state.target;
    state.rates = null; state.ratesDate = "";
    render();
    if (!CONFIG.fx) return;
    fxNote.textContent = "Reading today's rates…";
    fetch(CONFIG.fx + "/rates?base=" + encodeURIComponent(target))
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (rows) {
        if (target !== state.target) return;   // the choice changed while this was in flight
        var rates = {}, newest = "";
        rows.forEach(function (x) { if (x && x.base === target && x.rate > 0) { rates[x.quote] = x.rate; if (x.date > newest) newest = x.date; } });
        state.rates = rates; state.ratesDate = newest;
        fxNote.textContent = "Rates of " + day(newest) + ", from Frankfurter.";
        render();
      })
      .catch(function () {
        if (target !== state.target) return;
        fxNote.textContent = "Today's rates could not be read. Each price is shown in its country's currency.";
        render();
      });
  }

  function loadCurrencyNames() {
    if (!CONFIG.fx) return;
    fetch(CONFIG.fx + "/currencies")
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (rows) {
        var list = [], have = {};
        rows.forEach(function (c) {
          if (c && c.type === "currency" && /^[A-Z]{3}$/.test(c.iso_code)) { list.push({ code: c.iso_code, name: String(c.name || "") }); have[c.iso_code] = true; }
        });
        if (!list.length) return;
        if (!have[state.target]) list.push({ code: state.target, name: "" });
        list.sort(function (a, b) { return a.code < b.code ? -1 : 1; });
        fillSelect(list);
      })
      .catch(function () { /* the short list stays */ });
  }

  /* ---------- the files ---------- */
  function take(latestText, deliveryText) {
    var pickup = readPrices(latestText);
    if (!pickup.length) return false;
    state.pickup = pickup;
    state.delivery = {};
    readPrices(deliveryText || "").forEach(function (r) { state.delivery[r.country] = r; });
    return true;
  }
  function text(url) {
    return fetch(url, { cache: "no-cache" }).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.text(); });
  }
  function refresh() {
    if (!CONFIG.bigmacLatest) return;
    Promise.all([text(CONFIG.bigmacLatest), text(CONFIG.bigmacDelivery).catch(function () { return ""; })])
      .then(function (files) { if (take(files[0], files[1])) { state.live = true; render(); } })
      .catch(function () { /* keep the copy built into the page */ });
  }

  /* ---------- start ---------- */
  try {
    var snap = JSON.parse(document.getElementById("bm-snapshot").textContent);
    take(snap.latest, snap.delivery);
  } catch (e) { /* no copy in the page: wait for the repository */ }

  state.target = defaultTarget();
  fillSelect(basicList());
  select.addEventListener("change", function () {
    state.target = select.value;
    try { localStorage.setItem(STORE_KEY, state.target); } catch (e) { /* not kept */ }
    loadRates();
  });
  Array.prototype.forEach.call(table.tHead.querySelectorAll("th[data-sort] button"), function (button) {
    button.addEventListener("click", function () {
      var key = button.parentNode.getAttribute("data-sort");
      state.desc = state.sort === key ? !state.desc : false;
      state.sort = key;
      render();
    });
  });

  loadRates();          // draws the table once, then again with the rates
  loadCurrencyNames();
  refresh();
})();
