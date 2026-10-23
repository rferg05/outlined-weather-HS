import React, { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import {
  Sun, Moon, Cloud, CloudSun, CloudMoon, CloudRain, CloudDrizzle,
  CloudSnow, CloudLightning, CloudFog, Snowflake, Thermometer, CloudHail,
  Droplets, Wind, ArrowUp, TriangleAlert, Sunrise, Sunset,
} from 'lucide-react';
import type { PluginComponentProps } from './hs-plugin';
import { hostFrameStyle } from './host-style';
import { colorIconComponents } from './color-icons';
import { useFitFontSize } from './fit';
import { todaysSunTimes } from './astro';
import type { SunTimes } from './astro';

// ── Data shapes the host injects when dataRequirements includes "weather" ──
// (mirrors the host's src/lib/weather/types.ts)

interface HourlyWeather {
  time: string;          // ISO instant
  temp: number;
  feelsLike?: number;
  humidity?: number;
  windSpeed?: number;
  /** Where the wind blows from, in degrees (0 north, 90 east). */
  windDirection?: number;
  windGust?: number;
  uvIndex?: number;
  icon: string;
  description: string;
  precipProbability?: number;
}

interface ForecastDay {
  date: string;          // YYYY-MM-DD on the location's own calendar
  high: number;
  low: number;
  icon: string;
  description: string;
  precipProbability?: number;
  precipAmount?: number;
  humidity?: number;
  windSpeed?: number;
}

interface MinutelyPrecip {
  time: number;
  /** in/h imperial, mm/h metric. */
  intensity: number;
  probability?: number;
}

interface WeatherAlert {
  title: string;
  severity: 'Extreme' | 'Severe' | 'Moderate' | 'Minor' | 'Unknown';
  description: string;
  expires: number;
  uri?: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type IconComponent = React.ComponentType<any>;

/** Flat line icons, the host's "Outline" icon set. */
const LINE_ICONS: Record<string, IconComponent> = {
  sun: Sun,
  moon: Moon,
  cloud: Cloud,
  'cloud-sun': CloudSun,
  'cloud-moon': CloudMoon,
  'cloud-rain': CloudRain,
  'cloud-drizzle': CloudDrizzle,
  'cloud-snow': CloudSnow,
  'cloud-lightning': CloudLightning,
  'cloud-fog': CloudFog,
  snowflake: Snowflake,
  thermometer: Thermometer,
  'cloud-hail': CloudHail,
};

const BASE_FONT = 24;
/** With "Grow text to fill" on, the fit starts from this share of the box
 *  height and shrinks to the largest size that fits. */
const FILL_CEILING = 0.25;

/** Rain drops on the rain-chance icon when rain is possible. A light blue, so
 *  it reads on dark backgrounds; the icon outline carries it on light ones. */
const RAIN_BLUE = '#4fb0ff';
/** The "H" and "L" letters of today's high / low. Mid-bright tints, so they
 *  hold on dark backgrounds, with the text outline carrying them on light ones. */
const HIGH_ORANGE = '#fb923c';
const LOW_BLUE = RAIN_BLUE;
const SUN_AMBER = '#fbbf24';
/** Night hours get a faint blue-black wash; the current hour a faint light one. */
const NIGHT_WASH = 'rgba(8, 16, 48, 0.32)';
const NOW_WASH = 'rgba(255, 255, 255, 0.14)';

// Secondary text is dimmed far less than the host's TEXT_OPACITY steps: this
// display is read from across a room, where faint text simply disappears.
const SECONDARY = 0.82;
const DIM = 0.7;

/** An hour cell, in em of the module's font, for picking how many rows the
 *  hours wrap onto (label, icon, temperature and rain line). */
const HOUR_CELL_W = 3.6;
const HOUR_CELL_H = 6.4;
const HOUR_EXTRA_H = 1.2;

const SEVERITY_RANK: Record<string, number> = { Extreme: 0, Severe: 1, Moderate: 2, Minor: 3, Unknown: 4 };
const SEVERITY_COLOR: Record<string, string> = {
  Extreme: '#b91c1c', Severe: '#dc2626', Moderate: '#d97706', Minor: '#a16207', Unknown: '#475569',
};

// ── Helpers ────────────────────────────────────────────────────────────

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function deg(value: number | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? `${Math.round(value)}°` : '–';
}

/** Epoch ms from a provider timestamp that may be in seconds. */
function msOf(t: number): number {
  return t < 1e12 ? t * 1000 : t;
}

function hourLabel(iso: string, timezone?: string, timeFormat?: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  try {
    return new Intl.DateTimeFormat(undefined, {
      hour: 'numeric',
      hour12: timeFormat ? timeFormat !== '24h' : undefined,
      timeZone: timezone,
    }).format(d);
  } catch {
    return d.toLocaleTimeString(undefined, { hour: 'numeric' });
  }
}

function clockLabel(ms: number, timezone?: string, timeFormat?: string): string {
  const opts: Intl.DateTimeFormatOptions = {
    hour: 'numeric', minute: '2-digit', hour12: timeFormat ? timeFormat !== '24h' : undefined,
  };
  try {
    return new Intl.DateTimeFormat(undefined, { ...opts, timeZone: timezone }).format(ms);
  } catch {
    return new Intl.DateTimeFormat(undefined, opts).format(ms);
  }
}

function dayLabel(date: string, index: number, short = false): string {
  if (index === 0) return 'Today';
  if (index === 1 && short) return 'Tmrw';
  // A calendar date, not an instant: read it at noon UTC and format in UTC
  // so it never slips to the neighbouring day.
  const d = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return date;
  return new Intl.DateTimeFormat(undefined, { weekday: 'short', timeZone: 'UTC' }).format(d);
}

/** Light tints from cold blue to hot red, in °F. Light enough to read on a
 *  dark background; the text outline carries them on a light one. */
const TEMP_STOPS: Array<[number, [number, number, number]]> = [
  [20, [191, 219, 254]], [40, [147, 197, 253]], [55, [167, 243, 208]],
  [68, [253, 230, 138]], [80, [253, 186, 116]], [92, [252, 165, 165]],
];

function tempColor(t: number, metric: boolean): string {
  const f = metric ? t * 9 / 5 + 32 : t;
  if (f <= TEMP_STOPS[0][0]) return `rgb(${TEMP_STOPS[0][1].join(',')})`;
  for (let i = 1; i < TEMP_STOPS.length; i++) {
    const [t1, c1] = TEMP_STOPS[i];
    if (f <= t1) {
      const [t0, c0] = TEMP_STOPS[i - 1];
      const k = (f - t0) / (t1 - t0);
      return `rgb(${c0.map((v, j) => Math.round(v + (c1[j] - v) * k)).join(',')})`;
    }
  }
  return `rgb(${TEMP_STOPS[TEMP_STOPS.length - 1][1].join(',')})`;
}

function uvColor(uv: number): string {
  if (uv < 3) return '#4ade80';
  if (uv < 6) return '#facc15';
  if (uv < 8) return '#fb923c';
  if (uv < 11) return '#f87171';
  return '#c084fc';
}

/** Offsets around a circle of radius r, used to build a smooth outline from
 *  hard-edged shadows (rounder than -webkit-text-stroke, which grows spiky
 *  miter corners on small text). */
function ring(r: number): Array<[number, number]> {
  if (r <= 0) return [];
  const pts: Array<[number, number]> = [];
  const radii = r > 1.5 ? [r, r / 2] : [r];
  for (const rad of radii) {
    const steps = rad === r ? 16 : 8;
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      pts.push([+(Math.cos(a) * rad).toFixed(2), +(Math.sin(a) * rad).toFixed(2)]);
    }
  }
  return pts;
}

function textOutline(color: string, width: number, shadow: boolean): CSSProperties {
  const parts = ring(width).map(([x, y]) => `${x}px ${y}px 0 ${color}`);
  if (shadow) parts.push(`0 0 ${Math.max(4, width * 3).toFixed(1)}px rgba(0, 0, 0, 0.75)`);
  return parts.length ? { textShadow: parts.join(', ') } : {};
}

/** Icon outline: stacked drop-shadows trace the SVG strokes. Each one also
 *  shadows the previous result, so four offsets give an even outline. */
function iconOutline(color: string, width: number, shadow: boolean): string | undefined {
  const parts: string[] = [];
  if (width > 0) {
    const w = +width.toFixed(2);
    parts.push(
      `drop-shadow(${w}px 0 0 ${color})`,
      `drop-shadow(${-w}px 0 0 ${color})`,
      `drop-shadow(0 ${w}px 0 ${color})`,
      `drop-shadow(0 ${-w}px 0 ${color})`,
    );
  }
  if (shadow) parts.push(`drop-shadow(0 0 ${Math.max(4, width * 3).toFixed(1)}px rgba(0, 0, 0, 0.6))`);
  return parts.length ? parts.join(' ') : undefined;
}

/** Now, re-read on each minute boundary: the "Now" column, night shading,
 *  rain nowcast and staleness note all move with the clock, not the data. */
function useMinuteClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timer = setTimeout(() => { setNow(Date.now()); schedule(); }, 60_000 - (Date.now() % 60_000) + 50);
    };
    schedule();
    return () => clearTimeout(timer);
  }, []);
  return now;
}

