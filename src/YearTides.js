import { Fragment, useState, useEffect, useMemo, useRef } from "react";
import { defaultStation } from "./stations";
import { fetchYearExtremes, heightAt, sunTimes, fetchYearDailyTemps } from "./tides";
import SwellCard, { SwellArrow } from "./SwellCard";
import DaySwell from "./DaySwell";
import { fetchYearDailySwell, fetchMopForecast, fetchSwellHourly, dailyMax, compassDir } from "./swell";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// 6-year average (2020–2025) water temps in °F from NOAA Monterey station 9413450.
// Used for all days except today, which gets the live reading.
const MONTHLY_AVG_TEMP = [56, 56, 56, 57, 57, 59, 60, 62, 62, 60, 57, 57];

const SPARK_W = 200;
const SPARK_H = 30;
const SPARK_PAD = 6;
const SPARK_SAMPLES = 96;

const STRIP_H = 96;
const STRIP_BAR = 3; // viewBox units per day: a 2-wide bar and a 1-wide gap

const FILTERS = [
  { id: "all", label: "All" },
  { id: "H", label: "Highs" },
  { id: "L", label: "Lows" },
];

const dayKey = (d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

// "YYYY-MM-DD", the key used by the water temp and swell data.
function isoDay(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const BREAK_KEY = "swell-break";
const SWELL_DETAIL_DAYS = 10; // upper limit on how many days ahead can be expanded

function savedBreak(station) {
  let id = null;
  try {
    id = localStorage.getItem(BREAK_KEY);
  } catch {}
  return station.breaks?.find((b) => b.id === id) ?? station.breaks?.[0] ?? null;
}

function formatTime(date) {
  return date
    .toLocaleTimeString("en-us", { hour: "numeric", minute: "2-digit" })
    .replace(" AM", "a")
    .replace(" PM", "p");
}

function formatHeight(h) {
  const s = Math.abs(h).toFixed(1);
  return h < 0 && s !== "0.0" ? `−${s}` : s;
}

function ordinal(n) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export default function YearTides({ station = defaultStation }) {
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const [show, setShow] = useState("all");
  const [data, setData] = useState({ status: "loading", extremes: [] });
  const monthRefs = useRef([]);
  const todayRowRef = useRef(null);
  const [waterTemp, setWaterTemp] = useState(null);
  const [dailyTemps, setDailyTemps] = useState({});     // current year: "YYYY-MM-DD" → °F
  const [prevYearTemps, setPrevYearTemps] = useState({}); // last year: same
  const [brk, setBrk] = useState(() => savedBreak(station));
  const [dailySwell, setDailySwell] = useState({});       // "YYYY-MM-DD" → { height, period, direction }
  const [mopForecast, setMopForecast] = useState([]);     // 3-hourly records, today onward
  const [swellHours, setSwellHours] = useState(null);     // offshore components, hourly, next 10 days
  const [openSwellDay, setOpenSwellDay] = useState(null); // "YYYY-MM-DD" of the expanded day
  const swellForecast = useMemo(() => dailyMax(mopForecast), [mopForecast]);

  const pickBreak = (id) => {
    const next = station.breaks.find((b) => b.id === id);
    setBrk(next);
    try {
      localStorage.setItem(BREAK_KEY, next.id);
    } catch {}
  };

  // Daily biggest nearshore wave height at the selected break: past days for
  // the shown year, plus the forecast for today and the coming week.
  useEffect(() => {
    let cancelled = false;
    setDailySwell({});
    if (brk) fetchYearDailySwell(brk.mopPoint, year).then((d) => !cancelled && setDailySwell(d ?? {}));
    return () => {
      cancelled = true;
    };
  }, [brk, year]);

  useEffect(() => {
    let cancelled = false;
    setMopForecast([]);
    if (brk) {
      fetchMopForecast(brk.mopPoint)
        .then((r) => !cancelled && setMopForecast(r ?? []))
        .catch(() => {});
    }
    return () => {
      cancelled = true;
    };
  }, [brk]);

  useEffect(() => {
    fetchSwellHourly(station.lat, station.lon).then(setSwellHours).catch(() => {});
  }, [station.lat, station.lon]);

  // Today and coming days can open a detail panel under their row, as far as
  // the nearshore forecast reaches (about a week), capped at 10 days.
  const detailStart = new Date();
  detailStart.setHours(0, 0, 0, 0);
  const detailEnd = new Date(detailStart);
  detailEnd.setDate(detailEnd.getDate() + SWELL_DETAIL_DAYS);
  const canExpand = (day) =>
    day.start >= detailStart && day.start < detailEnd && swellForecast[isoDay(day.start)] != null;
  const toggleSwellDay = (key) => setOpenSwellDay((open) => (open === key ? null : key));

  // Live reading for today.
  useEffect(() => {
    const tempId = station.tempStationId ?? "9413450";
    fetch(
      `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?product=water_temperature` +
      `&application=NOS.COOPS.TAC.WL&date=latest&station=${tempId}` +
      `&time_zone=lst_ldt&units=english&format=json`
    )
      .then((r) => r.json())
      .then((d) => {
        const v = parseFloat(d.data?.[0]?.v);
        if (!isNaN(v)) setWaterTemp(Math.round(v));
      })
      .catch(() => {});
  }, [station.id]);

  // Historical daily averages: current year (past days) + previous year (for future day blending).
  useEffect(() => {
    const tempId = station.tempStationId ?? "9413450";
    const thisYear = new Date().getFullYear();
    fetchYearDailyTemps(tempId, year).then((t) => setDailyTemps(t ?? {}));
    if (year === thisYear) {
      fetchYearDailyTemps(tempId, year - 1).then((t) => setPrevYearTemps(t ?? {}));
    } else {
      setPrevYearTemps({});
    }
  }, [station.id, year]);

  useEffect(() => {
    let cancelled = false;
    // Keep the previous year's render on screen (dimmed) while refetching.
    setData((prev) => ({ ...prev, status: "loading", error: null }));
    fetchYearExtremes(station.id, year)
      .then((extremes) => !cancelled && setData({ status: "ready", extremes, year }))
      .catch((err) => !cancelled && setData({ status: "error", error: err.message, extremes: [] }));
    return () => {
      cancelled = true;
    };
  }, [station.id, year]);

  const shownYear = data.year ?? year;

  const { months, days, yMin, yMax } = useMemo(() => {
    const { lat, lon } = station;
    const byDay = new Map();
    let min = Infinity;
    let max = -Infinity;
    data.extremes.forEach((e) => {
      if (e.date.getFullYear() !== shownYear) return;
      min = Math.min(min, e.height);
      max = Math.max(max, e.height);
      const key = dayKey(e.date);
      if (!byDay.has(key)) byDay.set(key, []);
      byDay.get(key).push(e);
    });

    const days = [];
    const months = MONTHS.map((name, m) => {
      const monthDays = [];
      for (let d = 1; d <= new Date(shownYear, m + 1, 0).getDate(); d++) {
        const start = new Date(shownYear, m, d);
        const events = byDay.get(dayKey(start)) || [];
        const heights = events.map((e) => e.height);
        const { sunrise, sunset } = lat != null ? sunTimes(lat, lon, start) : {};
        const day = {
          start,
          end: new Date(shownYear, m, d + 1),
          events,
          low: heights.length ? Math.min(...heights) : null,
          high: heights.length ? Math.max(...heights) : null,
          sunrise,
          sunset,
        };
        monthDays.push(day);
        days.push(day);
      }
      const events = monthDays.flatMap((d) => d.events);
      const lowest = events.reduce((a, e) => (e.type === "L" && (!a || e.height < a.height) ? e : a), null);
      const highest = events.reduce((a, e) => (e.type === "H" && (!a || e.height > a.height) ? e : a), null);
      return { name, days: monthDays, lowest, highest };
    });

    return { months, days, yMin: min - 0.3, yMax: max + 0.3 };
  }, [data.extremes, shownYear]);

  const todayKey = dayKey(new Date());
  const hasData = data.extremes.length > 0;

  // Past days come from the model's record of what happened. Today takes the
  // bigger of the record so far and the forecast; later days, the forecast.
  function swellForDay(day) {
    const key = isoDay(day.start);
    const past = dailySwell[key];
    const ahead = swellForecast[key];
    if (past && ahead) return ahead.height > past.height ? ahead : past;
    return past ?? (ahead ? { ...ahead, forecast: true } : null);
  }

  // Pick the best available temperature for a given day.
  function tempForDay(day, isToday) {
    if (isToday && waterTemp != null) return { temp: waterTemp, live: true };
    const d = day.start;
    const pad = (n) => String(n).padStart(2, "0");
    const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const monthAvg = MONTHLY_AVG_TEMP[d.getMonth()];
    const isPast = day.start <= new Date();
    if (isPast) {
      return { temp: dailyTemps[key] ?? monthAvg, live: false };
    }
    // Future: blend same date last year with monthly average.
    const prevKey = `${d.getFullYear() - 1}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const prev = prevYearTemps[prevKey];
    return { temp: prev != null ? Math.round((prev + monthAvg) / 2) : monthAvg, live: false };
  }

  // Scroll today's row into view once the data finishes loading.
  useEffect(() => {
    if (data.status !== "ready") return;
    const el = todayRowRef.current;
    if (!el) return;
    const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Small delay so the layout has settled before we scroll.
    const id = setTimeout(() => {
      el.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "center" });
    }, 100);
    return () => clearTimeout(id);
  }, [data.status]);

  // In the current year, months that have already gone by start collapsed to
  // just their header. Each can be opened on its own, or all at once.
  const [openPast, setOpenPast] = useState(() => new Set());
  useEffect(() => setOpenPast(new Set()), [year]);
  const pastMonths = shownYear === thisYear ? new Date().getMonth() : 0;
  const isCollapsed = (m) => m < pastMonths && !openPast.has(m);
  const allPastOpen = pastMonths > 0 && openPast.size >= pastMonths;
  const setMonthOpen = (m, open) =>
    setOpenPast((prev) => {
      const next = new Set(prev);
      if (open) next.add(m);
      else next.delete(m);
      return next;
    });
  const togglePast = () =>
    setOpenPast(allPastOpen ? new Set() : new Set(Array.from({ length: pastMonths }, (_, m) => m)));

  const scrollToMonth = (m) => {
    const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    monthRefs.current[m]?.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "start" });
  };

  // Picking a collapsed month (from the strip) opens it, then scrolls once
  // its days have rendered.
  const pendingMonth = useRef(null);
  const jumpTo = (m) => {
    if (isCollapsed(m)) {
      pendingMonth.current = m;
      setMonthOpen(m, true);
    } else {
      scrollToMonth(m);
    }
  };

  useEffect(() => {
    if (pendingMonth.current === null) return;
    scrollToMonth(pendingMonth.current);
    pendingMonth.current = null;
  });

  const scrollToToday = () => {
    const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    todayRowRef.current?.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "center" });
  };

  // From another year, switch back first and scroll once today's row renders.
  const wantsToday = useRef(false);
  const jumpToToday = () => {
    if (shownYear === thisYear && todayRowRef.current) {
      scrollToToday();
    } else {
      wantsToday.current = true;
      setYear(thisYear);
    }
  };

  useEffect(() => {
    if (!wantsToday.current || !todayRowRef.current) return;
    wantsToday.current = false;
    scrollToToday();
  });

  return (
    <div className="year">
      <header className="year-head">
        <h1>{station.spot} tides</h1>
        <p className="sub">
          {station.name}. Heights in feet above mean lower low water, from NOAA station {station.id}.
        </p>
      </header>

      <div className="toolbar">
        <div className="seg seg-year" role="group" aria-label="Year">
          {[thisYear - 1, thisYear, thisYear + 1, thisYear + 2].map((y) => (
            <button key={y} aria-pressed={y === year} onClick={() => setYear(y)}>
              {y}
            </button>
          ))}
        </div>
        {station.breaks && (
          <label className="break-pick">
            <span>Swell at</span>
            <select value={brk?.id} onChange={(e) => pickBreak(e.target.value)}>
              {station.breaks.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="seg seg-filter" role="group" aria-label="Show tides">
          {FILTERS.map((f) => (
            <button key={f.id} aria-pressed={show === f.id} onClick={() => setShow(f.id)}>
              {f.id !== "L" && <TideMark type="H" />}
              {f.id !== "H" && <TideMark type="L" />}
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {data.status === "error" && (
        <p className="notice">
          Couldn't load {year} tides from NOAA ({data.error}). Check your connection and pick the year again.
        </p>
      )}
      {data.status === "loading" && !hasData && <p className="notice">Loading {year} tides from NOAA…</p>}

      {hasData && (
        <div className={data.status === "loading" ? "year-body is-loading" : "year-body"}>
          <YearStrip days={days} yMin={yMin} yMax={yMax} todayKey={todayKey} onPickMonth={jumpTo} />

          {pastMonths > 0 && (
            <button className="past-toggle" onClick={togglePast} aria-expanded={allPastOpen}>
              {allPastOpen ? "Hide past months" : `Show past months (${pastMonths})`}
            </button>
          )}

          {months.map((month, m) => (
            <section
              key={month.name}
              className={`month${isCollapsed(m) ? " is-collapsed" : ""}`}
              ref={(el) => (monthRefs.current[m] = el)}
            >
              <header className="month-head">
                <h2>{month.name}</h2>
                {show !== "H" && month.lowest && (
                  <p>
                    Lowest {formatHeight(month.lowest.height)} ft on the {ordinal(month.lowest.date.getDate())}
                  </p>
                )}
                {show !== "L" && month.highest && (
                  <p>
                    Highest {formatHeight(month.highest.height)} ft on the {ordinal(month.highest.date.getDate())}
                  </p>
                )}
                {m < pastMonths && (
                  <button
                    className="month-toggle"
                    aria-expanded={!isCollapsed(m)}
                    onClick={() => setMonthOpen(m, isCollapsed(m))}
                  >
                    {isCollapsed(m) ? "Show days ▾" : "Hide ▴"}
                  </button>
                )}
              </header>
              {!isCollapsed(m) && (
                <div className="month-days">
                  <div className="day-row axis-row" aria-hidden="true">
                    <span />
                    <div className="hour-axis">
                      <span>12a</span><span>6a</span><span>noon</span><span>6p</span><span>12a</span>
                    </div>
                  </div>
                  {month.days.map((day) => (
                    <Fragment key={day.start.getTime()}>
                      <DayRow
                        day={day}
                        extremes={data.extremes}
                        yMin={yMin}
                        yMax={yMax}
                        show={show}
                        isToday={dayKey(day.start) === todayKey}
                        todayRef={dayKey(day.start) === todayKey ? todayRowRef : null}
                        temp={tempForDay(day, dayKey(day.start) === todayKey).temp}
                        isLiveTemp={tempForDay(day, dayKey(day.start) === todayKey).live}
                        swell={swellForDay(day)}
                        swellOpen={openSwellDay === isoDay(day.start)}
                        onToggleSwell={canExpand(day) && brk ? () => toggleSwellDay(isoDay(day.start)) : null}
                      />
                      {dayKey(day.start) === todayKey && <SwellCard station={station} brk={brk} />}
                      {openSwellDay === isoDay(day.start) && canExpand(day) && brk && (
                        <DaySwell day={day} brk={brk} mopRecords={mopForecast} hours={swellHours} />
                      )}
                    </Fragment>
                  ))}
                </div>
              )}
            </section>
          ))}
        </div>
      )}

      <button className="today-btn" onClick={jumpToToday}>
        Today
      </button>
    </div>
  );
}

// One bar per day spanning its lowest low to highest high. The stretch below
// 0 ft is drawn in the low color, so minus-tide windows stand out.
function YearStrip({ days, yMin, yMax, todayKey, onPickMonth }) {
  const [hover, setHover] = useState(null);
  const W = days.length * STRIP_BAR;
  const y = (h) => ((yMax - h) / (yMax - yMin)) * STRIP_H;
  const zero = y(0);
  const todayIndex = days.findIndex((d) => dayKey(d.start) === todayKey);
  const year = days[0].start.getFullYear();

  function onPointerMove(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    const i = Math.floor(((e.clientX - rect.left) / rect.width) * days.length);
    setHover(Math.max(0, Math.min(days.length - 1, i)));
  }

  const hovered = hover !== null ? days[hover] : null;

  return (
    <figure className="strip">
      <div className="strip-plot">
        <svg
          viewBox={`0 0 ${W} ${STRIP_H}`}
          preserveAspectRatio="none"
          onPointerMove={onPointerMove}
          onPointerLeave={() => setHover(null)}
          onClick={() => hovered && onPickMonth(hovered.start.getMonth())}
          role="img"
          aria-label={`Daily tide range for ${year}`}
        >
          {yMin < 0 && (
            <line className="zero" x1="0" x2={W} y1={zero} y2={zero} vectorEffect="non-scaling-stroke" />
          )}
          {days.map((d, i) =>
            d.low === null ? null : (
              <g key={i} className={hover === i ? "is-hover" : undefined}>
                <rect
                  className="range"
                  x={i * STRIP_BAR}
                  width={STRIP_BAR - 1}
                  y={y(d.high)}
                  height={y(Math.max(d.low, 0)) - y(d.high)}
                />
                {d.low < 0 && (
                  <rect className="minus" x={i * STRIP_BAR} width={STRIP_BAR - 1} y={zero} height={y(d.low) - zero} />
                )}
              </g>
            )
          )}
          {todayIndex >= 0 && (
            <line
              className="today"
              x1={todayIndex * STRIP_BAR + 1}
              x2={todayIndex * STRIP_BAR + 1}
              y1="0"
              y2={STRIP_H}
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>
        {hovered && hovered.low !== null && (
          <div className="tip" style={{ left: `${((hover + 0.5) / days.length) * 100}%` }}>
            <span>{hovered.start.toLocaleDateString("en-us", { weekday: "short", month: "short", day: "numeric" })}</span>
            <b>{formatHeight(hovered.low)}</b> to <b>{formatHeight(hovered.high)} ft</b>
          </div>
        )}
      </div>
      <div className="strip-months">
        {MONTHS.map((name, m) => (
          <button key={name} style={{ flexGrow: new Date(year, m + 1, 0).getDate() }} onClick={() => onPickMonth(m)}>
            {name.slice(0, 3)}
          </button>
        ))}
      </div>
      <figcaption>Each bar is one day, from its lowest low to its highest high. Gold marks tides below zero.</figcaption>
    </figure>
  );
}

function DayRow({ day, extremes, yMin, yMax, show, isToday, todayRef, temp, isLiveTemp, swell, swellOpen, onToggleSwell }) {
  const events = show === "all" ? day.events : day.events.filter((e) => e.type === show);
  const dow = day.start.getDay();
  const className = ["day-row", isToday && "is-today", (dow === 0 || dow === 6) && "is-weekend"]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={className} ref={todayRef}>
      <div className="day-label">
        <span className="dow">{day.start.toLocaleDateString("en-us", { weekday: "short" })}</span>
        <span className="dom">{day.start.getDate()}</span>
        <span className={`day-temp${isLiveTemp ? " is-live" : ""}`}>
          {temp}°
        </span>
        {swell && <DaySwellLabel swell={swell} open={swellOpen} onToggle={onToggleSwell} />}
      </div>
      <DaySpark day={day} events={events} extremes={extremes} yMin={yMin} yMax={yMax} sunrise={day.sunrise} sunset={day.sunset} />
      <ol className="events">
        {events.map((e) => (
          <li key={e.date.getTime()} className={`ev${e.height < 0 ? " is-neg" : ""}`}>
            <TideMark type={e.type} />
            <span className="sr-only">{e.type === "H" ? "High" : "Low"}</span>
            <time>{formatTime(e.date)}</time>
            <span className="h">{formatHeight(e.height)}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

// The day's biggest modeled waves, e.g. "2.9ft 18s SSW". On forecast days
// it's a button that opens that day's swell detail.
function DaySwellLabel({ swell, open, onToggle }) {
  // Same arrow as the swell card, in the primary swell color.
  const text = (
    <>
      {swell.height.toFixed(1)}ft {swell.period}s
      <SwellArrow direction={swell.direction} rank={1} />
      {compassDir(swell.direction)}
    </>
  );
  const className = ["day-swell", swell.forecast && "is-forecast"].filter(Boolean).join(" ");
  if (!onToggle) return <span className={className}>{text}</span>;
  return (
    <button className={`${className} is-toggle`} aria-expanded={open} onClick={onToggle}>
      {text}
      <span className="day-swell-caret" aria-hidden="true">
        {open ? "▴" : "▾"}
      </span>
    </button>
  );
}

function TideMark({ type }) {
  return (
    <svg className={`mark mark-${type}`} viewBox="0 0 10 10" aria-hidden="true">
      <path d={type === "H" ? "M5 1.5 9 8.5H1z" : "M5 8.5 9 1.5H1z"} />
    </svg>
  );
}

function DaySpark({ day, events, extremes, yMin, yMax, sunrise, sunset }) {
  const [hoverX, setHoverX] = useState(null);
  const t0 = day.start.getTime();
  const span = day.end.getTime() - t0;

  const x = (date) => ((date.getTime() - t0) / span) * SPARK_W;
  const y = (h) => SPARK_PAD + ((yMax - h) / (yMax - yMin)) * (SPARK_H - 2 * SPARK_PAD);

  const { line, area } = useMemo(() => {
    const yy = (h) => SPARK_PAD + ((yMax - h) / (yMax - yMin)) * (SPARK_H - 2 * SPARK_PAD);
    const pts = [];
    for (let i = 0; i <= SPARK_SAMPLES; i++) {
      const h = heightAt(extremes, new Date(t0 + (span * i) / SPARK_SAMPLES));
      if (h !== null) pts.push([(SPARK_W * i) / SPARK_SAMPLES, h]);
    }
    if (pts.length < 2) return { line: "", area: "" };
    const line = pts.map(([px, h], i) => `${i ? "L" : "M"}${px.toFixed(1)},${yy(h).toFixed(1)}`).join("");
    const area = `${line}L${pts[pts.length - 1][0]},${SPARK_H}L${pts[0][0]},${SPARK_H}Z`;
    return { line, area };
  }, [extremes, t0, span, yMin, yMax]);

  const hover = useMemo(() => {
    if (hoverX === null) return null;
    const date = new Date(t0 + (hoverX / SPARK_W) * span);
    const h = heightAt(extremes, date);
    if (h === null) return null;
    const rising = heightAt(extremes, new Date(date.getTime() + 60000)) > h;
    return { date, h, rising };
  }, [hoverX, extremes, t0, span]);

  function onPointerMove(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * SPARK_W;
    setHoverX(Math.max(0, Math.min(SPARK_W, px)));
  }

  const hourLines = [6, 12, 18].map((hr) =>
    x(new Date(day.start.getFullYear(), day.start.getMonth(), day.start.getDate(), hr))
  );

  return (
    <div className="spark">
      <svg
        viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
        width={SPARK_W}
        height={SPARK_H}
        onPointerMove={onPointerMove}
        onPointerLeave={() => setHoverX(null)}
        aria-hidden="true"
      >
        {sunrise && <rect className="night" x="0" width={Math.max(0, x(sunrise))} y="0" height={SPARK_H} />}
        {sunset  && <rect className="night" x={Math.min(SPARK_W, x(sunset))} width={Math.max(0, SPARK_W - x(sunset))} y="0" height={SPARK_H} />}
        {hourLines.map((hx) => (
          <line key={hx} className="grid" x1={hx} x2={hx} y1="0" y2={SPARK_H} />
        ))}
        {yMin < 0 && <line className="zero" x1="0" x2={SPARK_W} y1={y(0)} y2={y(0)} />}
        <path className="area" d={area} />
        <path className="curve" d={line} />
        {events.map((e) => (
          <circle key={e.date.getTime()} className={`dot dot-${e.type}`} cx={x(e.date)} cy={y(e.height)} r="3.5" />
        ))}
        {hover && (
          <>
            <line className="crosshair" x1={hoverX} x2={hoverX} y1="0" y2={SPARK_H} />
            <circle className="dot dot-hover" cx={hoverX} cy={y(hover.h)} r="3" />
          </>
        )}
      </svg>
      {sunrise && (
        <div className="spark-sun" aria-hidden="true">
          <span className="spark-sun-item" style={{ left: `${(x(sunrise) / SPARK_W) * 100}%` }}>
            ↑ {formatTime(sunrise)}
          </span>
          <span className="spark-sun-item" style={{ left: `${(x(sunset) / SPARK_W) * 100}%` }}>
            ↓ {formatTime(sunset)}
          </span>
        </div>
      )}
      {hover && (
        <div className="tip" style={{ left: `${(hoverX / SPARK_W) * 100}%` }}>
          <span>{formatTime(hover.date)}</span>
          <b>{formatHeight(hover.h)} ft</b> {hover.rising ? "rising" : "falling"}
        </div>
      )}
    </div>
  );
}
