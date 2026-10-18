import { compassDir } from "./swell";

function formatTime(ms) {
  return new Date(ms)
    .toLocaleTimeString("en-us", { hour: "numeric", minute: "2-digit" })
    .replace(":00", "")
    .replace(" AM", "a")
    .replace(" PM", "p");
}

function formatRange(w) {
  return w.end > w.start ? `${formatTime(w.start)}–${formatTime(w.end)}` : formatTime(w.start);
}

// The conditions at the best moment of a window, in the order they're rated.
function Details({ s }) {
  const main = s.components?.find((c) => !c.wind);
  return (
    <span className="bt-details">
      <span>
        Tide {s.tide.toFixed(1)}ft {s.rising ? "rising" : "falling"}
      </span>
      <span>{s.size.toFixed(1)}ft waves</span>
      {main && (
        <span>
          {Math.round(main.period)}s {compassDir(main.direction)} swell
        </span>
      )}
      {s.wind && (
        <span>
          Wind {compassDir(s.wind.direction)} {Math.round(s.wind.speed)}kt
        </span>
      )}
    </span>
  );
}

// Best times to surf the selected break over the days the nearshore
// forecast covers. Clicking a day jumps to its row.
export default function BestTimesPanel({ brk, days, results, onPickDay }) {
  const rated = days.filter((d) => results[d.key]);

  return (
    <section className="best-times" aria-label={`Best times to surf ${brk.name}`}>
      <h3>Best times at {brk.name}</h3>
      <p className="bt-sub">
        First light to last light, rated from tide, modeled wave size, swell direction and wind. Good means
        everything lines up; Fair means one thing is off.
      </p>
      {rated.length === 0 && <p className="bt-sub">Loading the forecast…</p>}
      <ol className="bt-days">
        {rated.map((d) => {
          const { windows } = results[d.key];
          return (
            <li key={d.key} className="bt-day">
              <button className="bt-date" onClick={() => onPickDay(d.key)}>
                {d.start.toLocaleDateString("en-us", { weekday: "short", month: "short", day: "numeric" })}
              </button>
              {windows.length === 0 ? (
                <span className="bt-none">Nothing lines up</span>
              ) : (
                <ul className="bt-windows">
                  {windows.map((w) => (
                    <li key={w.start}>
                      <span className={`bt-rating is-${w.rating.toLowerCase()}`}>{w.rating}</span>
                      <span className="bt-time">{formatRange(w)}</span>
                      <Details s={w.best} />
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
