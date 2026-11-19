import type { CSSProperties } from 'react';

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  display?: string;
  accent?: string;
}

/** Accessible range input with a filled track that follows the current value. */
export function Slider({ label, value, min, max, step = 0.01, onChange, display, accent }: SliderProps) {
  const progress = ((value - min) / (max - min)) * 100;
  return (
    <label className="slider-field">
      <span className="slider-meta">
        <span>{label}</span>
        <span className="slider-value">{display ?? value}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        onChange={(event) => onChange(Number(event.target.value))}
        style={
          {
            '--slider-progress': `${progress}%`,
            '--slider-accent': accent,
          } as CSSProperties
        }
      />
    </label>
  );
}
