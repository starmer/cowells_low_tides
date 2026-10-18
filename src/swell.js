// ── Swell ────────────────────────────────────────────────────────────────────
// Three sources, all CORS-enabled:
//   Open-Meteo Marine (NOAA GFS-Wave): offshore swell broken into components.
//   CDIP MOP: modeled nearshore waves at 15m depth for a point off the beach,
//     with refraction and sheltering already applied.
//   CDIP buoy: the latest observed reading.
// Everything is cached in localStorage for a short while, since it changes
// hourly (model) or every 30 minutes (buoy).

const SWELL_CACHE_VERSION = 1;
const SWELL_TTL = 30 * 60 * 1000;
const M_TO_FT = 3.28084;

const THREDDS = "https://thredds.cdip.ucsd.edu/thredds/dodsC/cdip";

async function cached(key, load) {
  const fullKey = `swell-v${SWELL_CACHE_VERSION}-${key}`;
  try {
    const raw = localStorage.getItem(fullKey);
    if (raw) {
      const { fetchedAt, value } = JSON.parse(raw);
      if (Date.now() - fetchedAt < SWELL_TTL) return value;
    }
  } catch {}
  const value = await load();
  try {
    localStorage.setItem(fullKey, JSON.stringify({ fetchedAt: Date.now(), value }));
  } catch {}
  return value;
}

export function compassDir(deg) {
  const dirs = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  return dirs[Math.round(deg / 22.5) % 16];
}

// Offshore swell components for every hour of the next 10 days:
// [{ time, components }], where components are the swells most significant
// first, then wind swell. Ranked by H²·T, a rough stand-in for wave energy,
// so a small long-period swell can outrank a taller short-period one (the
// way Surfline ranks them). Components under half a foot are dropped.
export function fetchSwellHourly(lat, lon) {
  return cached(`om-hourly-${lat}-${lon}`, async () => {
    const parts = ["swell_wave", "secondary_swell_wave", "tertiary_swell_wave", "wind_wave"];
    const params = new URLSearchParams({
      latitude: lat,
      longitude: lon,
      models: "ncep_gfswave016",
      hourly: parts.flatMap((p) => [`${p}_height`, `${p}_period`, `${p}_direction`]).join(","),
      length_unit: "imperial",
      timezone: "America/Los_Angeles",
      forecast_days: 10,
    });
    const response = await fetch(`https://marine-api.open-meteo.com/v1/marine?${params}`);
    const json = await response.json();
    if (json.error) throw new Error(json.reason);

    const h = json.hourly;
    return h.time.map((t, i) => {
      // "YYYY-MM-DDTHH:MM" in Pacific time, kept as local time like the tides.
      const [y, mo, d, hr] = t.split(/[-T:]/).map(Number);
      const components = parts
        .map((p) => ({
          height: h[`${p}_height`][i],
          period: h[`${p}_period`][i],
          direction: h[`${p}_direction`][i],
          wind: p === "wind_wave",
        }))
        .filter((c) => c.height != null && c.period != null && c.direction != null && c.height >= 0.5)
        .sort((a, b) => a.wind - b.wind || b.height ** 2 * b.period - a.height ** 2 * a.period);
      return { time: new Date(y, mo - 1, d, hr).getTime(), components };
    });
  });
}

// Components for the hour containing `ms`, or null outside the forecast.
export function componentsAt(hours, ms) {
  const hour = hours.find((h) => ms >= h.time && ms < h.time + 3600000);
  return hour ? hour.components : null;
}

// OPeNDAP's ASCII response: a header, a dashed line, then one block per
// variable, either "name, value" (scalar) or "name[n]" followed by
// "v1, v2, …". Returns { name: number[] }.
function parseOpendapAscii(text) {
  const body = text.split(/^-+$/m)[1] ?? "";
  const out = {};
  const lines = body.split("\n").map((l) => l.trim()).filter(Boolean);
  for (let i = 0; i < lines.length; i++) {
    const arr = lines[i].match(/^(\w+)\[\d+\]$/);
    if (arr) {
      out[arr[1]] = lines[++i].split(",").map(Number);
      continue;
    }
    const scalar = lines[i].match(/^(\w+), (.+)$/);
    if (scalar) out[scalar[1]] = [Number(scalar[2])];
  }
  return out;
}

async function cdipLength(path) {
  const dds = await (await fetch(`${THREDDS}/${path}.dds`)).text();
  const n = Number(dds.match(/waveTime\[waveTime = (\d+)\]/)?.[1]);
  if (!n) throw new Error(`No waveTime in ${path}`);
  return n;
}

// Records i0..i1 of a CDIP dataset with waveTime/Hs/Tp/Dp variables (a
// realtime buoy file or a MOP point), keeping only those that pass CDIP's
// quality flag (1 = good). Heights in feet, times in ms.
async function cdipRecords(path, i0, i1) {
  const range = encodeURIComponent(`[${i0}:1:${i1}]`);
  const vars = ["waveTime", "waveHs", "waveTp", "waveDp", "waveFlagPrimary"].map((v) => v + range).join(",");
  const d = parseOpendapAscii(await (await fetch(`${THREDDS}/${path}.ascii?${vars}`)).text());
  const records = [];
  (d.waveTime ?? []).forEach((t, i) => {
    if (d.waveFlagPrimary[i] !== 1 || !(d.waveHs[i] > 0)) return;
    records.push({ time: t * 1000, height: d.waveHs[i] * M_TO_FT, period: d.waveTp[i], direction: d.waveDp[i] });
  });
  return records;
}

