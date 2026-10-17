// NOAA returns "YYYY-MM-DD HH:MM" in station local time. Parse it by hand
// (Safari won't parse the space-separated form) and keep it as local time.
function parseNoaaTime(t) {
  const [date, time] = t.split(" ");
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  return new Date(y, m - 1, d, hh, mm);
}

function noaaDate(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
}

// Cache keyed by station + year. Dates are stored as ms timestamps so they
// survive JSON serialization without re-parsing. Version bump = cache bust.
const CACHE_VERSION = 1;

function cacheKey(stationId, year) {
  return `tides-v${CACHE_VERSION}-${stationId}-${year}`;
}

function readCache(stationId, year) {
  try {
    const raw = localStorage.getItem(cacheKey(stationId, year));
    if (!raw) return null;
    const items = JSON.parse(raw);
    // Rehydrate timestamps back into Date objects.
    return items.map((p) => ({ ...p, date: new Date(p.date) }));
  } catch {
    return null;
  }
}

function writeCache(stationId, year, extremes) {
  try {
    // Store dates as numeric timestamps — no parsing on the way out.
    const items = extremes.map((p) => ({ ...p, date: p.date.getTime() }));
    localStorage.setItem(cacheKey(stationId, year), JSON.stringify(items));
  } catch {
    // localStorage full or unavailable — silently skip.
  }
}

// High/low predictions for a calendar year, padded by a day on each side so
// the curve at the edges of Jan 1 and Dec 31 has neighbors to interpolate to.
export async function fetchYearExtremes(stationId, year) {
  const cached = readCache(stationId, year);
  if (cached) return cached;

  const params = new URLSearchParams({
    product: "predictions",
    application: "NOS.COOPS.TAC.WL",
    begin_date: noaaDate(new Date(year - 1, 11, 31)),
    end_date: noaaDate(new Date(year + 1, 0, 1)),
    datum: "MLLW",
    station: stationId,
    time_zone: "lst_ldt",
    units: "english",
    interval: "hilo",
    format: "json",
  });
  const response = await fetch(
    `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?${params}`
  );
  const json = await response.json();
  if (json.error) throw new Error(json.error.message);

  const extremes = json.predictions.map((p) => ({
    date: parseNoaaTime(p.t),
    height: parseFloat(p.v),
    type: p.type, // "H" | "L"
  }));

  writeCache(stationId, year, extremes);
  return extremes;
}

// ── Water temperature ────────────────────────────────────────────────────────
// Daily average temps, keyed "YYYY-MM-DD" → integer °F.
//
// Past/current year: fetched from NOAA hourly readings, averaged per day.
//   Cache is busted whenever today's date differs from when it was written,
//   so it stays at most one day stale.
//
// Complete past years (year < thisYear): fetched once, cached permanently —
//   the data will never change.

const TEMP_CACHE_VERSION = 1;

function tempCacheKey(stationId, year) {
  return `water-temp-v${TEMP_CACHE_VERSION}-${stationId}-${year}`;
}

function readTempCache(stationId, year) {
  try {
    const raw = localStorage.getItem(tempCacheKey(stationId, year));
    if (!raw) return null;
    const { fetchedOn, temps } = JSON.parse(raw);
    const thisYear = new Date().getFullYear();
    const today = noaaDate(new Date()).slice(0, 8); // "YYYYMMDD" → "YYYYMM" nope, just today string
    // For complete past years the cache never expires. For the current year
    // bust if fetched on a different calendar day.
    if (year < thisYear || fetchedOn === todayStr()) return temps;
    return null;
  } catch {
    return null;
  }
}

function writeTempCache(stationId, year, temps) {
  try {
    localStorage.setItem(
      tempCacheKey(stationId, year),
      JSON.stringify({ fetchedOn: todayStr(), temps })
    );
  } catch {}
}

