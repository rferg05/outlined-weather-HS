import React from 'react';
import type { CSSProperties } from 'react';
import {
  Sun, Moon, Cloud, CloudSun, CloudMoon, CloudRain, CloudDrizzle,
  CloudSnow, CloudLightning, CloudFog, Snowflake, Thermometer, CloudHail,
  Droplets, Wind,
} from 'lucide-react';
import type { PluginComponentProps } from './hs-plugin';
import { hostFrameStyle } from './host-style';
import { colorIconComponents } from './color-icons';

// ── Data shapes the host injects when dataRequirements includes "weather" ──
// (mirrors the host's src/lib/weather/types.ts)

interface HourlyWeather {
  time: string;          // ISO instant
  temp: number;
  feelsLike?: number;
  humidity?: number;
  windSpeed?: number;
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
  humidity?: number;
  windSpeed?: number;
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

// The host's TEXT_OPACITY steps, so secondary text fades the same way.
const SECONDARY = 0.6;
const DIM = 0.45;

// ── Helpers ────────────────────────────────────────────────────────────

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function deg(value: number | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? `${Math.round(value)}\u00B0` : '\u2013';
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

function dayLabel(date: string, index: number, short = false): string {
  if (index === 0) return 'Today';
  if (index === 1 && short) return 'Tmrw';
  // A calendar date, not an instant: read it at noon UTC and format in UTC
  // so it never slips to the neighbouring day.
  const d = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return date;
  return new Intl.DateTimeFormat(undefined, { weekday: 'short', timeZone: 'UTC' }).format(d);
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

// ── Component ──────────────────────────────────────────────────────────

export default function OutlinedWeather(props: PluginComponentProps) {
  const { config, style } = props;
  const p = props as PluginComponentProps & { timeFormat?: string; weatherError?: unknown };

  const view = (config.view as string) || 'combined';
  const outlineColor = (config.outlineColor as string) || '#000000';
  // Scale the outline with the Text size slider (authored against 24px).
  const scale = num(style.fontSize, BASE_FONT) / BASE_FONT;
  const outlineWidth = Math.max(0, num(config.outlineWidth, 3)) * scale;
  const outlineIcons = config.outlineIcons !== false;
  const softShadow = config.softShadow !== false;
  const hourCount = Math.round(num(config.hourCount, 6));
  const dayCount = Math.round(num(config.dayCount, 5));
  const showDescription = config.showDescription !== false;
  const showHighLow = config.showHighLow !== false;
  const showFeelsLike = config.showFeelsLike !== false;
  const showPrecip = config.showPrecip !== false;

  const hourly = (Array.isArray(props.hourly) ? props.hourly : []) as HourlyWeather[];
  const forecast = (Array.isArray(props.forecast) ? props.forecast : []) as ForecastDay[];

  const iconFilter = outlineIcons ? iconOutline(outlineColor, outlineWidth, softShadow) : undefined;

  const root: CSSProperties = {
    ...hostFrameStyle(style, { baseFontSize: BASE_FONT }),
    ...textOutline(outlineColor, outlineWidth, softShadow),
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.6em',
    lineHeight: 1.15,
  };

  const colorIcons = config.iconStyle !== 'line';
  const showHumidity = config.showHumidity !== false;
  const showWind = config.showWind !== false;
  const windUnit = props.units === 'metric' ? 'km/h' : 'mph';

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

  const Precip = ({ value }: { value?: number }) =>
    showPrecip && typeof value === 'number' && value > 0 ? (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.15em', fontSize: '0.8em' }}>
        <Droplets size="0.9em" strokeWidth={2} style={{ filter: iconFilter, overflow: 'visible' }} aria-hidden="true" />
        {Math.round(value)}%
      </span>
    ) : null;

  /** A small dimmed reading with a line icon, like the host's WeatherStat.
   *  Unlike Precip it shows 0 too, as the host's combined view does. */
  const Stat = ({ icon: StatIcon, value, unit, show, size = '0.7em' }: {
    icon: IconComponent; value?: number; unit?: string; show: boolean; size?: string;
  }) =>
    show && typeof value === 'number' && Number.isFinite(value) ? (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.15em', fontSize: size, opacity: DIM, whiteSpace: 'nowrap' }}>
        <StatIcon size="1em" strokeWidth={2} style={{ filter: iconFilter, overflow: 'visible' }} aria-hidden="true" />
        {Math.round(value)}{unit}
      </span>
    ) : null;

  // ── Empty / error states ──
  if (p.locationMissing) {
    return <div style={root}><span style={{ fontSize: '0.9em' }}>Set your location in Settings &gt; Location &amp; language</span></div>;
  }
  if (hourly.length === 0 && forecast.length === 0) {
    return <div style={root}><span style={{ fontSize: '0.9em' }}>{p.weatherError ? 'Weather unavailable' : 'Loading weather…'}</span></div>;
  }

  const current = hourly[0];
  const today = forecast[0];

  if (view === 'combined') {
    return <div style={{ ...root, alignItems: 'stretch', justifyContent: 'flex-start', gap: 0 }}>{combined()}</div>;
  }

  const currentBlock = current ? (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.2em' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.35em' }}>
        <Icon id={current.icon} size="3.2em" />
        <span style={{ fontSize: '4em', fontWeight: 600, lineHeight: 1 }}>
          {deg(current.temp)}
        </span>
      </div>
      {showDescription && current.description && (
        <div style={{ fontSize: '1em', textTransform: 'capitalize' }}>{current.description}</div>
      )}
      <div style={{ display: 'flex', gap: '0.8em', fontSize: '0.85em', flexWrap: 'wrap', justifyContent: 'center' }}>
        {showHighLow && today && <span>H {deg(today.high)}{' · '}L {deg(today.low)}</span>}
        {showFeelsLike && current.feelsLike != null && <span>Feels {deg(current.feelsLike)}</span>}
        <Precip value={current.precipProbability ?? today?.precipProbability} />
      </div>
    </div>
  ) : null;

  const columns = (items: React.ReactNode[]) => (
    <div style={{ display: 'flex', width: '100%', justifyContent: 'space-around', gap: '0.4em' }}>
      {items}
    </div>
  );

  const hourlyBlock = columns(
    hourly.slice(0, hourCount).map((h) => (
      <div key={h.time} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.25em', minWidth: 0 }}>
        <span style={{ fontSize: '0.8em' }}>{hourLabel(h.time, props.timezone, p.timeFormat)}</span>
        <Icon id={h.icon} size="1.6em" />
        <span style={{ fontWeight: 600 }}>{deg(h.temp)}</span>
        <Precip value={h.precipProbability} />
      </div>
    )),
  );

  const dailyBlock = columns(
    forecast.slice(0, dayCount).map((d, i) => (
      <div key={d.date} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.25em', minWidth: 0 }}>
        <span style={{ fontSize: '0.8em' }}>{dayLabel(d.date, i)}</span>
        <Icon id={d.icon} size="1.6em" />
        <span style={{ fontWeight: 600 }}>{deg(d.high)}</span>
        <span style={{ fontSize: '0.8em' }}>{deg(d.low)}</span>
        <Precip value={d.precipProbability} />
      </div>
    )),
  );

  return (
    <div style={root}>
      {view === 'current' && currentBlock}
      {view === 'hourly' && hourlyBlock}
      {view === 'daily' && forecast.length > 0 && dailyBlock}
    </div>
  );

  /** The host weather module's "combined" view: current conditions, a strip
   *  of the next hours, then one row per day, in 25% / 25% / 50% bands
   *  (mirrors the host's WeatherCombinedView). */
  function combined() {
    const hours = hourly.slice(1, hourCount + 1);
    const days = forecast.slice(0, dayCount);
    const rule = <div style={{ width: '100%', height: 1, flexShrink: 0, background: 'currentColor', opacity: 0.2 }} />;

    return (
      <>
        {current && (
          <div style={{ flex: '0 0 25%', display: 'flex', alignItems: 'center', gap: '0.65em', minHeight: 0 }}>
            <Icon id={current.icon} size="2.5em" />
            <span style={{ fontSize: '3em', fontWeight: 300, lineHeight: 1 }}>{deg(current.temp)}</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.1em', minWidth: 0 }}>
              {showHighLow && today && (
                <span style={{ fontSize: '0.8em', opacity: SECONDARY }}>H:{deg(today.high)} L:{deg(today.low)}</span>
              )}
              {showFeelsLike && current.feelsLike != null && (
                <span style={{ fontSize: '0.75em', opacity: DIM }}>Feels like {deg(current.feelsLike)}</span>
              )}
              {showDescription && current.description && (
                <span style={{ fontSize: '0.75em', opacity: DIM, textTransform: 'capitalize' }}>{current.description}</span>
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5em', flexWrap: 'wrap' }}>
                <Stat icon={CloudRain} value={current.precipProbability} unit="%" show={showPrecip} size="0.75em" />
                <Stat icon={Droplets} value={current.humidity} unit="%" show={showHumidity} size="0.75em" />
                <Stat icon={Wind} value={current.windSpeed} show={showWind} size="0.75em" />
              </div>
            </div>
          </div>
        )}

        {hours.length > 0 && (
          <div style={{ flex: '0 0 25%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            {rule}
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-around' }}>
              {hours.map((h) => (
                <div key={h.time} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.1em', minWidth: 0 }}>
                  <span style={{ fontSize: '0.65em', opacity: DIM }}>{hourLabel(h.time, props.timezone, p.timeFormat)}</span>
                  <Icon id={h.icon} size="1.4em" />
                  <span style={{ fontSize: '0.75em', fontWeight: 500 }}>{deg(h.temp)}</span>
                  <Stat icon={CloudRain} value={h.precipProbability} unit="%" show={showPrecip} />
                </div>
              ))}
            </div>
          </div>
        )}

        {days.length > 0 && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            {rule}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-evenly', padding: '0.25em 0', minHeight: 0 }}>
              {days.map((d, i) => (
                <div key={d.date} style={{ display: 'flex', alignItems: 'center', gap: '0.75em', fontSize: '0.85em' }}>
                  <span style={{ width: '3.5em', textAlign: 'right', fontSize: '0.85em', opacity: SECONDARY, flexShrink: 0 }}>{dayLabel(d.date, i, true)}</span>
                  <Icon id={d.icon} size="1.4em" />
                  <Stat icon={CloudRain} value={d.precipProbability} unit="%" show={showPrecip} />
                  {showHighLow && (
                    <div style={{ display: 'flex', gap: '0.25em', marginLeft: 'auto' }}>
                      <span style={{ fontWeight: 500 }}>{deg(d.high)}</span>
                      <span style={{ opacity: DIM }}>{deg(d.low)}</span>
                    </div>
                  )}
                  <span style={showHighLow ? undefined : { marginLeft: 'auto' }}>
                    <Stat icon={Wind} value={d.windSpeed} unit={` ${windUnit}`} show={showWind} />
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </>
    );
  }
}
