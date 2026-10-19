// ── Best times to surf ───────────────────────────────────────────────────────
// Every hour from first light to last light gets a rating from four things,
// each scored 0–1 and multiplied together:
//   tide       height in the break's range, and rising if it likes incoming
//   size       modeled nearshore wave height (CDIP MOP) in the break's range
//   direction  offshore swell directions the break likes, weighted by energy
//   wind       light, or blowing from the break's offshore directions
// Good needs everything in the break's best range (allowing a falling tide
// at an incoming-tide break); one "ok" factor (0.6) makes it Fair; two, or
// anything the break doesn't like at all (0.2), make it Poor.
//
// Preferences start from Surfline's spot guides ("ideal conditions") plus
// local knowledge, and are meant to be tweaked here.

import { compassDir, componentsAt } from "./swell";
import { heightAt, sunTimes } from "./tides";

const BEST = 1;
const OK = 0.6;
const BAD = 0.2;

// tide/size ranges in feet: within `best` scores 1, within `ok` 0.6.
// swell/wind lists are 16-point compass directions (where it comes from).
// bigTide: at or above this tide nothing works unless the waves are at
// least bigSwell (modeled ft) to overcome it.
export const BREAK_PREFS = {
  cowells: {
    // Needs a minus tide with the current sandbar; 0.5 ft is the most it
    // gets away with for a Fair. Revisit if the bar shifts.
    tide: { best: [-3, 0], ok: [-3, 0.5], rising: true },
    size: { best: [1, 4], ok: [0.5, 6] },
    swell: { best: ["SSE", "S", "SSW", "SW"], ok: ["WSW", "W"] },
    wind: ["N", "NNW", "NW"],
    bigTide: 5, bigSwell: 6,
  },
  "steamer-lane": {
    tide: { best: [0.5, 3.5], ok: [-1, 4.5], rising: true },
    size: { best: [2.5, 12], ok: [1.5, 16] },
    swell: { best: ["S", "W", "WNW", "NW"], ok: ["SSW", "SW", "WSW", "NNW"] },
    wind: ["NE", "NNE", "N", "NNW", "NW"],
    bigTide: 5, bigSwell: 8,
  },
  indicators: {
    tide: { best: [1, 3.5], ok: [0, 4.5] },
    size: { best: [2.5, 10], ok: [1.5, 14] },
    swell: { best: ["W", "WNW", "NW"], ok: ["WSW", "NNW"] },
    wind: ["NE", "NNE", "N", "NNW", "NW"],
    bigTide: 5, bigSwell: 8,
  },
  "pleasure-point": {
    tide: { best: [2, 4.5], ok: [0.5, 5], rising: true },
    size: { best: [3, 12], ok: [2, 15] },
    swell: { best: ["SSW", "SW", "WSW", "W", "WNW"], ok: ["S", "NW"] },
    wind: ["NE", "NNE", "N", "NNW", "NW"],
    bigTide: 5, bigSwell: 8,
  },
  "davenport-landing": {
    tide: { best: [3, 5.5], ok: [2, 6] },
    size: { best: [3, 8], ok: [2, 11] },
    swell: { best: ["SW", "W", "NW"], ok: ["SSW", "WSW", "WNW"] },
    wind: ["N", "NNE", "NE"],
    bigTide: 6, bigSwell: 8,
  },
};

const FIRST_LIGHT_MIN = 30; // minutes before sunrise / after sunset

function inRange(v, [lo, hi]) {
  return v >= lo && v <= hi;
}

function rangeScore(v, { best, ok }) {
  if (inRange(v, best)) return BEST;
  if (inRange(v, ok)) return OK;
  return BAD;
}

function tideScore(prefs, tide, rising, size) {
  if (tide >= prefs.bigTide && !(size >= prefs.bigSwell)) return BAD;
  const s = rangeScore(tide, prefs.tide);
  // Incoming-tide breaks are a notch worse on the drop.
  return prefs.tide.rising && !rising && s === BEST ? OK + 0.25 : s;
}

