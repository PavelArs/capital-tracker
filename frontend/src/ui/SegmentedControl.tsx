import type { ReactNode } from 'react';
import './segmented.css';

/** A value shown as itself, or a value with its own label. */
export type Segment<T extends string> = T | readonly [value: T, label: ReactNode];

/** A row of mutually exclusive choices drawn as one pill; native radios underneath. */
export function SegmentedControl<T extends string>({
  name,
  options,
  value,
  onChange,
  label,
  labelledBy,
  describedBy,
  id,
  disabled = false,
  isChecked,
}: {
  name: string;
  options: readonly Segment<T>[];
  value: T | null;
  onChange: (value: T) => void;
  label?: string;
  labelledBy?: string;
  describedBy?: string;
  id?: string;
  disabled?: boolean | ((value: T) => boolean);
  /** When one segment stands for several values, says whether it is the chosen one. */
  isChecked?: (option: T) => boolean;
}) {
  return (
    <div
      id={id}
      className="ui-seg"
      role="radiogroup"
      aria-label={label}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
    >
      {options.map((segment) => {
        const [option, text] = typeof segment === 'string' ? [segment, segment] : segment;
        return (
          <label key={option}>
            <input
              type="radio"
              name={name}
              value={option}
              checked={isChecked ? isChecked(option) : value === option}
              disabled={typeof disabled === 'function' ? disabled(option) : disabled}
              onChange={() => onChange(option)}
            />
            {text}
          </label>
        );
      })}
    </div>
  );
}

/** Holds a segmented control's room while its value is still loading, so nothing next to it moves. */
export function SegmentedPlaceholder({ labels }: { labels: readonly string[] }) {
  return (
    <div className="ui-seg ui-seg--hold" aria-hidden="true">
      {labels.map((text) => (
        <label key={text}>{text}</label>
      ))}
    </div>
  );
}