function todayStr() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Returns { "YYYY-MM-DD": tempF, … } for days that have observed data.
// Returns null if the year is in the future or the fetch fails.
export async function fetchYearDailyTemps(stationId, year) {
  const thisYear = new Date().getFullYear();
  if (year > thisYear) return null;

  const cached = readTempCache(stationId, year);
  if (cached) return cached;

  // Fetch up to yesterday for the current year (today comes from the live reading).
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const endDate = year < thisYear ? new Date(year, 11, 31) : yesterday;

  const params = new URLSearchParams({
    product: "water_temperature",
    application: "NOS.COOPS.TAC.WL",
    begin_date: noaaDate(new Date(year, 0, 1)),
    end_date: noaaDate(endDate),
    station: stationId,
    time_zone: "lst_ldt",
    units: "english",
    interval: "h",
    format: "json",
  });

  try {
    const response = await fetch(
      `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?${params}`
    );
    const json = await response.json();
    if (json.error || !json.data) return null;

    // Average hourly readings into one value per calendar day.
    const byDay = {};
    json.data.forEach((d) => {
      const v = parseFloat(d.v);
      if (isNaN(v)) return;
      const key = d.t.slice(0, 10); // "YYYY-MM-DD"
      if (!byDay[key]) byDay[key] = [];
      byDay[key].push(v);
    });

    const temps = {};
    Object.entries(byDay).forEach(([k, vals]) => {
      temps[k] = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
    });

    writeTempCache(stationId, year, temps);
    return temps;
  } catch {
    return null;
  }
}

// Sunrise/sunset via the NOAA solar algorithm (Meeus, Astronomical Algorithms).
// lat/lon in decimal degrees; date is a JS Date in local time.
// Returns { sunrise, sunset } as Date objects, or nulls for polar day/night.
export function sunTimes(lat, lon, date) {
  const R   = Math.PI / 180;
  const deg = (r) => r / R;

  const jd = date.getTime() / 86400000 + 2440587.5;
  const T  = (jd - 2451545) / 36525;

  const L0 = (280.46646 + T * (36000.76983 + T * 0.0003032)) % 360;
  const M  = 357.52911 + T * (35999.05029 - T * 0.0001537);
  const Mr = M * R;

  const C      = Math.sin(Mr) * (1.914602 - T * (0.004817 + 0.000014 * T))
               + Math.sin(2 * Mr) * (0.019993 - 0.000101 * T)
               + Math.sin(3 * Mr) * 0.000289;
  const omega  = 125.04 - 1934.136 * T;
  const lambda = L0 + C - 0.00569 - 0.00478 * Math.sin(omega * R);

  const e    = 23.439291 - T * 0.013004;
  const decl = deg(Math.asin(Math.sin(e * R) * Math.sin(lambda * R)));

  const y   = Math.tan((e / 2) * R) ** 2;
  const eot = 4 * deg(
    y * Math.sin(2 * L0 * R) - 2 * 0.016709 * Math.sin(Mr)
    + 4 * 0.016709 * y * Math.sin(Mr) * Math.cos(2 * L0 * R)
    - 0.5 * y ** 2 * Math.sin(4 * L0 * R)
    - 1.25 * 0.016709 ** 2 * Math.sin(2 * Mr)
  );

  const cosHA = (Math.cos(90.833 * R) - Math.sin(lat * R) * Math.sin(decl * R))
              / (Math.cos(lat * R) * Math.cos(decl * R));
  if (Math.abs(cosHA) > 1) return { sunrise: null, sunset: null };

  const HA   = deg(Math.acos(cosHA));
  const noon = 720 - 4 * lon - eot;

  const midnight = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const toDate   = (m) => new Date(midnight.getTime() + (m - midnight.getTimezoneOffset()) * 60000);

  return { sunrise: toDate(noon - 4 * HA), sunset: toDate(noon + 4 * HA) };
}

// Height at an arbitrary time, cosine-interpolated between the surrounding
// extremes. `extremes` must be sorted; returns null outside their range.
export function heightAt(extremes, date) {
  const t = date.getTime();
  let lo = 0;
  let hi = extremes.length - 1;
  if (hi < 1 || t < extremes[0].date.getTime() || t > extremes[hi].date.getTime()) {
    return null;
  }
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (extremes[mid].date.getTime() <= t) lo = mid;
    else hi = mid;
  }
  const a = extremes[lo];
  const b = extremes[hi];
  const span = b.date.getTime() - a.date.getTime();
  const f = span === 0 ? 0 : (t - a.date.getTime()) / span;
  return a.height + ((b.height - a.height) * (1 - Math.cos(Math.PI * f))) / 2;
}
