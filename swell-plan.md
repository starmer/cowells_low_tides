# Swell plan

Follows up on `swell-session-brief.md`. Everything below was checked with live requests on 2026-10-17.

## Corrections to the brief

1. **NDBC is not CORS-friendly.** `ndbc.noaa.gov/data/realtime2/*.txt` and `*.spec` return no `Access-Control-Allow-Origin` header, so a browser fetch from GitHub Pages fails. Using NDBC directly would need a proxy. We don't need it, because the sources below cover the same buoys and do send CORS headers.
2. **46236 isn't Point Sur.** It's CDIP 156, "Monterey Canyon Outer" (36.76, -121.95), the closest wave buoy to Santa Cruz at the mouth of the bay. Point Sur is 46239 (CDIP 157).
3. **46042 has gaps.** Today its wave columns are all `MM`. It's also 27 nm offshore, so it sees NW swell that Cowell's (which faces south and is sheltered by the point) mostly doesn't get.
4. **46012 (Half Moon Bay) is now a USV** with no spectral or direction data (`MWD -99`). Not useful.

## The sheltering problem

Cowell's is one of the most sheltered breaks in the area. An 8ft NW swell at 46042 can mean 1–2ft at Cowell's. One offshore buoy number would mislead people. We need two things:

- **What's in the water offshore**: the individual swell trains (height, period, direction). This is Surfline's swell card (screenshot 1).
- **What reaches Cowell's**: a nearshore height that accounts for refraction and sheltering.

## Data sources (all CORS `*`, all free, no key)

| Source | What it gives | Use |
|---|---|---|
| **Open-Meteo Marine**, model `ncep_gfswave016` | Hourly **primary / secondary / tertiary swell** height, period, and direction plus wind waves, 16 days ahead, JSON, imperial units | Swell card components; future chart |
| **CDIP MOP points** (model output at 15m depth every ~100m along the coast). `SC149` for Cowell's; `SC150`–`SC153` for Steamer Lane, Indicators and nearby breaks | Nearshore Hs, Tp, Dp. Hindcast hourly back to ~2000, nowcast to the current hour, 10-day forecast every 3h | "At Cowell's" height; per-day history on rows; per-break heights |
| **CDIP buoy 156 / NDBC 46236** via THREDDS OPeNDAP | Observed Hs, Tp, Dp, and SST every 30 min, plus the **full directional spectrum** | Live observed reading; optional partitioning from real data |
| CDIP buoy 157 (Point Sur) | Same as above | Optional second view for S/SW swell (see "More buoys") |

Endpoints:
```
https://marine-api.open-meteo.com/v1/marine?latitude=36.95&longitude=-122.03&models=ncep_gfswave016
  &hourly=swell_wave_height,swell_wave_period,swell_wave_direction,
          secondary_swell_wave_height,secondary_swell_wave_period,secondary_swell_wave_direction,
          tertiary_swell_wave_height,tertiary_swell_wave_period,tertiary_swell_wave_direction,
          wind_wave_height,wind_wave_period,wind_wave_direction
  &length_unit=imperial&timezone=America/Los_Angeles&forecast_days=16

https://thredds.cdip.ucsd.edu/thredds/dodsC/cdip/model/MOP_alongshore/SC149_{nowcast|forecast|hindcast}.nc.ascii?waveTime[a:1:b],waveHs[a:1:b],waveTp[a:1:b],waveDp[a:1:b]
https://thredds.cdip.ucsd.edu/thredds/dodsC/cdip/realtime/156p1_rt.nc.ascii?waveTime[..],waveHs[..],waveTp[..],waveDp[..]
```

Model notes: `best_match` (MeteoFrance) gives only 2 swells. `ecmwf_wam025` returns nulls here. `ncep_gfswave016` (0.16°) gave all 3, and today's values look a lot like the screenshot (SSW 13.5s, WNW 6.5s, SSW 18.7s). OPeNDAP returns a small ASCII format, so we'd write a ~20-line parser with no library. Slice by index (`[a:1:b]`); the times are hourly from a known start, so indexes can be computed.

## Phase 1: swell card (screenshot 1)

A **Swell** panel under the today row (or beside it on wide screens):

```
SWELL                          At Cowell's  1.8ft  13s  (buoy 3.2ft · 14s · WSW)
2.5ft  14s  ◥ SSW 201°   ← biggest component, bold
1.8ft  19s  ◥ SSW 199°
2.7ft   7s  ◤ WNW 301°
GFS-Wave forecast · CDIP Monterey Canyon buoy
```

- Components come from Open-Meteo for the current hour, **sorted by energy** (≈ H²·T). Surfline bolds the most significant one, and that's often the long-period swell, not the tallest.
- Drop components under ~0.5ft. Wind waves get their own muted row only when they're significant.
- The arrow is a small inline SVG triangle rotated `dir + 180` (the direction the swell travels). Each component gets its own color. That means adding **three swell colors** to `styles.css` with dark-mode variants, which is the one place we'd break the "no new colors" rule.
- "At Cowell's" comes from MOP SC149 nowcast (latest hour). The observed buoy reading comes from CDIP 156, in `--accent` gold like the live water temp.
- New functions in `src/tides.js` (or a new `src/swell.js`, since `tides.js` is getting long): `fetchSwellForecast()`, `fetchMopNowcast(pointId)`, `fetchBuoyLatest(cdipId)`. All cache in `localStorage` for ~1h, following the same key/version pattern.
- Add to `stations.js`: `mopPoint: "SC149"`, `cdipBuoy: "156"`, `swellLatLon`.

