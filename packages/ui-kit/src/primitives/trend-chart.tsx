import { useId, useState, type PointerEvent } from "react";

export interface TrendPoint {
  key: string;
  label: string;
  /** `null` is a missing or not-applicable value: it breaks the line and is never drawn as zero. */
  value: number | null;
  /** Shown in place of a value when `value` is null, e.g. "Not reported". */
  note?: string;
}

export type TrendTarget =
  | { kind: "value"; value: number; label: string }
  | { kind: "range"; low: number; high: number; label: string };

export interface TrendChartProps {
  title: string;
  unit: string;
  points: readonly TrendPoint[];
  target?: TrendTarget | null;
  /** Plain-language description of what the chart shows, for assistive technology. */
  summary: string;
  formatValue?: (value: number) => string;
}

const defaultFormat = new Intl.NumberFormat("en", { maximumFractionDigits: 1 });

function niceStep(span: number) {
  const raw = span / 4;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const normalized = raw / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
}

/** A y-domain with clean tick values around the observed values and any target. */
function yScale(values: readonly number[]) {
  if (values.length === 0) return { min: 0, max: 1, ticks: [0, 1] };
  let low = Math.min(...values);
  let high = Math.max(...values);
  if (low === high) {
    low -= Math.abs(low) * 0.1 || 1;
    high += Math.abs(high) * 0.1 || 1;
  }
  const step = niceStep(high - low);
  const min = Math.floor(low / step) * step;
  const max = Math.ceil(high / step) * step;
  const ticks: number[] = [];
  for (let tick = min; tick <= max + step / 2; tick += step) ticks.push(Number(tick.toPrecision(12)));
  return { min, max, ticks };
}

/**
 * A single-series trend line (dataviz: one hue, no legend box, endpoint
 * label only, recessive solid grid, crosshair + tooltip on hover and focus).
 * Values are HTML-positioned over a stretched SVG so text and dots keep their
 * size at every width. Missing values leave a gap and an explicit marker.
 */
