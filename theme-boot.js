/* weathermodels.app — loaded in <head> by both pages (the forecast table and /most-accurate-weather-forecast/)
 * so the background is right before the first paint, instead of flashing the daytime look:
 *   Dark mode (cw-v3.mode)                         -> plain black, as on the forecast page
 *   the forecast page's last sky for this place     -> exactly what it showed (cw-sky-v1,
 *     written by app.js's applyTheme), if under 3 hours old
 *   otherwise                                       -> night if the sun's local hour at this
 *     longitude is before 6:00 or after 18:00 (app.js's clock heuristic), no sky colour yet
 *   no place chosen yet                             -> night by this device's own clock
 * app.js (guessSky, same rules) keeps this look until the forecast arrives; accuracy.js
 * checks the current sky itself, the same way app.js does.
 */
(function () {
  try {
    var root = document.documentElement;
    var main = JSON.parse(localStorage.getItem('cw-v3') || 'null') || {};
    if (main.mode === 'dark') { root.setAttribute('data-mode', 'dark'); return; }
    var at = (new URLSearchParams(location.search).get('at') || '').split(',');
    var p = at.length === 2 && isFinite(+at[0]) && isFinite(+at[1]) ? { lat: +at[0], lon: +at[1] } : main.place;
    if (!p || !isFinite(+p.lat) || !isFinite(+p.lon)) {   // no place yet: go by this device's clock
      var lh = new Date().getHours();
      if (lh < 6 || lh >= 18) root.setAttribute('data-night', '1');
      return;
    }
    var c = JSON.parse(localStorage.getItem('cw-sky-v1') || 'null');
    if (c && Math.abs(c.lat - p.lat) < 0.0005 && Math.abs(c.lon - p.lon) < 0.0005 && Date.now() - c.t < 3 * 3600e3) {
      if (c.sky) root.setAttribute('data-sky', c.sky);
      if (c.night) root.setAttribute('data-night', '1');
      return;
    }
    var now = new Date(), h = (now.getUTCHours() + now.getUTCMinutes() / 60 + (+p.lon) / 15 + 48) % 24;
    if (h < 6 || h >= 18) root.setAttribute('data-night', '1');
  } catch (e) { /* storage blocked: the neutral look */ }
})();