## Phase 2: swell on every day row

**Built.** Each row shows the day's **biggest** modeled wave height and its period (`2.6ft 18s`) under the temp. Hovering shows the direction too.

- Past days: MOP hindcast (hourly, 2000 to 2025-03-31) and nowcast (hourly, 2025-04-01 to now), both asked for and merged, so any year since 2000 works. Cached for good for past years and for a day for the current year, same as water temps. About 16 KB per year in `localStorage`.
- Today and the coming week: MOP forecast (3-hourly, ~6 days ahead), shown in italics. Today takes the bigger of the record so far and the forecast.
- Past the forecast: blank. We dropped the "days 11–16 from Open-Meteo" idea: Open-Meteo is offshore and unsheltered, so its numbers would jump up next to the nearshore ones. And unlike water temp, no averages fill the gap, because a made-up swell number would mislead.
- Still optional: tint or size the number by height so a big day stands out when scrolling the year.

## Phase 3: hourly swell chart (screenshot 2, later)

- An SVG like `DaySpark`: x = hours, y = height. One line per swell component with direction arrows every 3h, in the Phase 1 colors. Reuse the night shading and the pointer tooltip.
- **The hard part is tracking.** Open-Meteo's primary/secondary/tertiary ordering isn't stable from hour to hour, so a swell can jump between series. To fix that, match each hour's components to the previous hour's by nearest (period, direction) before drawing. Surfline does the same kind of swell tracking.
- Energy (kJ) like Surfline's can be computed as ∝ H²·T² if we want it.

## More buoys: worth it?

A holistic view adds the most where buoys see **different swell windows**:

- **CDIP 156 (Monterey Canyon Outer)**: primary. It's closest and sits in the bay mouth, so it's the best observed proxy for what reaches Santa Cruz.
- **NDBC 46042 (Monterey, 27nm out)**: shows raw NW energy *before* sheltering. Useful as "the swell is coming" (a large NW reading usually reaches the outer bay within hours). It needs a proxy (NDBC has no CORS), or CDIP may mirror it. Skip for now.
- **CDIP 157 (Point Sur)**: sees S/SW swell a little earlier. Moderate value in summer.

Recommendation: **build on CDIP 156 + MOP points + Open-Meteo**. That combination already gives an offshore breakdown, an observed reading, and a sheltering-corrected nearshore number. Adding 46042 means running a proxy (for example a tiny Cloudflare Worker), which breaks the "static site, no backend" setup. Treat it as a later option.

## Optional upgrade: observed swell partitions

CDIP 156's spectrum (`waveEnergyDensity` + `waveMeanDirection` × 100 frequencies) can be split into swell trains in the browser. Find peaks in the 1D spectrum, merge peaks closer than ~2s in period or ~30° in direction, and integrate each band to get Hs = 4√(∑E·df). That would make the card show *observed* components instead of modeled ones. It's maybe 60 lines of code. Worth doing after Phase 1 if the GFS partitions feel off.

## Todo

- [x] **Basic swell card** (stripped-down Phase 1): Open-Meteo swell components, the MOP "at Cowell's" height, and the latest CDIP 156 reading.
- [x] **Break picker.** "Swell at" select in the toolbar, remembered per browser. Breaks live in `stations.js`: Cowell's SC149, Steamer Lane SC150, Indicators SC151, Mitchell's Cove SC159, Pleasure Point SC117, The Hook SC116. All share the tide station, the water-temp station and CDIP 156. Points were matched from coordinates; still worth confirming on a map (open question 3).
- [ ] **NDBC 46042 via GitHub Actions.** A scheduled workflow (every 30–60 min) fetches `realtime2/46042.txt` and `.spec`, parses them into a small JSON file, and publishes it alongside the site. The page then reads its own file, so no proxy or CORS issue and still no server. Trade-offs: data up to ~1h stale (scheduled Actions can lag), plus a commit per run unless it publishes via Pages artifacts instead of committing. This would add the offshore "NW swell is coming" reading that matters most for the Lane and Indicators.
- [x] Phase 2: swell on every day row, including history back to 2000.
- [ ] Phase 3: hourly swell chart.
- [ ] Observed swell partitions from the CDIP 156 spectrum.
- [ ] Measured tide line: draw NOAA's measured water level (Monterey 9413450, `product=water_level`) over past days' predicted curves. A Kelvin wave in October 2026 ran Monterey 0.7–1.2 ft above predictions for days.
- [ ] Optional: tint day-row swell by height.

## Open questions

1. ~~Where should the swell card live?~~ Under the today row.
2. ~~Daily max or mean?~~ Max.
3. Confirm each break's MOP point on a map. SC149 sits just inside Lighthouse Point, and SC150 is directly off it (Steamer Lane). The 15m points are 0.5–2km out, so Cowell's, which is inside the 15m contour, may read higher than it really is. SC136–147 and SC155–157 share identical coordinates in the metadata, which looks like a CDIP quirk, so those points are avoided.
