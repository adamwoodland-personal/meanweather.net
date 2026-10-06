# meanweather.net

**Live: <https://meanweather.net/>**

Nine global weather forecast models in one compact table. Each cell shows the **minimum, mean
and maximum** forecast across the models, one row per day, so you can see at a glance where they
agree and where they don't. Free, no account, no adverts, nothing tracked.

## What it does

- **One row per day**, expandable into hourly rows (or 3-hour blocks) with the same
  `min mean max` format. Purple outer numbers mean the models disagree by more than a threshold
  that depends on the column (4 °C for temperature, 5 mm for rain, 40 % for cloud, and so on).
- **Nine models via Open-Meteo:** ECMWF IFS, ECMWF AIFS, NOAA GFS, DWD ICON, Met Office UKMO,
  Météo-France ARPEGE, ECCC GEM, JMA and CMA GRAPES. The "seamless" variants blend each agency's
  regional high-resolution model where one exists, so the same list works worldwide. Switch any
  model off and every cell recomputes.
- **19 columns to choose from**, drag or arrow them into any order: temperature high/low,
  feels-like, rain, chance of rain, wet hours, snow, wind, wind average, gusts, wind direction
  (circular mean), cloud, humidity, dew point, pressure, sunshine, UV and a "Sky" summary
  (the most common WMO weather code, with how many models agree).
- **Trend arrows** on most number columns (High, Low, Feels high/low, Rain, Snow, Wind, Wind avg,
  Gusts, Cloud, Humidity, Dew point, Pressure, Sunshine): whether the models' mean has moved by a
  meaningful amount (1°, 1 mm, 5 km/h, 15% cloud…) since their run three days ago, from Open-Meteo's
  previous-runs archive. Only the columns on show are fetched; switching one on fetches its history.
  Chance and UV have none: the archive does not keep them.
- **Hover or tap any cell** for every model's value, lowest to highest. Click a column header for
  what it means.
- Place search (Photon / OpenStreetMap, with Open-Meteo's geocoder as fallback), an opt-in
  "Find me", °C/km/h/mm or °F/mph/in, and a shareable URL for any view.

## How it works

- Static files only: the forecast table (`index.html`, `style.css`, `app.js`) and the forecast
  accuracy league table (`most-accurate-weather-forecast/index.html`, `accuracy.css`,
  `accuracy.js`). No build step, no backend, no analytics scripts. Everything is served behind a
  strict Content-Security-Policy, so there is no inline JavaScript or CSS.
- The accuracy page scores the nine models for a place entirely in the browser: two more
  keyless Open-Meteo requests, the previous-runs API (each model's forecast made 1–7 days
  ahead) and the archive API pinned to ERA5 reanalysis (what actually happened). ERA5 lags
  about five days, so the scored period ends roughly a week ago.
- Three keyless, CORS-enabled Open-Meteo requests per place: daily variables (the table renders
  from this alone), hourly variables (fills the expandable rows), and the previous-runs API
  (trend arrows). All models come back in one response each.
- Aggregation is per cell across whichever models are switched on: arithmetic min/mean/max for
  numbers, a vector (circular) mean for wind direction, the mode for weather codes. In the
  3-hour view rain, snow and sunshine are summed per model and everything else averaged.
- Place, units, step, model toggles and column layout are kept in `localStorage` and mirrored
  into the URL (`?at=lat,lon&n=…&cols=…&off=…&units=…&step=…&avg=…`), so a link reproduces a view
  exactly, including which models were switched off. `tmp=1` shows a place without remembering it.
- An open tab re-fetches after an hour, or on return after 30 minutes away, and moves the
  current-hour highlight and sky theme each hour; the place line shows when the data arrived.

## Data and licences

- Forecast data: [Open-Meteo](https://open-meteo.com/), CC BY 4.0. Model coverage differs:
  precipitation probability comes from ECMWF IFS, GFS, ICON, UKMO and GEM only; gusts are not
  published by ECMWF AIFS or JMA; UV index is GFS only; sunshine is not published by JMA.
- Place search: [Photon](https://photon.komoot.io/) by komoot, data © OpenStreetMap contributors.
- Code: MIT, see `LICENSE`.

## Privacy

Two things leave your browser, both over HTTPS: the coordinates of the chosen place go to
Open-Meteo (forecast, hourly and previous-runs requests), and your search text, or your position
if you press "Find me", goes to Photon for the place lookup. Nothing else is sent anywhere. There
are no cookies, no accounts and no analytics; settings live in `localStorage` only.

## Development

Serve the folder over HTTP (for example `python -m http.server 8000`) and open
`http://localhost:8000/`. There is nothing to install or build.
