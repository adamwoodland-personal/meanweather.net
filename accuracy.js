/* meanweather.net — /most-accurate-weather-forecast/: which model's forecasts for a place
 * turned out best. Everything runs in the browser, two keyless Open-Meteo requests:
 *   1. previous-runs API -> what each model forecast for every hour of the period, made
 *      N days (1, 2, 3, 5 or 7) ahead
 *   2. archive API, ERA5 reanalysis -> what actually happened at the same hours
 * Each day is scored on the high and low temperature (from hourly values) and on the
 * wet/dry call (1 mm or more). No server, no stored results.
 *
 * ⚠ The archive is pinned to models=era5_seamless. Its default "best match" fills the last
 *   ~5 days with ECMWF IFS analysis, which would score ECMWF against itself (checked
 *   2026-10-02); ERA5 days that are not out yet are simply left out.
 *
 * The scoring core (score / rank / *HTML) is also require()d under Node by
 * ReferenceFiles/meanweather-accuracy/build-snapshot.js, which pre-renders the example
 * cities into the page at publish time.
 */
(function () {
  'use strict';

  // Same ids and names as MODELS in app.js — keep the two in step.
  var MODELS = [
    { id: 'ecmwf_ifs025',         name: 'ECMWF IFS',  org: 'Europe' },
    { id: 'ecmwf_aifs025_single', name: 'ECMWF AIFS', org: 'Europe, AI' },
    { id: 'gfs_seamless',         name: 'GFS',        org: 'NOAA, US' },
    { id: 'icon_seamless',        name: 'ICON',       org: 'DWD, Germany' },
    { id: 'ukmo_seamless',        name: 'UKMO',       org: 'Met Office, UK' },
    { id: 'meteofrance_seamless', name: 'ARPEGE',     org: 'Météo-France' },
    { id: 'gem_seamless',         name: 'GEM',        org: 'ECCC, Canada' },
    { id: 'jma_seamless',         name: 'JMA',        org: 'Japan' },
    { id: 'cma_grapes_global',    name: 'CMA GRAPES', org: 'China' }
  ];
  var PREV_API = 'https://previous-runs-api.open-meteo.com/v1/forecast';
  var TRUTH_API = 'https://archive-api.open-meteo.com/v1/archive';
  var TRUTH_MODEL = 'era5_seamless';
  var ERA5_LAG_DAYS = 5;   // ask up to here; days ERA5 has not filled yet are dropped
  var WET_MM = 1;          // a "wet" day: at least this much rain
  var MIN_HOURS = 20;      // hourly values needed to call a day's high, low or total
  var MIN_DAYS = 10;       // scored days a model needs to be ranked
  var LEADS = [1, 2, 3, 5, 7], PERIODS = [30, 90], BY = ['temp', 'hi', 'lo', 'rain'];

  /* ---------------- requests ---------------- */

  function isoDay(ms) { return new Date(ms).toISOString().slice(0, 10); }
  function windowFor(period, nowMs) {
    var end = nowMs - ERA5_LAG_DAYS * 864e5;
    return { start: isoDay(end - (period - 1) * 864e5), end: isoDay(end) };
  }
  function common(u, place, win, imperial) {
    u.searchParams.set('latitude', place.lat);
    u.searchParams.set('longitude', place.lon);
    u.searchParams.set('timezone', 'auto');
    u.searchParams.set('start_date', win.start);
    u.searchParams.set('end_date', win.end);
    if (imperial) u.searchParams.set('temperature_unit', 'fahrenheit');
    return u;   // rain stays in mm: only the wet/dry call uses it
  }
  function prevUrl(place, lead, win, imperial) {
    var u = common(new URL(PREV_API), place, win, imperial);
    u.searchParams.set('hourly', 'temperature_2m_previous_day' + lead + ',precipitation_previous_day' + lead);
    u.searchParams.set('models', MODELS.map(function (m) { return m.id; }).join(','));
    return u;
  }
  function truthUrl(place, win, imperial) {
    var u = common(new URL(TRUTH_API), place, win, imperial);
    u.searchParams.set('hourly', 'temperature_2m,precipitation');
    u.searchParams.set('models', TRUTH_MODEL);
    return u;
  }

  /* ---------------- scoring ---------------- */

  function mean(a) {
    var s = 0, n = 0;
    for (var i = 0; i < a.length; i++) if (a[i] != null) { s += a[i]; n++; }
    return n ? s / n : null;
  }
  function agg(arr, idx, kind) {
    var v = [];
    for (var i = 0; i < idx.length; i++) { var j = idx[i]; if (j != null && arr[j] != null) v.push(arr[j]); }
    if (v.length < MIN_HOURS) return null;
    if (kind === 'max') return Math.max.apply(null, v);
    if (kind === 'min') return Math.min.apply(null, v);
    return v.reduce(function (s, x) { return s + x; }, 0);
  }

  // prev / truth: the two JSON responses. Returns per-model daily errors and their means.
  function score(prev, truth, lead) {
    var th = truth.hourly, ph = prev.hourly, at = {};
    ph.time.forEach(function (t, i) { at[t] = i; });
    var byDay = {}, order = [];
    th.time.forEach(function (t, i) {
      var d = t.slice(0, 10);
      if (!byDay[d]) { byDay[d] = []; order.push(d); }
      byDay[d].push(i);
    });
    var days = [];
    order.forEach(function (d) {
      var idx = byDay[d], hi = agg(th.temperature_2m, idx, 'max');
      if (hi == null) return;   // ERA5 has not covered this day yet
      var rain = agg(th.precipitation, idx, 'sum');
      days.push({ day: d, hi: hi, lo: agg(th.temperature_2m, idx, 'min'), wet: rain == null ? null : rain >= WET_MM,
        p: idx.map(function (i) { return at[th.time[i]]; }) });
    });
    var models = MODELS.map(function (m) {
      var T = ph['temperature_2m_previous_day' + lead + '_' + m.id], R = ph['precipitation_previous_day' + lead + '_' + m.id];
      var e = { temp: [], hi: [], lo: [], rain: [] }, bias = [], n = 0, rainN = 0;
      days.forEach(function (d, k) {
        var fhi = T ? agg(T, d.p, 'max') : null, flo = T ? agg(T, d.p, 'min') : null, fr = R ? agg(R, d.p, 'sum') : null;
        if (fhi != null && flo != null && d.lo != null) {
          e.hi[k] = Math.abs(fhi - d.hi); e.lo[k] = Math.abs(flo - d.lo); e.temp[k] = (e.hi[k] + e.lo[k]) / 2;
          bias.push((fhi - d.hi + flo - d.lo) / 2); n++;
        } else { e.hi[k] = e.lo[k] = e.temp[k] = null; }
        if (fr != null && d.wet != null) { e.rain[k] = (fr >= WET_MM) === d.wet ? 0 : 1; rainN++; } else e.rain[k] = null;
      });
      return { id: m.id, name: m.name, org: m.org, n: n, rainN: rainN, errs: e, bias: mean(bias),
        mean: { temp: mean(e.temp), hi: mean(e.hi), lo: mean(e.lo), rain: mean(e.rain) } };
    });
    return { lead: lead, days: days.map(function (d) { return d.day; }), models: models,
      wetDays: days.filter(function (d) { return d.wet === true; }).length };
  }

  // Is model a not clearly worse than the leader b? Paired daily differences, with the
  // standard error widened for day-to-day correlation (weather errors come in spells, so a
  // month holds fewer independent days than it looks). "Too close" = mean gap < 1.96 SE.
  function tooClose(a, b) {
    var d = [];
    for (var k = 0; k < a.length; k++) if (a[k] != null && b[k] != null) d.push(a[k] - b[k]);
    var n = d.length;
    if (n < MIN_DAYS) return false;
    var mu = mean(d), v = 0, c = 0;
    for (var i = 0; i < n; i++) v += (d[i] - mu) * (d[i] - mu);
    if (v === 0) return mu <= 0;
    for (var j = 1; j < n; j++) c += (d[j] - mu) * (d[j - 1] - mu);
    var r = Math.max(0, Math.min(0.9, c / v));               // lag-1 autocorrelation
    var neff = Math.max(2, n * (1 - r) / (1 + r));
    return mu <= 1.96 * Math.sqrt(v / (n - 1)) / Math.sqrt(neff);
  }

  function rank(res, by) {
    var ok = res.models.filter(function (m) { return (by === 'rain' ? m.rainN : m.n) >= MIN_DAYS && m.mean[by] != null; });
    ok.sort(function (a, b) { return a.mean[by] - b.mean[by] || a.name.localeCompare(b.name); });
    var top = ok[0];
    return {
      rows: ok.map(function (m, i) { return { m: m, pos: i + 1, tie: i > 0 && tooClose(m.errs[by], top.errs[by]) }; }),
      left: res.models.filter(function (m) { return ok.indexOf(m) < 0; })
    };
  }

  /* ---------------- rendering (strings, shared with the Node snapshot) ---------------- */

  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  var MEDAL = ['🥇', '🥈', '🥉'];
  var BY_HEAD = { temp: 'Temperature', hi: 'Highs', lo: 'Lows', rain: 'Rain right' };
  function deg(x, imperial) { return x.toFixed(1) + (imperial ? ' °F' : ' °C'); }
  function biasText(b, imperial) {
    if (b == null) return '–';
    if (Math.abs(b) < (imperial ? 0.5 : 0.3)) return 'about right';
    return Math.abs(b).toFixed(1) + '° too ' + (b > 0 ? 'warm' : 'cold');
  }
  function pct(missRate) { return Math.round((1 - missRate) * 100) + '%'; }
  function listNames(a) { return a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]; }
  function aheadText(lead) { return lead + ' day' + (lead === 1 ? '' : 's') + ' ahead'; }

  function tableHTML(res, by, imperial) {
    var r = rank(res, by);
    var cls = function (k) { return 'num' + (k === by ? ' ranked' : ''); };
    var h = '<table class="acc"><thead><tr><th scope="col" class="pos">#</th><th scope="col">Model</th>' +
      '<th scope="col" class="' + cls('temp') + '">Temperature<span class="u">avg error</span></th>' +
      '<th scope="col" class="' + cls('hi') + '">Highs<span class="u">avg error</span></th>' +
      '<th scope="col" class="' + cls('lo') + '">Lows<span class="u">avg error</span></th>' +
      '<th scope="col">Tends to run</th>' +
      '<th scope="col" class="' + cls('rain') + '">Rain<span class="u">wet/dry right</span></th>' +
      '<th scope="col" class="num">Days</th></tr></thead><tbody>';
    r.rows.forEach(function (row) {
      var m = row.m, mm = m.mean;
      h += '<tr class="' + (row.pos === 1 ? 'lead' : row.tie ? 'tie' : '') + '">' +
        '<td class="pos">' + (row.pos <= 3 ? '<span class="medal" aria-hidden="true">' + MEDAL[row.pos - 1] + '</span>' : '') + row.pos + '</td>' +
        '<th scope="row">' + esc(m.name) + '<span class="org">' + esc(m.org) + '</span>' +
        (row.tie ? '<span class="acc-tie">too close to call</span>' : '') + '</th>' +
        '<td class="' + cls('temp') + '">' + (mm.temp == null ? '–' : deg(mm.temp, imperial)) + '</td>' +
        '<td class="' + cls('hi') + '">' + (mm.hi == null ? '–' : deg(mm.hi, imperial)) + '</td>' +
        '<td class="' + cls('lo') + '">' + (mm.lo == null ? '–' : deg(mm.lo, imperial)) + '</td>' +
        '<td>' + biasText(m.bias, imperial) + '</td>' +
        '<td class="' + cls('rain') + '">' + (mm.rain == null ? '–' : pct(mm.rain)) + '</td>' +
        '<td class="num">' + (by === 'rain' ? m.rainN : m.n) + '</td></tr>';
    });
    h += '</tbody></table>';
    if (r.left.length) h += '<p class="acc-note">Not ranked (fewer than ' + MIN_DAYS + ' scoreable days here): ' +
      esc(listNames(r.left.map(function (m) { return m.name; }))) + '.</p>';
    return h;
  }

  function summaryHTML(res, by, imperial) {
    var r = rank(res, by);
    if (!r.rows.length) return 'Not enough forecasts to score this place for the period.';
    var top = r.rows[0].m, mm = top.mean;
    var what = by === 'rain' ? 'It called the day wet or dry correctly on ' + pct(mm.rain) + ' of days.'
      : by === 'hi' ? 'Its forecast highs were off by ' + deg(mm.hi, imperial) + ' on average.'
      : by === 'lo' ? 'Its forecast lows were off by ' + deg(mm.lo, imperial) + ' on average.'
      : 'Its forecast highs and lows were off by ' + deg(mm.temp, imperial) + ' on average.';
    var ties = r.rows.filter(function (x) { return x.tie; }).map(function (x) { return x.m.name; });
    var last = r.rows[r.rows.length - 1].m;
    return 'Most accurate here, ' + aheadText(res.lead) + ': <strong>' + esc(top.name) + '</strong> (' + esc(top.org) + '). ' + what + ' ' +
      (ties.length ? 'Too close to call with it: ' + esc(listNames(ties)) + '.' : 'Clearly ahead of the rest over this period.') +
      (r.rows.length > 2 ? ' Bottom of the table: ' + esc(last.name) + ' (' + (by === 'rain' ? pct(last.mean.rain) : deg(last.mean[by], imperial)) + ').' : '');
  }

  function fmtDay(d, withYear) {
    return new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: withYear ? 'numeric' : undefined, timeZone: 'UTC' });
  }
  function captionText(res) {
    var n = res.days.length;
    if (!n) return '';
    return 'Forecasts made ' + aheadText(res.lead) + ', checked against ERA5 for ' + n + ' days, ' +
      fmtDay(res.days[0], false) + ' – ' + fmtDay(res.days[n - 1], true) + '; ' + res.wetDays + ' of them wet (1 mm or more).';
  }

  var core = { MODELS: MODELS, LEADS: LEADS, PERIODS: PERIODS, windowFor: windowFor, prevUrl: prevUrl, truthUrl: truthUrl,
    score: score, rank: rank, tooClose: tooClose, tableHTML: tableHTML, summaryHTML: summaryHTML, captionText: captionText, esc: esc };
  if (typeof module !== 'undefined' && module.exports) { module.exports = core; return; }

  /* ---------------- browser ---------------- */

  var $ = function (s) { return document.querySelector(s); };
  var OWN_KEY = 'cw-acc-v1', MAIN_KEY = 'cw-v3';   // MAIN_KEY: the forecast page's saved place, units and colour mode (read only)
  var state = { place: null, lead: 3, period: 30, by: 'temp', imperial: false };
  var cache = {}, seq = 0;

  function readJson(k) { try { return JSON.parse(localStorage.getItem(k) || 'null') || {}; } catch (e) { return {}; } }
  function setStatus(msg, err) { var s = $('#status'); s.textContent = msg || ''; s.classList.toggle('err', !!err); }

  function load() {
    var main = readJson(MAIN_KEY), own = readJson(OWN_KEY), q = new URLSearchParams(location.search);
    if (main.mode === 'dark') document.documentElement.setAttribute('data-mode', 'dark');
    state.imperial = main.units === 'imperial';
    if (main.place && isFinite(+main.place.lat) && isFinite(+main.place.lon)) {
      state.place = { name: main.place.name || '', where: main.place.where || '', lat: +main.place.lat, lon: +main.place.lon };
    }
    if (LEADS.indexOf(own.lead) >= 0) state.lead = own.lead;
    if (PERIODS.indexOf(own.period) >= 0) state.period = own.period;
    if (BY.indexOf(own.by) >= 0) state.by = own.by;
    // a shared link wins
    var at = (q.get('at') || '').split(',');
    if (at.length === 2 && isFinite(+at[0]) && isFinite(+at[1]) && Math.abs(+at[0]) <= 90 && Math.abs(+at[1]) <= 180) {
      state.place = { name: q.get('n') || (+at[0]).toFixed(2) + ', ' + (+at[1]).toFixed(2), where: q.get('w') || '', lat: +at[0], lon: +at[1] };
    }
    if (LEADS.indexOf(+q.get('lead')) >= 0) state.lead = +q.get('lead');
    if (PERIODS.indexOf(+q.get('days')) >= 0) state.period = +q.get('days');
    if (BY.indexOf(q.get('by')) >= 0) state.by = q.get('by');
  }

  function save() {
    try { localStorage.setItem(OWN_KEY, JSON.stringify({ lead: state.lead, period: state.period, by: state.by })); } catch (e) { /* private mode */ }
    if (!state.place) return;
    var q = new URLSearchParams();
    q.set('at', state.place.lat.toFixed(4) + ',' + state.place.lon.toFixed(4));
    if (state.place.name) q.set('n', state.place.name);
    if (state.place.where) q.set('w', state.place.where);
    if (state.lead !== 3) q.set('lead', state.lead);
    if (state.period !== 30) q.set('days', state.period);
    if (state.by !== 'temp') q.set('by', state.by);
    history.replaceState(null, '', location.pathname + '?' + q.toString());
    var f = new URLSearchParams();
    f.set('at', q.get('at')); if (state.place.name) f.set('n', state.place.name); if (state.place.where) f.set('w', state.place.where);
    $('#toForecast').href = '/?' + f.toString();
  }

  function renderPlace() {
    var p = state.place;
    $('#placeName').textContent = p ? p.name : 'Choose a place';
    $('#placeMeta').textContent = p ? (p.where ? p.where + ' · ' : '') + p.lat.toFixed(2) + ', ' + p.lon.toFixed(2) : 'Search above, or press Find me';
    $('#tableTitle').textContent = p ? 'League table: ' + p.name : 'League table';
  }

  function pressed(groupSel, attr, val) {
    document.querySelectorAll(groupSel + ' button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute(attr) === String(val))); });
  }

  function draw(res) {
    $('#summary').innerHTML = core.summaryHTML(res, state.by, state.imperial);
    $('#tableWrap').innerHTML = core.tableHTML(res, state.by, state.imperial);
    $('#caption').textContent = core.captionText(res);
  }

  function getJson(u, what) {
    return fetch(u.toString()).then(function (r) {
      if (!r.ok) throw new Error(what + ' answered ' + r.status);
      return r.json();
    }).then(function (j) {
      if (j && j.error) throw new Error(what + ': ' + (j.reason || 'error'));
      return j;
    });
  }

  function run() {
    pressed('#lead', 'data-lead', state.lead); pressed('#period', 'data-period', state.period); pressed('#by', 'data-by', state.by);
    renderPlace(); save();
    if (!state.place) { setStatus('Search for a place above, or press Find me, to score the models there.'); return; }
    var p = state.place, key = [p.lat.toFixed(3), p.lon.toFixed(3), state.lead, state.period, state.imperial].join('|');
    if (cache[key]) { setStatus(''); draw(cache[key]); return; }
    var mine = ++seq, win = core.windowFor(state.period, Date.now());
    $('#summary').textContent = ''; $('#tableWrap').textContent = ''; $('#caption').textContent = '';
    setStatus('Fetching ' + state.period + ' days of forecasts and what actually happened…');
    Promise.all([
      getJson(core.prevUrl(p, state.lead, win, state.imperial), 'Previous runs'),
      getJson(core.truthUrl(p, win, state.imperial), 'ERA5 archive')
    ]).then(function (r) {
      if (mine !== seq) return;
      var res = core.score(r[0], r[1], state.lead);
      if (!res.days.length) { setStatus('ERA5 has no data for this place and period yet.', true); return; }
      cache[key] = res; setStatus(''); draw(res);
    }).catch(function (e) {
      if (mine !== seq) return;
      setStatus('Could not score this place: ' + e.message + '. Try again in a minute.', true);
    });
  }

  /* place search: Photon (OpenStreetMap) first, Open-Meteo's geocoder as fallback — as on the forecast page */
  function photonPlace(f) {
    var pr = f.properties || {};
    var name = pr.name || pr.city || pr.state || pr.country || '?', where = [];
    [pr.district, pr.locality, pr.city, pr.county, pr.state, pr.country].forEach(function (x) { if (x && x !== name && where.indexOf(x) < 0) where.push(x); });
    return { name: name, where: where.join(', '), type: (pr.osm_value || '').replace(/_/g, ' '),
      lat: +f.geometry.coordinates[1].toFixed(4), lon: +f.geometry.coordinates[0].toFixed(4) };
  }
  function geocode(q) {
    var u = new URL('https://photon.komoot.io/api/');
    u.searchParams.set('q', q); u.searchParams.set('limit', '8'); u.searchParams.set('lang', 'en');
    var om = function () {
      var v = new URL('https://geocoding-api.open-meteo.com/v1/search');
      v.searchParams.set('name', q); v.searchParams.set('count', '8'); v.searchParams.set('language', 'en'); v.searchParams.set('format', 'json');
      return getJson(v, 'Geocoder').then(function (j) {
        return (j.results || []).map(function (r) { return { name: r.name, where: [r.admin1, r.country].filter(Boolean).join(', '), type: '', lat: r.latitude, lon: r.longitude }; });
      });
    };
    return getJson(u, 'Photon').then(function (j) {
      var list = (j.features || []).map(photonPlace);
      return list.length ? list : om();
    }, om);
  }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function showResults(list) {
    var ul = $('#locResults');
    ul.textContent = '';
    if (!list.length) ul.appendChild(el('li', 'empty', 'No places found'));
    list.forEach(function (p) {
      var b = el('button', null, p.name), li = el('li');
      b.type = 'button';
      if (p.type) b.appendChild(el('span', 'type', p.type));
      b.appendChild(el('span', 'where', (p.where ? p.where + ' · ' : '') + p.lat.toFixed(2) + ', ' + p.lon.toFixed(2)));
      b.addEventListener('click', function () { ul.hidden = true; $('#locInput').value = ''; state.place = p; run(); });
      li.appendChild(b); ul.appendChild(li);
    });
    ul.hidden = false;
  }
  function findMe() {
    var btn = $('#findMe');
    btn.disabled = true;
    setStatus('Asking the browser for your location…');
    navigator.geolocation.getCurrentPosition(function (pos) {
      btn.disabled = false;
      var lat = +pos.coords.latitude.toFixed(4), lon = +pos.coords.longitude.toFixed(4);
      state.place = { name: 'Your location', where: '', lat: lat, lon: lon };
      run();
      var u = new URL('https://photon.komoot.io/reverse');
      u.searchParams.set('lat', lat); u.searchParams.set('lon', lon); u.searchParams.set('lang', 'en');
      getJson(u, 'Photon').then(function (j) {
        var f = j.features && j.features[0], pr = f && f.properties;
        if (!pr || !state.place || state.place.lat !== lat) return;
        state.place.name = pr.district || pr.locality || pr.city || pr.county || pr.name || 'Your location';
        state.place.where = [pr.city, pr.state, pr.country].filter(function (x) { return x && x !== state.place.name; }).join(', ');
        renderPlace(); save();
      }).catch(function () { /* keep "Your location" */ });
    }, function (err) {
      btn.disabled = false;
      setStatus('Could not get your location (' + (err.code === 1 ? 'permission was refused' : err.code === 2 ? 'no position available' : 'it timed out') + '). Search for a place instead.', true);
    }, { timeout: 15000, maximumAge: 600000 });
  }

  document.addEventListener('DOMContentLoaded', function () {
    load();
    $('#lead').addEventListener('click', function (e) { var b = e.target.closest('button'); if (b) { state.lead = +b.getAttribute('data-lead'); run(); } });
    $('#period').addEventListener('click', function (e) { var b = e.target.closest('button'); if (b) { state.period = +b.getAttribute('data-period'); run(); } });
    $('#by').addEventListener('click', function (e) { var b = e.target.closest('button'); if (b) { state.by = b.getAttribute('data-by'); run(); } });
    $('#locForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var q = $('#locInput').value.trim();
      if (!q) return;
      setStatus('Searching…');
      geocode(q).then(function (list) { setStatus(''); showResults(list); }, function () { setStatus('Place search failed. Try again.', true); });
    });
    document.addEventListener('click', function (e) { if (!e.target.closest('#locForm')) $('#locResults').hidden = true; });
    if (navigator.geolocation) $('#findMe').addEventListener('click', findMe); else $('#findMe').hidden = true;
    run();
  });
})();
