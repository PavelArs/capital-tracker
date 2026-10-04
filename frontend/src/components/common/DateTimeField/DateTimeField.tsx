import { useRef, useState } from 'react';
import { combine, datePart, fullTime, timePart, timeStep, utcTimeOfDay } from './date-time';
import './DateTimeField.css';

/**
 * A calendar date with an optional UTC time. `value` and `onChange` use the
 * canonical UTC instant string; a date without time means 00:00 UTC.
 */
export function DateTimeField({
  label,
  timeLabel,
  value,
  onChange,
  describedBy,
  required,
  disabled,
  labelClassName,
}: {
  label: string;
  /** Unique on the page, e.g. «Время сделки, UTC». */
  timeLabel: string;
  value: string;
  onChange: (value: string) => void;
  describedBy?: string;
  required?: boolean;
  disabled?: boolean;
  labelClassName?: string;
}) {
  const date = datePart(value);
  const exactTime = utcTimeOfDay(value);
  // Native time inputs report every segment edit; keep the owner's own text while it
  // still means the current value, so 00:00 or :00 seconds do not vanish mid-edit.
  const [typed, setTyped] = useState<string | null>(null);
  const time = typed !== null && date && fullTime(typed) === exactTime ? typed : timePart(value);
  // The time to restore only when the owner clears and re-enters the date themselves.
  const clearedTime = useRef<string | null>(null);
  if (value) clearedTime.current = null;
  return (
    <div className="date-time-field">
      <label className={labelClassName}>
        <span>{label}</span>
        <input
          type="date"
          aria-describedby={describedBy}
          value={date}
          required={required}
          disabled={disabled}
          onChange={(event) => {
            const next = event.target.value;
            const keep = exactTime || clearedTime.current || '';
            clearedTime.current = next ? null : keep;
            onChange(combine(next, keep));
          }}
        />
      </label>
      <label className={labelClassName}>
        <span>{timeLabel}</span>
        <input
          type="time"
          aria-describedby={describedBy}
          value={time}
          step={timeStep(time)}
          disabled={disabled || !date}
          onChange={(event) => {
            setTyped(event.target.value);
            onChange(combine(date, event.target.value ? fullTime(event.target.value) : ''));
          }}
        />
      </label>
    </div>
  );
}