// Energy-weighted (H²·T) over the offshore swells, ignoring wind swell.
function directionScore(prefs, components) {
  const swells = (components ?? []).filter((c) => !c.wind);
  if (!swells.length) return OK;
  let total = 0;
  let sum = 0;
  swells.forEach((c) => {
    const e = c.height ** 2 * c.period;
    const dir = compassDir(c.direction);
    const s = prefs.swell.best.includes(dir) ? BEST : prefs.swell.ok.includes(dir) ? OK : BAD;
    total += e;
    sum += e * s;
  });
  return sum / total;
}

function windScore(prefs, wind) {
  if (!wind) return OK;
  const { speed, direction } = wind;
  if (speed <= 5) return BEST; // glassy
  if (prefs.wind.includes(compassDir(direction))) return speed <= 15 ? BEST : OK;
  if (speed <= 8) return OK;
  if (speed <= 12) return 0.35;
  return BAD;
}

// Linear interpolation of 3-hourly MOP records; null outside them.
function sizeAt(records, t) {
  for (let i = 0; i < records.length - 1; i++) {
    const a = records[i];
    const b = records[i + 1];
    if (t >= a.time && t <= b.time) {
      const f = (t - a.time) / (b.time - a.time);
      return a.height + (b.height - a.height) * f;
    }
  }
  return null;
}

function windAt(windHours, t) {
  return windHours?.find((h) => t >= h.time && t < h.time + 3600000) ?? null;
}

const GOOD = 0.7;
const FAIR = 0.4;

export function ratingLabel(score) {
  if (score >= GOOD) return "Good";
  if (score >= FAIR) return "Fair";
  return "Poor";
}

// Rated samples for one day: first light, every whole hour, last light.
// Returns [] when the nearshore forecast doesn't cover the day.
function rateDay(prefs, dayStart, { extremes, mopRecords, swellHours, windHours, lat, lon }) {
  const { sunrise, sunset } = sunTimes(lat, lon, dayStart);
  if (!sunrise || !sunset) return [];
  const first = sunrise.getTime() - FIRST_LIGHT_MIN * 60000;
  const last = sunset.getTime() + FIRST_LIGHT_MIN * 60000;

  const times = [first];
  const hour = new Date(first);
  hour.setMinutes(0, 0, 0);
  for (let t = hour.getTime() + 3600000; t < last; t += 3600000) times.push(t);
  times.push(last);

  const samples = [];
  for (const [i, t] of times.entries()) {
    const size = sizeAt(mopRecords, t);
    const tide = heightAt(extremes, new Date(t));
    if (size == null || tide == null) continue;
    const rising = heightAt(extremes, new Date(t + 600000)) > tide;
    const components = swellHours ? componentsAt(swellHours, t) : null;
    const wind = windAt(windHours, t);
    const factors = {
      tide: tideScore(prefs, tide, rising, size),
      size: rangeScore(size, prefs.size),
      direction: directionScore(prefs, components),
      wind: windScore(prefs, wind),
    };
    const score = factors.tide * factors.size * factors.direction * factors.wind;
    // Each sample stands for the time until the next one.
    const until = times[i + 1] ?? t;
    samples.push({ time: t, until, score, factors, tide, rising, size, components, wind });
  }
  return samples;
}

// Consecutive Fair-or-better samples merged into windows, each with its
// rating (from the best sample) and that best sample for the details.
function windowsFrom(samples) {
  const windows = [];
  let current = null;
  samples.forEach((s) => {
    if (s.score >= FAIR) {
      if (!current) {
        current = { start: s.time, end: s.until, best: s };
        windows.push(current);
      } else {
        current.end = s.until;
        if (s.score > current.best.score) current.best = s;
      }
    } else {
      current = null;
    }
  });
  return windows.map((w) => ({ ...w, rating: ratingLabel(w.best.score) }));
}

// { "YYYY-MM-DD": { first, last, windows } } for each day the nearshore
// forecast covers.
export function bestTimes(breakId, dayStarts, sources) {
  const prefs = BREAK_PREFS[breakId];
  if (!prefs) return {};
  const pad = (n) => String(n).padStart(2, "0");
  const out = {};
  dayStarts.forEach((d) => {
    const samples = rateDay(prefs, d, sources);
    if (!samples.length) return;
    const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    out[key] = { first: samples[0].time, last: samples[samples.length - 1].time, windows: windowsFrom(samples) };
  });
  return out;
}