/** The next hour's rain from minute-by-minute data, when the provider sends it:
 *  "Rain starting in 12 min", "Rain ending in 25 min", "Rain for the next hour". */
function nowcast(minutely: MinutelyPrecip[], now: number, metric: boolean) {
  // Lighter than this (in/h or mm/h) is a trace nobody would call rain.
  const wetAt = metric ? 0.1 : 0.004;
  const pts = minutely
    .filter((m) => m && typeof m.time === 'number' && typeof m.intensity === 'number')
    .map((m) => ({
      t: msOf(m.time),
      i: m.intensity,
      wet: m.intensity >= wetAt && (m.probability == null || m.probability >= 30),
    }))
    .filter((m) => m.t >= now - 60_000)
    .sort((a, b) => a.t - b.t)
    .slice(0, 61);
  if (pts.length < 5 || !pts.some((m) => m.wet)) return null;
  const wetNow = pts[0].wet;
  const change = pts.findIndex((m) => m.wet !== wetNow);
  const mins = change < 0 ? 0 : Math.max(1, Math.round((pts[change].t - now) / 60_000));
  const text = wetNow
    ? change < 0 ? 'Rain for the next hour' : `Rain ending in ${mins} min`
    : `Rain starting in ${mins} min`;
  const peak = Math.max(...pts.map((m) => m.i), wetAt * 4);
  return { text, bars: pts.map((m) => (m.wet ? Math.max(0.12, m.i / peak) : 0)) };
}

// ── Component ──────────────────────────────────────────────────────────

