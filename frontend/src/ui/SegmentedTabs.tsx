import type { HTMLAttributes, ReactElement } from 'react';
import type { Segment } from './SegmentedControl';
import { useTabs } from './tabs';
import './segmented.css';

/**
 * Tabs drawn as the segmented pill (prototype period and allocation tabs): a `tablist` of
 * `tab`s with `aria-selected`, the WAI-ARIA keyboard of useTabs (arrows, Home, End), and the
 * props of the one panel they control. Use it for views of the same content (24H … ALL,
 * Assets | Classes | Accounts); a value that changes data elsewhere is a SegmentedControl.
 */
export function useSegmentedTabs<T extends string>({
  label,
  options,
  value,
  onChange,
  size = 'md',
}: {
  /** Names the tab list: "Period", "Allocation". */
  label: string;
  options: readonly Segment<T>[];
  value: T;
  onChange: (value: T) => void;
  size?: 'md' | 'sm';
}): { tabs: ReactElement; panelProps: HTMLAttributes<HTMLElement> } {
  const pairs = options.map((segment) =>
    typeof segment === 'string' ? ([segment, segment] as const) : segment,
  );
  const { list, tab, panel } = useTabs(
    pairs.map(([option]) => option),
    value,
    onChange,
  );
  const tabs = (
    <div {...list} aria-label={label} className={size === 'sm' ? 'ui-seg ui-seg--sm' : 'ui-seg'}>
      {pairs.map(([option, text]) => (
        <button key={option} type="button" {...tab(option)}>
          {text}
        </button>
      ))}
    </div>
  );
  return { tabs, panelProps: panel };
}
