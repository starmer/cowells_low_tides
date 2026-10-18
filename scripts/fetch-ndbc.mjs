// Fetch NDBC realtime buoy data and write a small JSON file the site can read.
// NDBC doesn't send CORS headers, so the page can't fetch it directly; a
// scheduled GitHub Action runs this and commits the result to the `data`
// branch (see .github/workflows/ndbc.yml).
//
// Usage: node scripts/fetch-ndbc.mjs <outDir> [stationId ...]   (default 46042)
//
// Exits non-zero without writing anything if NDBC can't be reached or has no
// wave height, so a bad run never replaces good data.

import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

const M_TO_FT = 3.28084;
const MS_TO_KT = 1.94384;
const SERIES_HOURS = 48;
const FIELD_MAX_AGE = 60 * 60 * 1000; // take a missing field from a row at most an hour older

// NDBC text files: two header lines (names, units), then rows newest first,
// space separated, "MM" for missing.
function parseTable(text) {
  const lines = text.trim().split("\n");
  const names = lines[0].replace(/^#/, "").trim().split(/\s+/);
  return lines
    .slice(2)
    .map((line) => {
      const cols = line.trim().split(/\s+/);
      const row = {};
      names.forEach((n, i) => {
        row[n] = cols[i];
      });
      const [y, mo, d, h, mi] = ["YY", "MM", "DD", "hh", "mm"].map((k) => Number(row[k]));
      row.time = Date.UTC(y, mo - 1, d, h, mi);
      return row;
    })
    .filter((r) => !Number.isNaN(r.time));
}

function num(v, missingAbove = Infinity) {
  if (v === undefined || v === "MM" || v === "N/A") return null;
  const n = Number(v);
  return Number.isFinite(n) && n < missingAbove && n >= 0 ? n : null;
}

const round1 = (n) => (n == null ? null : Math.round(n * 10) / 10);

// Wave/wind fields from a standard meteorological row, converted.
function readRow(r) {
  const wvht = num(r.WVHT, 99);
  const wtmp = num(r.WTMP, 99);
  const wspd = num(r.WSPD, 99);
  const gst = num(r.GST, 99);
  return {
    heightFt: wvht == null ? null : round1(wvht * M_TO_FT),
    periodS: num(r.DPD, 99),
    avgPeriodS: num(r.APD, 99),
    directionDeg: num(r.MWD, 999),
    windKt: wspd == null ? null : Math.round(wspd * MS_TO_KT),
    gustKt: gst == null ? null : Math.round(gst * MS_TO_KT),
    windDirDeg: num(r.WDIR, 999),
    waterTempF: wtmp == null ? null : Math.round(wtmp * 1.8 + 32),
  };
}

// Newest row with a wave height; any field it's missing comes from the
// newest row within an hour that has it.
function latestReading(rows) {
  const anchor = rows.find((r) => readRow(r).heightFt != null);
  if (!anchor) return null;
  const nearby = rows.filter((r) => r.time <= anchor.time && anchor.time - r.time <= FIELD_MAX_AGE).map(readRow);
  const out = { time: new Date(anchor.time).toISOString() };
  for (const key of Object.keys(nearby[0])) {
    out[key] = nearby.find((v) => v[key] != null)?.[key] ?? null;
  }
  return out;
}

// One point per hour for the last SERIES_HOURS: the newest valid row in each hour.
function hourlySeries(rows) {
  const since = rows[0].time - SERIES_HOURS * 3600 * 1000;
  const byHour = new Map();
  for (const r of rows) {
    if (r.time < since) break;
    const v = readRow(r);
    if (v.heightFt == null) continue;
    const hour = Math.floor(r.time / 3600000) * 3600000;
    if (!byHour.has(hour)) {
      byHour.set(hour, {
        time: new Date(hour).toISOString(),
        heightFt: v.heightFt,
        periodS: v.periodS,
        directionDeg: v.directionDeg,
      });
    }
  }
  return [...byHour.values()].reverse();
}

// Swell/wind-wave split from the .spec file, when the buoy reports it.
function latestSplit(rows) {
  const r = rows.find((row) => num(row.SwH, 99) != null);
  if (!r) return null;
  return {
    time: new Date(r.time).toISOString(),
    swellHeightFt: round1(num(r.SwH, 99) * M_TO_FT),
    swellPeriodS: num(r.SwP, 99),
    swellDirection: r.SwD === "MM" ? null : r.SwD,
    windWaveHeightFt: num(r.WWH, 99) == null ? null : round1(num(r.WWH, 99) * M_TO_FT),
    windWavePeriodS: num(r.WWP, 99),
    windWaveDirection: r.WWD === "MM" ? null : r.WWD,
  };
}

async function getText(url) {
  const response = await fetch(url, { headers: { "User-Agent": "santa-cruz-tides (github.com/starmer/cowells_low_tides)" } });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.text();
}

async function station(id) {
  const base = `https://www.ndbc.noaa.gov/data/realtime2/${id}`;
  const rows = parseTable(await getText(`${base}.txt`));
  const latest = latestReading(rows);
  if (!latest) throw new Error(`${id}: no row with a wave height`);

  let split = null;
  try {
    split = latestSplit(parseTable(await getText(`${base}.spec`)));
  } catch {
    // The split is optional; many buoys don't report it.
  }

  return { station: id, fetchedAt: new Date().toISOString(), latest, split, series: hourlySeries(rows) };
}

const [outDir, ...ids] = process.argv.slice(2);
if (!outDir) {
  console.error("Usage: node scripts/fetch-ndbc.mjs <outDir> [stationId ...]");
  process.exit(2);
}

await mkdir(outDir, { recursive: true });
for (const id of ids.length ? ids : ["46042"]) {
  const data = await station(id);
  const file = join(outDir, `ndbc-${id}.json`);
  await writeFile(file, JSON.stringify(data, null, 1) + "\n");
  const l = data.latest;
  console.log(`${file}: ${l.heightFt}ft ${l.periodS}s ${l.directionDeg}° at ${l.time}, ${data.series.length} hourly points`);
}
