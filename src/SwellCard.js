import { useState, useEffect } from "react";
import { compassDir, fetchSwellComponents, fetchMopNowcast, fetchBuoyLatest } from "./swell";

function formatTime(ms) {
  return new Date(ms)
    .toLocaleTimeString("en-us", { hour: "numeric", minute: "2-digit" })
    .replace(" AM", "a")
    .replace(" PM", "p");
}

// Points the way the swell is travelling: directions are "coming from", so
// rotate a north-pointing triangle by direction + 180.
function SwellArrow({ direction, rank }) {
  return (
    <svg className={`swell-arrow swell-${rank}`} viewBox="0 0 10 10" aria-hidden="true">
      <path d="M5 0.5 8.5 9.5 5 7.5 1.5 9.5z" transform={`rotate(${direction + 180} 5 5)`} />
    </svg>
  );
}

// The first swell is the most significant and gets bold; wind swell never does.
function ComponentList({ items }) {
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

function Reading({ label, r, live }) {
  if (!r) return null;
  return (
    <div className={`swell-reading${live ? " is-live" : ""}`} tabIndex={0} aria-describedby="swell-explain">
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

  useEffect(() => {
    fetchSwellComponents(station.lat, station.lon).then(setComponents).catch(() => setComponents([]));
    if (station.cdipBuoy) fetchBuoyLatest(station.cdipBuoy).then(setBuoy).catch(() => {});
  }, [station.lat, station.lon, station.cdipBuoy]);

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
        <div className="swell-explain" id="swell-explain" role="tooltip">
          <p>
            <b>Modeled</b> is an estimate of the waves just off {brk?.name ?? station.spot}, worked out from
            what's offshore. It accounts for the point blocking some of the swell, so it's usually smaller.
          </p>
          <p>
            <b>Buoy</b> is a real measurement from open water at the mouth of Monterey Bay. It sees all the swell
            before anything blocks it.
          </p>
        </div>
      </div>
      <p className="swell-source">
        Swell: NOAA GFS-Wave via Open-Meteo. Nearshore: CDIP MOP {brk?.mopPoint}. Buoy: CDIP{" "}
        {station.cdipBuoy}.
      </p>
    </section>
  );
}