export default function OutlinedWeather(props: PluginComponentProps) {
  const { config, style } = props;
  const p = props as PluginComponentProps & { timeFormat?: string; weatherError?: unknown };
  const now = useMinuteClock();
  const metric = props.units === 'metric';

  const view = (config.view as string) || 'combined';
  const outlineColor = (config.outlineColor as string) || '#000000';
  const outlineIcons = config.outlineIcons !== false;
  const softShadow = config.softShadow !== false;
  const autoSize = config.autoSize !== false;
  const hourCount = Math.max(1, Math.round(num(config.hourCount, 12)));
  const hoursPerRow = Math.max(0, Math.round(num(config.hoursPerRow, 0)));
  const dayCount = Math.max(1, Math.round(num(config.dayCount, 7)));
  const upcomingDays = Math.max(0, Math.round(num(config.upcomingDays, 3)));
  const showTodayPanel = config.showTodayPanel !== false;
  const showDescription = config.showDescription !== false;
  const showHighLow = config.showHighLow !== false;
  const showFeelsLike = config.showFeelsLike !== false;
  const showPrecip = config.showPrecip !== false;
  const rainThreshold = Math.max(0, num(config.rainThreshold, 10));
  const showHumidity = config.showHumidity !== false;
  const showWind = config.showWind !== false;
  const showUV = config.showUV !== false;
  const hourWind = config.hourWind === true;
  const hourUV = config.hourUV === true;
  const showAlerts = config.showAlerts !== false;
  const showNowcast = config.showNowcast !== false;
  const shadeNight = config.shadeNight !== false;
  const tempColors = config.tempColors !== false;
  const nightDim = Math.min(0.8, Math.max(0, num(config.nightDim, 0) / 100));
  const colorIcons = config.iconStyle !== 'line';

  // Hours that haven't ended yet: a stale payload otherwise leads with the past.
  const allHourly = (Array.isArray(props.hourly) ? props.hourly : []) as HourlyWeather[];
  const hourly = allHourly.filter((h) => {
    const t = Date.parse(h.time);
    return Number.isNaN(t) || t + 3_600_000 > now;
  });
  const forecast = (Array.isArray(props.forecast) ? props.forecast : []) as ForecastDay[];
  const alerts = (showAlerts && Array.isArray(props.alerts) ? props.alerts as WeatherAlert[] : [])
    .filter((a) => a && a.title && (!a.expires || msOf(a.expires) > now))
    .sort((a, b) => (SEVERITY_RANK[a.severity] ?? 4) - (SEVERITY_RANK[b.severity] ?? 4));
  const rainSoon = showNowcast && Array.isArray(props.minutely)
    ? nowcast(props.minutely as MinutelyPrecip[], now, metric)
    : null;

  // Forecast data older than this says nothing about now; say so.
  const firstHour = allHourly.length ? Date.parse(allHourly[0].time) : NaN;
  const staleHours = Number.isNaN(firstHour) ? 0 : Math.floor((now - firstHour) / 3_600_000);
  const stale = p.weatherError && allHourly.length
    ? 'Couldn’t refresh — showing the last forecast'
    : staleHours >= 2 ? `Forecast is ${staleHours} h old` : null;

  // Sun times per calendar day, for night shading and the sunrise / sunset marks.
  const lat = props.latitude;
  const lng = props.longitude;
  const sunCache = new Map<string, SunTimes>();
  const sunFor = (ms: number): SunTimes | null => {
    if (typeof lat !== 'number' || typeof lng !== 'number') return null;
    const key = new Date(ms).toLocaleDateString('en-US', { timeZone: props.timezone });
    let t = sunCache.get(key);
    if (!t) { t = todaysSunTimes(ms, lat, lng, props.timezone); sunCache.set(key, t); }
    return t;
  };
  const isNight = (ms: number): boolean => {
    const t = sunFor(ms);
    if (!t) return false;
    if (t.polar) return t.polar === 'night';
    return t.sunrise == null || t.sunset == null || ms < t.sunrise || ms >= t.sunset;
  };
  const nightNow = isNight(now);

  const current = hourly[0];
  const today = forecast[0];

  // ── Hours per row ──
  // How many rows the hour grid wraps onto: fixed by the setting, or chosen
  // for the box's shape so the hours draw as large as they can. Judged from the
  // module's own size (not the grid's, which moves with the font) so the
  // choice can't flip back and forth as the text settles.
  const extraLines = (hourWind ? 1 : 0) + (hourUV ? 1 : 0);
  const pickColumns = (n: number, areaW: number, areaH: number): number => {
    if (n <= 0) return 1;
    if (hoursPerRow > 0) return Math.min(n, hoursPerRow);
    if (!areaW || !areaH) return n;
    const cellH = HOUR_CELL_H + extraLines * HOUR_EXTRA_H;
    let best = n;
    let bestSize = 0;
    for (let rows = 1; rows <= Math.min(4, n); rows++) {
      const cols = Math.ceil(n / rows);
      // Rows past the first also pay for the rule and gaps between them.
      const size = Math.min(areaW / (cols * HOUR_CELL_W), areaH / (rows * cellH + (rows - 1) * 1.2));
      if (size > bestSize * 1.04) { bestSize = size; best = cols; }
    }
    return best;
  };

  // Grow the text until the content fills the module's box (or, with that off,
  // start from the Text size setting), then shrink to the largest size that
  // fits. The key restarts the fit whenever what is drawn changes.
  const styleFont = Math.max(1, num(style.fontSize, BASE_FONT));
  const { boxRef, fontSize, boxW, boxH } = useFitFontSize(
    (w, h) => (autoSize ? Math.max(styleFont, h * FILL_CEILING) : styleFont),
    [
      view, hourCount, hoursPerRow, dayCount, upcomingDays, hourly.length, forecast.length, current?.time, forecast[0]?.date,
      colorIcons, showDescription, showHighLow, showFeelsLike, showPrecip, rainThreshold, showHumidity, showWind, showUV,
      hourWind, hourUV, showTodayPanel, shadeNight, alerts.length, alerts[0]?.title, rainSoon?.text, stale,
      p.locationMissing, p.weatherError ? 1 : 0, style.fontFamily, style.padding,
    ].join('|'),
  );

  // Scale the outline with the rendered text size (authored against 24px).
  const scale = fontSize / BASE_FONT;
  const outlineWidth = Math.max(0, num(config.outlineWidth, 0.5)) * scale;

  const iconFilter = outlineIcons ? iconOutline(outlineColor, outlineWidth, softShadow) : undefined;

  const root: CSSProperties = {
    ...hostFrameStyle(style, { baseFontSize: BASE_FONT }),
    ...textOutline(outlineColor, outlineWidth, softShadow),
    fontSize,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.5em',
    lineHeight: 1.15,
    ...(nightDim > 0 && nightNow ? { filter: `brightness(${1 - nightDim})` } : {}),
  };

  const windUnit = metric ? 'km/h' : 'mph';
  const tColor = (t: number | undefined) => (tempColors && typeof t === 'number' && Number.isFinite(t) ? tempColor(t, metric) : undefined);
  const rainShown = (v: number | undefined) => {
    if (!showPrecip || typeof v !== 'number' || !Number.isFinite(v)) return false;
    const r = Math.round(v);
    return rainThreshold > 0 ? r >= rainThreshold : true;
  };

  const Icon = ({ id, size }: { id: string; size: string }) => {
    const C = colorIcons
      ? colorIconComponents[id] ?? colorIconComponents.thermometer
      : LINE_ICONS[id] ?? Thermometer;
    return (
      <C
        size={size}
        strokeWidth={1.75}
        style={{ filter: iconFilter, overflow: 'visible', flexShrink: 0 }}
        aria-hidden="true"
      />
    );
  };

  /** Lucide's CloudRain, drawn by hand so the drops can turn blue (and a
   *  touch heavier, to hold the colour at small sizes) when rain is possible. */
  const RainIcon = ({ wet, size }: { wet: boolean; size: string }) => (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
      style={{ filter: iconFilter, overflow: 'visible', flexShrink: 0 }} aria-hidden="true"
    >
      <path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242" />
      <g stroke={wet ? RAIN_BLUE : 'currentColor'} strokeWidth={wet ? 2.6 : 2}>
        <path d="M16 14v6" />
        <path d="M8 14v6" />
        <path d="M12 16v6" />
      </g>
    </svg>
  );

  /** The rain chance under an hour or day column: only when worth showing. */
  const Precip = ({ value }: { value?: number }) =>
    rainShown(value) && Math.round(value!) > 0 ? (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.15em', fontSize: '0.85em', whiteSpace: 'nowrap' }}>
        <RainIcon wet size="1.1em" />
        {Math.round(value!)}%
      </span>
    ) : null;

  /** The rain-chance reading in a stats line. With any chance of rain the icon
   *  stays at full strength so the blue isn't washed out. */
  const RainStat = ({ value, size = '0.85em' }: { value?: number; size?: string }) => {
    if (!rainShown(value)) return null;
    const wet = Math.round(value!) > 0;
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.15em', fontSize: size, whiteSpace: 'nowrap' }}>
        <span style={{ display: 'inline-flex', opacity: wet ? 1 : DIM }}><RainIcon wet={wet} size="1em" /></span>
        <span style={{ opacity: DIM }}>{Math.round(value!)}%</span>
      </span>
    );
  };

  /** A dimmed reading with a line icon, like the host's WeatherStat. */
  const Stat = ({ icon: StatIcon, value, unit, show, size = '0.85em' }: {
    icon: IconComponent; value?: number; unit?: string; show: boolean; size?: string;
  }) =>
    show && typeof value === 'number' && Number.isFinite(value) ? (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.15em', fontSize: size, opacity: DIM, whiteSpace: 'nowrap' }}>
        <StatIcon size="1em" strokeWidth={2} style={{ filter: iconFilter, overflow: 'visible' }} aria-hidden="true" />
        {Math.round(value)}{unit}
      </span>
    ) : null;

  /** Wind speed with an arrow pointing where it blows to, and gusts if strong. */
  const WindStat = ({ speed, dir, gust, show, unit = '', size = '0.85em' }: {
    speed?: number; dir?: number; gust?: number; show: boolean; unit?: string; size?: string;
  }) =>
    show && typeof speed === 'number' && Number.isFinite(speed) ? (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.15em', fontSize: size, opacity: DIM, whiteSpace: 'nowrap' }}>
        {typeof dir === 'number'
          ? <ArrowUp size="1em" strokeWidth={2.5} style={{ filter: iconFilter, overflow: 'visible', transform: `rotate(${dir + 180}deg)` }} aria-hidden="true" />
          : <Wind size="1em" strokeWidth={2} style={{ filter: iconFilter, overflow: 'visible' }} aria-hidden="true" />}
        {Math.round(speed)}{typeof gust === 'number' && gust >= speed + 8 ? `–${Math.round(gust)}` : ''}{unit}
      </span>
    ) : null;

  /** UV index as a coloured pill, so the level reads before the number does. */
  const UV = ({ value, show, size = '0.85em' }: { value?: number; show: boolean; size?: string }) =>
    show && typeof value === 'number' && Number.isFinite(value) ? (
      <span style={{
        display: 'inline-flex', alignItems: 'center', fontSize: size, fontWeight: 700, whiteSpace: 'nowrap',
        background: uvColor(value), color: '#111827', textShadow: 'none', borderRadius: '0.35em', padding: '0 0.35em',
      }}>
        UV {Math.round(value)}
      </span>
    ) : null;

  /** "H:64° L:43°" with an orange H and a blue L. The letters stay at full
   *  strength and a little heavier so the colour reads; only the numbers take
   *  `numberOpacity` (dimming the letters too washed the colours out). */
  const hiLo = (high: number, low: number, numberOpacity = 1, colon = true) => (
    <>
      <span style={{ color: HIGH_ORANGE, fontWeight: 600 }}>H</span>
      <span style={{ opacity: numberOpacity }}>{colon ? ':' : ' '}{deg(high)}</span>
      {colon ? ' ' : ' · '}
      <span style={{ color: LOW_BLUE, fontWeight: 600 }}>L</span>
      <span style={{ opacity: numberOpacity }}>{colon ? ':' : ' '}{deg(low)}</span>
    </>
  );

  /** "Feels like", only when it actually differs from the temperature. */
  const feelsLike = (h: HourlyWeather | undefined) =>
    showFeelsLike && h && typeof h.feelsLike === 'number' && Math.abs(h.feelsLike - h.temp) >= 3
      ? <span style={{ opacity: SECONDARY, whiteSpace: 'nowrap' }}>Feels like {deg(h.feelsLike)}</span>
      : null;

  const rainSoonLine = rainSoon ? (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35em', whiteSpace: 'nowrap', fontWeight: 600 }}>
      <RainIcon wet size="1.1em" />
      {rainSoon.text}
      <svg width="4em" height="0.9em" viewBox={`0 0 ${rainSoon.bars.length} 10`} preserveAspectRatio="none" aria-hidden="true">
        {rainSoon.bars.map((b, i) => (b > 0 ? <rect key={i} x={i} y={10 - b * 10} width={0.8} height={b * 10} fill={RAIN_BLUE} /> : null))}
        <rect x={0} y={9.6} width={rainSoon.bars.length} height={0.4} fill="currentColor" opacity={0.4} />
      </svg>
    </span>
  ) : null;

  const alertBanner = alerts.length ? (
    <div style={{
      alignSelf: 'stretch', display: 'flex', alignItems: 'center', gap: '0.45em', flexShrink: 0,
      padding: '0.2em 0.55em', borderRadius: '0.4em', fontWeight: 600, color: '#ffffff',
      background: SEVERITY_COLOR[alerts[0].severity] ?? SEVERITY_COLOR.Unknown,
    }}>
      <TriangleAlert size="1.1em" strokeWidth={2.25} style={{ flexShrink: 0, filter: iconFilter, overflow: 'visible' }} aria-hidden="true" />
      <span style={{ minWidth: 0 }}>{alerts[0].title}</span>
      {alerts.length > 1 && <span style={{ marginLeft: 'auto', whiteSpace: 'nowrap', opacity: 0.9 }}>+{alerts.length - 1} more</span>}
    </div>
  ) : null;

  const staleNote = stale
    ? <div style={{ alignSelf: 'flex-end', fontSize: '0.75em', opacity: DIM, flexShrink: 0 }}>{stale}</div>
    : null;

  const frame = (body: React.ReactNode, rootStyle: CSSProperties = root) => (
    <div ref={boxRef} style={rootStyle}>
      {alertBanner}
      {body}
      {staleNote}
    </div>
  );

  // ── Empty / error states ──
  if (p.locationMissing) {
    return frame(<span style={{ fontSize: '0.9em' }}>Set your location in Settings &gt; Location &amp; language</span>);
  }
  if (hourly.length === 0 && forecast.length === 0) {
    return frame(<span style={{ fontSize: '0.9em' }}>{p.weatherError ? 'Weather unavailable' : 'Loading weather…'}</span>);
  }

  const vrule = <div style={{ alignSelf: 'stretch', width: 1, flexShrink: 0, background: 'currentColor', opacity: 0.3 }} />;
  const hrule = <div style={{ width: '100%', height: 1, flexShrink: 0, background: 'currentColor', opacity: 0.25 }} />;

  /** Today's conditions: the hourly views' left panel. */
  const todayPanel = current ? (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.15em', flexShrink: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.25em' }}>
        <span style={{ fontSize: '3em', fontWeight: 400, lineHeight: 1 }}>{deg(current.temp)}</span>
        <Icon id={current.icon} size="2.5em" />
      </div>
      {showHighLow && today && <span style={{ whiteSpace: 'nowrap' }}>{hiLo(today.high, today.low, SECONDARY)}</span>}
      {showDescription && current.description && (
        <span style={{ opacity: SECONDARY, textTransform: 'capitalize', textAlign: 'center' }}>{current.description}</span>
      )}
      {feelsLike(current)}
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', columnGap: '0.6em', rowGap: '0.1em' }}>
        <Stat icon={Droplets} value={current.humidity} unit="%" show={showHumidity} />
        <WindStat speed={current.windSpeed} dir={current.windDirection} gust={current.windGust} show={showWind} />
        <UV value={current.uvIndex} show={showUV && !nightNow} />
      </div>
      {rainSoonLine && <span style={{ fontSize: '0.85em' }}>{rainSoonLine}</span>}
    </div>
  ) : null;

  /** One upcoming day as a compact line (wrapping its readings if narrow). */
  const dayLine = (d: ForecastDay, index: number) => (
    <div key={d.date} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', columnGap: '0.5em', rowGap: '0.05em' }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35em', whiteSpace: 'nowrap' }}>
        <span style={{ opacity: SECONDARY, minWidth: '2.6em' }}>{dayLabel(d.date, index, true)}</span>
        <Icon id={d.icon} size="1.4em" />
        {showHighLow && (
          <>
            <span style={{ fontWeight: 600, color: tColor(d.high) }}>{deg(d.high)}</span>
            <span style={{ opacity: DIM, color: tColor(d.low) }}>{deg(d.low)}</span>
          </>
        )}
      </span>
      <RainStat value={d.precipProbability} />
    </div>
  );

  // ── Hour cells, shared by the hourly views and the dashboard ──
  const sunMark = (t: number) => {
    const s = shadeNight ? sunFor(t) : null;
    if (!s) return null;
    const end = t + 3_600_000;
    const mark = (ms: number | null, I: IconComponent) => (ms != null && ms >= t && ms < end ? (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.15em', fontSize: '0.75em', whiteSpace: 'nowrap' }}>
        <I size="1.2em" strokeWidth={2} style={{ color: SUN_AMBER, filter: iconFilter, overflow: 'visible' }} aria-hidden="true" />
        {clockLabel(ms, props.timezone, p.timeFormat)}
      </span>
    ) : null);
    return mark(s.sunrise, Sunrise) ?? mark(s.sunset, Sunset);
  };

  const hourCell = (h: HourlyWeather, isNow: boolean) => {
    const t = Date.parse(h.time);
    const night = shadeNight && !Number.isNaN(t) && isNight(t + 1_800_000);
    return (
      <div key={h.time} style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.2em',
        padding: '0.3em 0.3em', borderRadius: '0.5em', alignSelf: 'stretch', justifySelf: 'stretch',
        background: isNow ? NOW_WASH : night ? NIGHT_WASH : undefined,
      }}>
        <span style={{ whiteSpace: 'nowrap', fontWeight: isNow ? 700 : 400 }}>{isNow ? 'Now' : hourLabel(h.time, props.timezone, p.timeFormat)}</span>
        <Icon id={h.icon} size="2.2em" />
        <span style={{ fontWeight: 600, fontSize: '1.3em', color: tColor(h.temp) }}>{deg(h.temp)}</span>
        <Precip value={h.precipProbability} />
        {hourWind && <WindStat speed={h.windSpeed} dir={h.windDirection} gust={h.windGust} show />}
        {hourUV && <UV value={h.uvIndex} show={!night} size="0.75em" />}
        {!Number.isNaN(t) && sunMark(t)}
      </div>
    );
  };

  /** The hours as a grid, `cols` wide, with a rule between rows. */
  const hourGrid = (hours: HourlyWeather[], cols: number, nowFirst: boolean) => (
    <div
      data-fit="x"
      style={{
        display: 'grid', width: '100%', minWidth: 0, justifyItems: 'center', alignItems: 'start',
        // Spread the rows (and the rules between them) over the full height.
        alignContent: 'space-evenly', alignSelf: 'stretch',
        gridTemplateColumns: `repeat(${Math.max(1, cols)}, minmax(min-content, 1fr))`,
        columnGap: '0.25em', rowGap: '0.5em',
      }}
    >
      {hours.flatMap((h, i) => {
        const cell = hourCell(h, nowFirst && i === 0);
        return i > 0 && i % cols === 0
          ? [<div key={`rule-${i}`} style={{ gridColumn: '1 / -1', justifySelf: 'stretch', height: 1, background: 'currentColor', opacity: 0.25 }} />, cell]
          : [cell];
      })}
    </div>
  );

  // ── Views ──

  if (view === 'combined') {
    return frame(dashboard(), { ...root, alignItems: 'stretch', justifyContent: 'flex-start' });
  }

  if (view === 'current') {
    return frame(current ? (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.2em' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35em' }}>
          <Icon id={current.icon} size="3.2em" />
          <span style={{ fontSize: '4em', fontWeight: 500, lineHeight: 1 }}>{deg(current.temp)}</span>
        </div>
        {showDescription && current.description && (
          <div style={{ textTransform: 'capitalize' }}>{current.description}</div>
        )}
        <div style={{ display: 'flex', columnGap: '0.8em', rowGap: '0.1em', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center' }}>
          {showHighLow && today && <span style={{ whiteSpace: 'nowrap' }}>{hiLo(today.high, today.low, 1, false)}</span>}
          {feelsLike(current)}
          <RainStat value={current.precipProbability ?? today?.precipProbability} />
          <UV value={current.uvIndex} show={showUV && !nightNow} />
        </div>
        {rainSoonLine && <span style={{ fontSize: '0.85em' }}>{rainSoonLine}</span>}
      </div>
    ) : null);
  }

  if (view === 'daily') {
    const dailyPanel = today ? (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.1em', flexShrink: 0 }}>
        <span style={{ fontWeight: 600, opacity: SECONDARY }}>{dayLabel(today.date, 0)}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.2em' }}>
          <Icon id={today.icon} size="2.5em" />
          {showHighLow && (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontSize: '2em', fontWeight: 500, lineHeight: 1.1, color: tColor(today.high) }}>{deg(today.high)}</span>
              <span style={{ fontSize: '1.2em', opacity: DIM, lineHeight: 1.1, color: tColor(today.low) }}>{deg(today.low)}</span>
            </div>
          )}
        </div>
        <RainStat value={today.precipProbability} />
        <Stat icon={Droplets} value={today.humidity} unit="%" show={showHumidity} />
        <WindStat speed={today.windSpeed} show={showWind} unit={` ${windUnit}`} />
      </div>
    ) : null;
    const from = showTodayPanel && dailyPanel ? 1 : 0;
    const days = forecast.slice(from, dayCount).map((d, i) => (
      <div key={d.date} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.25em' }}>
        <span style={{ whiteSpace: 'nowrap' }}>{dayLabel(d.date, i + from)}</span>
        <Icon id={d.icon} size="2em" />
        <span style={{ fontWeight: 600, fontSize: '1.2em', color: tColor(d.high) }}>{deg(d.high)}</span>
        <span style={{ color: tColor(d.low), opacity: DIM }}>{deg(d.low)}</span>
        <Precip value={d.precipProbability} />
      </div>
    ));
    const row = (
      <div data-fit="x" style={{ display: 'flex', width: '100%', minWidth: 0, justifyContent: 'space-around', gap: '0.5em' }}>
        {days}
      </div>
    );
    return frame(forecast.length > 0 ? (
      from ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.8em', width: '100%' }}>
          {dailyPanel}{vrule}{row}
        </div>
      ) : row
    ) : null);
  }

  // Hourly and Hourly +1: today on the left (Hourly +1 adds the coming days
  // under it), the hours in a grid that wraps to suit the box.
  const withPanel = showTodayPanel && !!todayPanel;
  const hours = hourly.slice(withPanel ? 1 : 0, (withPanel ? 1 : 0) + hourCount);
  const plusDays = view === 'hourlyPlus' ? forecast.slice(1, 1 + upcomingDays) : [];
  const hasLeft = withPanel || plusDays.length > 0;
  const bannerShare = alertBanner ? 0.85 : 1;
  const cols = pickColumns(hours.length, boxW * (hasLeft ? 0.7 : 1), boxH * bannerShare);
  return frame(
    <div style={{ display: 'flex', alignSelf: 'stretch', flex: 1, minHeight: 0, gap: '0.8em' }}>
      {hasLeft && (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5em', width: 'min-content', flexShrink: 0 }}>
            {/* Today sits centred in the space above the coming days. */}
            <div style={{ flex: 1, display: 'flex', alignItems: 'center' }}>{withPanel ? todayPanel : null}</div>
            {plusDays.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35em', alignSelf: 'stretch' }}>
                {withPanel ? hrule : null}
                {plusDays.map((d, i) => dayLine(d, i + 1))}
              </div>
            )}
          </div>
          {vrule}
        </>
      )}
      <div style={{ display: 'flex', flex: 1, minWidth: 0 }}>{hourGrid(hours, cols, !withPanel)}</div>
    </div>,
  );

  /** The dashboard ("combined"): today and a temperature graph of the coming
   *  hours across the top, then the week as rows of low-to-high range bars on
   *  one shared scale. Built for a screen of its own. */
  function dashboard() {
    const hrs = hourly.slice(0, hourCount);
    const days = forecast.slice(0, dayCount);
    const temps = hrs.map((h) => h.temp).filter((t) => Number.isFinite(t));
    const tMin = Math.min(...temps);
    const tMax = Math.max(...temps);
    const span = Math.max(1, tMax - tMin);
    const anyRain = hrs.some((h) => rainShown(h.precipProbability) && Math.round(h.precipProbability!) > 0);
    const weekLo = Math.min(...days.map((d) => d.low));
    const weekHi = Math.max(...days.map((d) => d.high));
    const weekSpan = Math.max(1, weekHi - weekLo);
    const pct = (t: number) => `${(((t - weekLo) / weekSpan) * 100).toFixed(1)}%`;

    const hero = current ? (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '0.15em', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.25em' }}>
          <Icon id={current.icon} size="2.8em" />
          <span style={{ fontSize: '3.4em', fontWeight: 400, lineHeight: 1 }}>{deg(current.temp)}</span>
        </div>
        {showHighLow && today && <span style={{ whiteSpace: 'nowrap', fontSize: '1.05em' }}>{hiLo(today.high, today.low, SECONDARY)}</span>}
        {showDescription && current.description && (
          <span style={{ opacity: SECONDARY, textTransform: 'capitalize' }}>{current.description}</span>
        )}
        {feelsLike(current)}
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', columnGap: '0.6em', rowGap: '0.1em' }}>
          <Stat icon={Droplets} value={current.humidity} unit="%" show={showHumidity} />
          <WindStat speed={current.windSpeed} dir={current.windDirection} gust={current.windGust} show={showWind} />
          <UV value={current.uvIndex} show={showUV && !nightNow} />
        </div>
        {rainSoonLine && <span style={{ fontSize: '0.85em' }}>{rainSoonLine}</span>}
      </div>
    ) : null;

    // The hours: label, icon and temperature per column, a line through the
    // temperatures, and rain-chance bars along the bottom.
    const n = hrs.length;
    const graph = n > 0 ? (
      <div data-fit="x" style={{
        flex: 1, minWidth: 0, display: 'grid', alignSelf: 'stretch', alignContent: 'center',
        gridTemplateColumns: `repeat(${n}, minmax(min-content, 1fr))`, justifyItems: 'center', rowGap: '0.15em',
      }}>
        {hrs.map((h, i) => {
          const t = Date.parse(h.time);
          const night = shadeNight && !Number.isNaN(t) && isNight(t + 1_800_000);
          return (
            <div key={h.time} style={{
              gridColumn: i + 1, gridRow: '1 / span 4', justifySelf: 'stretch', borderRadius: '0.45em',
              background: i === 0 ? NOW_WASH : night ? NIGHT_WASH : undefined,
            }} />
          );
        })}
        {hrs.map((h, i) => (
          <span key={`l${h.time}`} style={{ gridColumn: i + 1, gridRow: 1, whiteSpace: 'nowrap', padding: '0.2em 0.2em 0', fontWeight: i === 0 ? 700 : 400 }}>
            {i === 0 ? 'Now' : hourLabel(h.time, props.timezone, p.timeFormat)}
          </span>
        ))}
        {hrs.map((h, i) => (
          <span key={`i${h.time}`} style={{ gridColumn: i + 1, gridRow: 2, display: 'flex' }}><Icon id={h.icon} size="2em" /></span>
        ))}
        {hrs.map((h, i) => (
          <span key={`t${h.time}`} style={{ gridColumn: i + 1, gridRow: 3, fontWeight: 600, fontSize: '1.2em', color: tColor(h.temp) }}>{deg(h.temp)}</span>
        ))}
        <svg
          style={{ gridColumn: '1 / -1', gridRow: 4, width: '100%', height: '2.4em', overflow: 'visible', filter: iconFilter }}
          viewBox={`0 0 ${n} 100`} preserveAspectRatio="none" aria-hidden="true"
        >
          <polyline
            fill="none" stroke={tempColors ? HIGH_ORANGE : 'currentColor'} strokeWidth={3} vectorEffect="non-scaling-stroke"
            strokeLinejoin="round" strokeLinecap="round"
            points={hrs.map((h, i) => `${i + 0.5},${(88 - ((h.temp - tMin) / span) * 76).toFixed(1)}`).join(' ')}
          />
        </svg>
        {anyRain && hrs.map((h, i) => {
          const v = rainShown(h.precipProbability) ? Math.round(h.precipProbability!) : 0;
          return (
            <div key={`r${h.time}`} style={{ gridColumn: i + 1, gridRow: 5, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', height: '2.6em' }}>
              {v > 0 && <span style={{ fontSize: '0.8em', whiteSpace: 'nowrap' }}>{v}%</span>}
              <div style={{ width: '1.2em', height: `${(v / 100) * 1.5}em`, background: RAIN_BLUE, borderRadius: '0.15em 0.15em 0 0' }} />
            </div>
          );
        })}
        {hrs.map((h, i) => {
          const t = Date.parse(h.time);
          const mark = Number.isNaN(t) ? null : sunMark(t);
          return mark ? <span key={`s${h.time}`} style={{ gridColumn: i + 1, gridRow: 6 }}>{mark}</span> : null;
        })}
      </div>
    ) : null;

    const week = days.length > 0 ? (
      <div data-fit style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', justifyContent: 'space-evenly' }}>
        {days.map((d, i) => (
          <div key={d.date} style={{ display: 'flex', alignItems: 'center', gap: '0.6em', fontSize: '1.2em' }}>
            <span style={{ width: '3.2em', flexShrink: 0, fontWeight: i === 0 ? 700 : 400 }}>{dayLabel(d.date, i, true)}</span>
            <Icon id={d.icon} size="1.6em" />
            <span style={{ width: '3.4em', flexShrink: 0 }}><RainStat value={d.precipProbability} /></span>
            <span style={{ width: '2.2em', textAlign: 'right', flexShrink: 0, opacity: DIM, color: tColor(d.low) }}>{deg(d.low)}</span>
            <div style={{ position: 'relative', flex: 1, minWidth: '4em', height: '0.45em', borderRadius: '0.25em', background: 'rgba(255, 255, 255, 0.22)' }}>
              <div style={{
                position: 'absolute', top: 0, bottom: 0, left: pct(d.low), right: `calc(100% - ${pct(d.high)})`, borderRadius: '0.25em',
                background: tempColors ? `linear-gradient(90deg, ${tempColor(d.low, metric)}, ${tempColor(d.high, metric)})` : 'currentColor',
              }} />
              {i === 0 && current && (
                <div style={{
                  position: 'absolute', top: '50%', left: pct(Math.min(d.high, Math.max(d.low, current.temp))), width: '0.75em', height: '0.75em',
                  transform: 'translate(-50%, -50%)', borderRadius: '50%', background: '#ffffff', boxShadow: `0 0 0 0.12em ${outlineColor}`,
                }} />
              )}
            </div>
            <span style={{ width: '2.2em', flexShrink: 0, fontWeight: 600, color: tColor(d.high) }}>{deg(d.high)}</span>
          </div>
        ))}
      </div>
    ) : null;

    return (
      <>
        <div style={{ display: 'flex', alignItems: 'stretch', gap: '0.9em', flexShrink: 0 }}>
          {hero}
          {hero && graph ? vrule : null}
          {graph}
        </div>
        {week ? hrule : null}
        {week}
      </>
    );
  }
}
