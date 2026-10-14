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

// High/low predictions for a calendar year, padded by a day on each side so
// the curve at the edges of Jan 1 and Dec 31 has neighbors to interpolate to.
export async function fetchYearExtremes(stationId, year) {
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

  return json.predictions.map((p) => ({
    date: parseNoaaTime(p.t),
    height: parseFloat(p.v),
    type: p.type, // "H" | "L"
  }));
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
