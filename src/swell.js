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

// Swell components for the current hour, most significant first. Ranked by
// H²·T, a rough stand-in for wave energy, so a small long-period swell can
// outrank a taller short-period one (the way Surfline ranks them).
export function fetchSwellComponents(lat, lon) {
  return cached(`om-${lat}-${lon}`, async () => {
    const parts = ["swell_wave", "secondary_swell_wave", "tertiary_swell_wave", "wind_wave"];
    const params = new URLSearchParams({
      latitude: lat,
      longitude: lon,
      models: "ncep_gfswave016",
      hourly: parts.flatMap((p) => [`${p}_height`, `${p}_period`, `${p}_direction`]).join(","),
      length_unit: "imperial",
      timezone: "America/Los_Angeles",
      forecast_days: 1,
    });
    const response = await fetch(`https://marine-api.open-meteo.com/v1/marine?${params}`);
    const json = await response.json();
    if (json.error) throw new Error(json.reason);

    const hour = new Date().getHours();
    const h = json.hourly;
    return parts
      .map((p) => ({
        height: h[`${p}_height`][hour],
        period: h[`${p}_period`][hour],
        direction: h[`${p}_direction`][hour],
        wind: p === "wind_wave",
      }))
      .filter((c) => c.height != null && c.period != null && c.direction != null && c.height >= 0.5)
      .sort((a, b) => a.wind - b.wind || b.height ** 2 * b.period - a.height ** 2 * a.period);
  });
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

// Latest good reading from a CDIP dataset with waveTime/Hs/Tp/Dp variables
// (a realtime buoy file or a MOP nowcast). Looks up the series length first,
// then fetches only the last few records and takes the newest one that
// passes CDIP's quality flag (1 = good).
async function fetchCdipLatest(path) {
  const dds = await (await fetch(`${THREDDS}/${path}.dds`)).text();
  const n = Number(dds.match(/waveTime\[waveTime = (\d+)\]/)?.[1]);
  if (!n) throw new Error(`No waveTime in ${path}`);

  const range = encodeURIComponent(`[${Math.max(0, n - 6)}:1:${n - 1}]`);
  const vars = ["waveTime", "waveHs", "waveTp", "waveDp", "waveFlagPrimary"].map((v) => v + range).join(",");
  const d = parseOpendapAscii(await (await fetch(`${THREDDS}/${path}.ascii?${vars}`)).text());

  for (let i = d.waveTime.length - 1; i >= 0; i--) {
    if (d.waveFlagPrimary[i] !== 1 || !(d.waveHs[i] > 0)) continue;
    return {
      time: d.waveTime[i] * 1000,
      height: d.waveHs[i] * M_TO_FT,
      period: d.waveTp[i],
      direction: d.waveDp[i],
    };
  }
  return null;
}

// Modeled nearshore waves at a CDIP MOP point, e.g. "SC149".
export function fetchMopNowcast(pointId) {
  return cached(`mop-${pointId}`, () => fetchCdipLatest(`model/MOP_alongshore/${pointId}_nowcast.nc`));
}

// Latest observed reading from a CDIP buoy, e.g. "156".
export function fetchBuoyLatest(cdipId) {
  return cached(`buoy-${cdipId}`, () => fetchCdipLatest(`realtime/${cdipId}p1_rt.nc`));
}
