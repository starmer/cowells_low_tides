import { compassDir, componentsAt } from "./swell";
import { SwellArrow } from "./SwellCard";

const SLOT_HOURS = [6, 9, 12, 15, 18];

function formatHour(ms) {
  return new Date(ms).toLocaleTimeString("en-us", { hour: "numeric" }).replace(" AM", "a").replace(" PM", "p");
}

function Chip({ c, rank }) {
  return (
    <span className={`dsw-chip${c.wind ? " is-wind" : ""}`}>
      {c.height.toFixed(1)}ft {Math.round(c.period)}s
      <SwellArrow direction={c.direction} rank={c.wind ? "wind" : rank} />
      {compassDir(c.direction)}
    </span>
  );
}

// One forecast day's swell through daylight hours: the modeled height at the
// break plus the offshore swell components at the same times. Times follow
// the MOP forecast's 3-hour steps when it covers the day; otherwise every
// 3 hours from 6a.
export default function DaySwell({ day, brk, mopRecords, hours }) {
  const t0 = day.start.getTime();
  const t1 = day.end.getTime();
  const daylight = (ms) => {
    const hr = new Date(ms).getHours();
    return hr >= 5 && hr <= 20;
  };

  const mop = mopRecords.filter((r) => r.time >= t0 && r.time < t1 && daylight(r.time));
  const slots = mop.length
    ? mop.map((r) => ({ time: r.time, near: r }))
    : SLOT_HOURS.map((hr) => ({ time: new Date(day.start).setHours(hr), near: null }));

  const rows = slots
    .map((s) => ({ ...s, components: hours ? componentsAt(hours, s.time) : null }))
    .filter((s) => s.near || s.components);

  if (!rows.length) {
    return (
      <section className="day-swell-detail">
        <p className="dsw-empty">No swell forecast for this day yet.</p>
      </section>
    );
  }

  return (
    <section className="day-swell-detail" aria-label={`Swell forecast, ${day.start.toDateString()}`}>
      <div className="dsw-head">
        <span />
        <span>At {brk.name} (Modeled)</span>
        <span>Swell</span>
        <span>Wind swell</span>
      </div>
      {rows.map(({ time, near, components }) => {
        const swells = components?.filter((c) => !c.wind) ?? [];
        const wind = components?.filter((c) => c.wind) ?? [];
        return (
          <div className="dsw-row" key={time}>
            <span className="dsw-time">{formatHour(time)}</span>
            <span className="dsw-near">
              {near ? (
                <>
                  {near.height.toFixed(1)}ft <span>{Math.round(near.period)}s</span> {compassDir(near.direction)}
                </>
              ) : (
                <span className="dsw-none">—</span>
              )}
            </span>
            <span className="dsw-swells">
              {swells.map((c, i) => (
                <Chip key={i} c={c} rank={i + 1} />
              ))}
            </span>
            <span className="dsw-wind">
              {wind.map((c, i) => (
                <Chip key={i} c={c} />
              ))}
            </span>
          </div>
        );
      })}
      <p className="swell-source">
        Modeled: CDIP MOP {brk.mopPoint}. Swell: NOAA GFS-Wave via Open-Meteo.
      </p>
    </section>
  );
}
