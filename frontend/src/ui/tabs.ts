import { type KeyboardEvent, useId } from 'react';

const moves: Record<string, (at: number, last: number) => number> = {
  ArrowRight: (at, last) => (at >= last ? 0 : at + 1),
  ArrowLeft: (at, last) => (at <= 0 ? last : at - 1),
  Home: () => 0,
  End: (_at, last) => last,
};

/**
 * A row of tabs that follows the WAI-ARIA tabs pattern. The chosen tab is the row's one tab stop;
 * ArrowLeft and ArrowRight move to the previous or next tab (round the ends), Home and End to the
 * first and the last, and a tab is chosen as it gets the focus. Every tab controls the one panel,
 * which the chosen tab names. Spread `list` on the tablist, `tab(value)` on each tab and `panel`
 * on what the tabs show.
 */
export function useTabs<T extends string>(
  values: readonly T[],
  selected: T,
  onSelect: (value: T) => void,
) {
  const id = useId();
  const tabId = (value: T) => `${id}-tab-${value}`;
  const panelId = `${id}-panel`;
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const move = moves[event.key];
    if (!move || values.length === 0) return;
    event.preventDefault();
    const next = values[move(values.indexOf(selected), values.length - 1)];
    onSelect(next);
    document.getElementById(tabId(next))?.focus();
  };
  return {
    list: { role: 'tablist' as const, onKeyDown },
    tab: (value: T) => ({
      role: 'tab' as const,
      id: tabId(value),
      'aria-selected': value === selected,
      'aria-controls': panelId,
      tabIndex: value === selected ? 0 : -1,
      onClick: () => onSelect(value),
    }),
    panel: { role: 'tabpanel' as const, id: panelId, 'aria-labelledby': tabId(selected) },
  };
}