// Latest good reading: fetch only the last few records.
async function fetchCdipLatest(path) {
  const n = await cdipLength(path);
  const records = await cdipRecords(path, Math.max(0, n - 6), n - 1);
  return records[records.length - 1] ?? null;
}

// Records between two times. MOP series are evenly spaced, so the index range
// comes from the first two timestamps rather than downloading every time.
async function fetchCdipRange(path, start, end) {
  const n = await cdipLength(path);
  const range = encodeURIComponent("[0:1:1]");
  const first = parseOpendapAscii(await (await fetch(`${THREDDS}/${path}.ascii?waveTime${range}`)).text());
  const [t0, t1] = first.waveTime.map((t) => t * 1000);
  const step = t1 - t0;
  const i0 = Math.max(0, Math.floor((start - t0) / step));
  const i1 = Math.min(n - 1, Math.ceil((end - t0) / step));
  if (i0 > i1) return [];
  const records = await cdipRecords(path, i0, i1);
  return records.filter((r) => r.time >= start && r.time < end);
}

function localDayKey(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// The biggest reading of each local day: { "YYYY-MM-DD": { height, period, direction } },
// with the period and direction from that same hour. Heights rounded to 0.1 ft.
export function dailyMax(records) {
  const days = {};
  records.forEach(({ time, height, period, direction }) => {
    const key = localDayKey(time);
    if (!days[key] || height > days[key].height) {
      days[key] = { height: Math.round(height * 10) / 10, period: Math.round(period), direction: Math.round(direction) };
    }
  });
  return days;
}

// Modeled nearshore waves at a CDIP MOP point, e.g. "SC149".
export function fetchMopNowcast(pointId) {
  return cached(`mop-${pointId}`, () => fetchCdipLatest(`model/MOP_alongshore/${pointId}_nowcast.nc`));
}

// Latest observed reading from a CDIP buoy, e.g. "156".
export function fetchBuoyLatest(cdipId) {
  return cached(`buoy-${cdipId}`, () => fetchCdipLatest(`realtime/${cdipId}p1_rt.nc`));
}

// Daily max nearshore waves for a calendar year at a MOP point, up to now.
// The hindcast covers 2000 to early 2025 and the nowcast everything since, so
// both are asked for and whichever overlaps the year answers. Same caching as
// water temps: past years are kept for good, the current year for a day.
const DAILY_SWELL_CACHE_VERSION = 1;

export async function fetchYearDailySwell(pointId, year) {
  const thisYear = new Date().getFullYear();
  if (year > thisYear) return null;

  const key = `swell-daily-v${DAILY_SWELL_CACHE_VERSION}-${pointId}-${year}`;
  const today = localDayKey(Date.now());
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const { fetchedOn, days } = JSON.parse(raw);
      if (year < thisYear || fetchedOn === today) return days;
    }
  } catch {}

  const start = new Date(year, 0, 1).getTime();
  const end = Math.min(new Date(year + 1, 0, 1).getTime(), Date.now());
  const base = `model/MOP_alongshore/${pointId}`;
  try {
    const parts = await Promise.all([
      fetchCdipRange(`${base}_hindcast.nc`, start, end),
      fetchCdipRange(`${base}_nowcast.nc`, start, end),
    ]);
    const days = dailyMax(parts.flat());
    try {
      localStorage.setItem(key, JSON.stringify({ fetchedOn: today, days }));
    } catch {}
    return days;
  } catch {
    return null;
  }
}

// MOP forecast records (3-hourly, about a week ahead) from the start of today.
export function fetchMopForecast(pointId) {
  return cached(`mop-fc-records-${pointId}`, async () => {
    const path = `model/MOP_alongshore/${pointId}_forecast.nc`;
    const n = await cdipLength(path);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const records = await cdipRecords(path, 0, n - 1);
    return records.filter((r) => r.time >= today.getTime());
  });
}

// Hourly wind for the next 10 days from Open-Meteo's weather forecast:
// [{ time, speed (knots), gusts, direction (degrees, where it blows from) }].
export function fetchWindHourly(lat, lon) {
  return cached(`wind-hourly-${lat}-${lon}`, async () => {
    const params = new URLSearchParams({
      latitude: lat,
      longitude: lon,
      hourly: "wind_speed_10m,wind_direction_10m,wind_gusts_10m",
      wind_speed_unit: "kn",
      timezone: "America/Los_Angeles",
      forecast_days: 10,
    });
    const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
    const json = await response.json();
    if (json.error) throw new Error(json.reason);
    const h = json.hourly;
    return h.time.map((t, i) => {
      const [y, mo, d, hr] = t.split(/[-T:]/).map(Number);
      return {
        time: new Date(y, mo - 1, d, hr).getTime(),
        speed: h.wind_speed_10m[i],
        gusts: h.wind_gusts_10m[i],
        direction: h.wind_direction_10m[i],
      };
    });
  });
}