export function TrendChart({ title, unit, points, target = null, summary, formatValue }: TrendChartProps) {
  const id = useId();
  const [active, setActive] = useState<number | null>(null);
  const format = (value: number) => (formatValue ? formatValue(value) : defaultFormat.format(value));

  const targetValues = !target ? [] : target.kind === "value" ? [target.value] : [target.low, target.high];
  const available = points.flatMap((point) => (point.value === null ? [] : [point.value]));
  const scale = yScale([...available, ...targetValues]);
  const span = scale.max - scale.min || 1;
  const x = (index: number) => (points.length <= 1 ? 50 : (index / (points.length - 1)) * 100);
  const y = (value: number) => 100 - ((value - scale.min) / span) * 100;

  const segments: string[] = [];
  let current: string[] = [];
  points.forEach((point, index) => {
    if (point.value === null) {
      if (current.length > 1) segments.push(current.join(" "));
      current = [];
      return;
    }
    current.push(`${x(index)},${y(point.value)}`);
  });
  if (current.length > 1) segments.push(current.join(" "));

  let lastIndex = -1;
  points.forEach((point, index) => {
    if (point.value !== null) lastIndex = index;
  });
  const activePoint = active === null ? null : points[active];
  const selected = active ?? Math.max(lastIndex, 0);
  const selectedPoint = points[selected];

  function pointFromPointer(event: PointerEvent<HTMLInputElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width === 0 || points.length === 0) return;
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    setActive(Math.round(ratio * (points.length - 1)));
  }

  const readout = (point: TrendPoint) =>
    point.value === null ? `${point.label}: ${point.note ?? "No value"}` : `${point.label}: ${format(point.value)} ${unit}`;

  return (
    <figure className="orbit-trend">
      <figcaption className="orbit-trend__caption">
        <span className="orbit-trend__title">{title}</span>
        <span className="orbit-trend__unit">{unit}</span>
      </figcaption>
      <p className="orbit-visually-hidden" id={`${id}-summary`}>
        {summary} Use the arrow keys to read each period.
      </p>
      <div className="orbit-trend__body">
        <div className="orbit-trend__y" aria-hidden="true">
          {scale.ticks.map((tick) => (
            <span key={tick} style={{ top: `${y(tick)}%` }}>{format(tick)}</span>
          ))}
        </div>
        <div className="orbit-trend__stage">
          <div className="orbit-trend__plot">
            <svg aria-hidden="true" className="orbit-trend__svg" preserveAspectRatio="none" viewBox="0 0 100 100">
              {scale.ticks.map((tick) => (
                <line key={tick} className="orbit-trend__grid" x1="0" x2="100" y1={y(tick)} y2={y(tick)} />
              ))}
              {target?.kind === "range" ? (
                <rect className="orbit-trend__target-band" x="0" width="100" y={y(target.high)} height={y(target.low) - y(target.high)} />
              ) : null}
              {target?.kind === "value" ? (
                <line className="orbit-trend__target" x1="0" x2="100" y1={y(target.value)} y2={y(target.value)} />
              ) : null}
              {points.map((point, index) =>
                point.value === null ? (
                  <line key={point.key} className="orbit-trend__gap" x1={x(index)} x2={x(index)} y1="0" y2="100" />
                ) : null,
              )}
              {segments.map((segment) => (
                <polyline key={segment} className="orbit-trend__line" points={segment} />
              ))}
              {active !== null ? <line className="orbit-trend__crosshair" x1={x(active)} x2={x(active)} y1="0" y2="100" /> : null}
            </svg>

            {target ? (
              <span
                aria-hidden="true"
                className="orbit-trend__target-label"
                style={{ top: `${y(target.kind === "value" ? target.value : target.high)}%` }}
              >
                {target.label}
              </span>
            ) : null}

            {points.map((point, index) =>
              point.value === null ? (
                <span key={point.key} aria-hidden="true" className="orbit-trend__gap-label" style={{ left: `${x(index)}%` }}>
                  {point.note ?? "No value"}
                </span>
              ) : (
                <span
                  key={point.key}
                  aria-hidden="true"
                  className="orbit-trend__dot"
                  data-active={active === index}
                  data-last={index === lastIndex}
                  style={{ left: `${x(index)}%`, top: `${y(point.value)}%` }}
                />
              ),
            )}

            {lastIndex >= 0 && points[lastIndex]?.value !== null && active === null ? (
              <span
                aria-hidden="true"
                className="orbit-trend__end-label"
                style={{ top: `${y(points[lastIndex]?.value ?? 0)}%` }}
              >
                {format(points[lastIndex]?.value ?? 0)}
              </span>
            ) : null}

            {activePoint && active !== null ? (
              <div
                aria-hidden="true"
                className="orbit-trend__tooltip"
                data-side={x(active) > 60 ? "left" : "right"}
                style={{ left: `${x(active)}%` }}
              >
                {activePoint.value === null ? (
                  <strong>{activePoint.note ?? "No value"}</strong>
                ) : (
                  <strong>{format(activePoint.value)}</strong>
                )}
                <span>{activePoint.label}</span>
              </div>
            ) : null}

            {points.length > 0 ? (
              <input
                aria-describedby={`${id}-summary`}
                aria-label={`${title}: period`}
                aria-valuetext={selectedPoint ? readout(selectedPoint) : undefined}
                className="orbit-trend__input"
                max={points.length - 1}
                min={0}
                onBlur={() => setActive(null)}
                onChange={(event) => setActive(Number(event.currentTarget.value))}
                onFocus={() => setActive(selected)}
                onPointerLeave={(event) => {
                  if (document.activeElement !== event.currentTarget) setActive(null);
                }}
                onPointerMove={pointFromPointer}
                step={1}
                type="range"
                value={selected}
              />
            ) : null}
          </div>
          <div className="orbit-trend__x" aria-hidden="true">
            {points.map((point, index) => (
              <span
                key={point.key}
                data-minor={(points.length - 1 - index) % 2 === 1}
                style={{ left: `${x(index)}%` }}
              >
                {point.label}
              </span>
            ))}
          </div>
        </div>
      </div>
    </figure>
  );
}
