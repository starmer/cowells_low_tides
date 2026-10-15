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
