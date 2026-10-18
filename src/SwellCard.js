import { useState, useEffect } from "react";
import { compassDir, fetchSwellHourly, componentsAt, fetchMopNowcast, fetchBuoyLatest, fetchNdbc } from "./swell";

// The offshore buoy only updates four times a day: grey it out past this,
// and drop it entirely if the data stops coming (e.g. the schedule stopped).
const STALE_MS = 8 * 3600 * 1000;
const GONE_MS = 24 * 3600 * 1000;

// "4:30p", or "Sat 11:50p" when it isn't from today.
function formatTime(ms) {
  const d = new Date(ms);
  const time = d
    .toLocaleTimeString("en-us", { hour: "numeric", minute: "2-digit" })
    .replace(" AM", "a")
    .replace(" PM", "p");
  if (d.toDateString() === new Date().toDateString()) return time;
  return `${d.toLocaleDateString("en-us", { weekday: "short" })} ${time}`;
}

// Points the way the swell is travelling: directions are "coming from", so
// rotate a north-pointing triangle by direction + 180.
export function SwellArrow({ direction, rank }) {
  return (
    <svg className={`swell-arrow swell-${rank}`} viewBox="0 0 10 10" aria-hidden="true">
      <path d="M5 0.5 8.5 9.5 5 7.5 1.5 9.5z" transform={`rotate(${direction + 180} 5 5)`} />
    </svg>
  );
}

// The first swell is the most significant and gets bold; wind swell never does.
export function ComponentList({ items }) {
  return (
    <ul>
      {items.map((c, i) => (
        <li key={i} className={i === 0 && !c.wind ? "is-primary" : undefined}>
          <span className="swell-h">{c.height.toFixed(1)}ft</span>
          <span className="swell-p">{Math.round(c.period)}s</span>
          <SwellArrow direction={c.direction} rank={c.wind ? "wind" : i + 1} />
          <span className="swell-d">
            {compassDir(c.direction)} {Math.round(c.direction)}°
          </span>
        </li>
      ))}
    </ul>
  );
}

function Reading({ label, r, live, stale }) {
  if (!r) return null;
  return (
    <div className={`swell-reading${live && !stale ? " is-live" : ""}${stale ? " is-stale" : ""}`}>
      <span className="swell-reading-label">{label}</span>
      <span className="swell-reading-value">
        {r.height.toFixed(1)}ft <span>{Math.round(r.period)}s</span> {compassDir(r.direction)}
      </span>
      <span className="swell-reading-time">{formatTime(r.time)}</span>
    </div>
  );
}

export default function SwellCard({ station, brk }) {
  const [components, setComponents] = useState(null);
  const [mop, setMop] = useState(null);
  const [buoy, setBuoy] = useState(null);
  const [offshore, setOffshore] = useState(null);

  useEffect(() => {
    fetchSwellHourly(station.lat, station.lon)
      .then((hours) => setComponents(componentsAt(hours, Date.now()) ?? []))
      .catch(() => setComponents([]));
    if (station.cdipBuoy) fetchBuoyLatest(station.cdipBuoy).then(setBuoy).catch(() => {});
    if (station.ndbcBuoy) fetchNdbc(station.ndbcBuoy).then(setOffshore).catch(() => {});
  }, [station.lat, station.lon, station.cdipBuoy, station.ndbcBuoy]);

  const offshoreAge = offshore ? Date.now() - offshore.time : Infinity;

  // Switching breaks clears the old reading so it never shows under the new name.
  useEffect(() => {
    let cancelled = false;
    setMop(null);
    if (brk?.mopPoint) fetchMopNowcast(brk.mopPoint).then((r) => !cancelled && setMop(r)).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [brk?.mopPoint]);

  if (components === null && !mop && !buoy) return null;

  const swells = components?.filter((c) => !c.wind) ?? [];
  const windSwell = components?.filter((c) => c.wind) ?? [];

  return (
    <section className="swell-card" aria-label="Swell">
      <div className="swell-components">
        <h3>Swell</h3>
        {components?.length === 0 && <p className="swell-empty">No forecast available.</p>}
        <ComponentList items={swells} />
        {windSwell.length > 0 && (
          <div className="swell-wind">
            <h3>Wind swell</h3>
            <ComponentList items={windSwell} />
          </div>
        )}
      </div>
      <div className="swell-readings">
        <Reading label={`At ${brk?.name ?? station.spot} (Modeled)`} r={mop} />
        <Reading label={`${station.cdipBuoyName ?? "CDIP"} buoy`} r={buoy} live />
        {offshoreAge < GONE_MS && (
          <Reading
            label={`${station.ndbcBuoyName ?? "NDBC"} buoy`}
            r={offshore}
            live
            stale={offshoreAge > STALE_MS}
          />
        )}
      </div>
      <p className="swell-source">
        Swell: NOAA GFS-Wave via Open-Meteo. Nearshore: CDIP MOP {brk?.mopPoint}. Buoys: CDIP{" "}
        {station.cdipBuoy}
        {station.ndbcBuoy && `, NDBC ${station.ndbcBuoy} (updated 4× a day)`}.
      </p>
    </section>
  );
}
