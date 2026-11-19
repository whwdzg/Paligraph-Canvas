import type { ReactNode } from 'react';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: ReactNode;
}

interface SegmentedProps<T extends string> {
  value: T;
  options: readonly SegmentedOption<T>[];
  onChange: (value: T) => void;
  ariaLabel: string;
  compact?: boolean;
}

/** Fluent pill selector used for themes, line style and highlighter modes. */
export function Segmented<T extends string>({ value, options, onChange, ariaLabel, compact }: SegmentedProps<T>) {
  return (
    <div className={`segmented ${compact ? 'is-compact' : ''}`.trim()} role="radiogroup" aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          className={`segment ${value === option.value ? 'is-selected' : ''}`.trim()}
          onClick={() => onChange(option.value)}
        >
          {option.icon}
          <span>{option.label}</span>
        </button>
      ))}
    </div>
  );
}
