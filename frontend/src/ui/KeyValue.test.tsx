import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { KeyValue, KeyValueRow } from './KeyValue';

afterEach(cleanup);

describe('KeyValue', () => {
  it('is a description list whose every term is followed by its own value', () => {
    const { container } = render(
      <KeyValue label="Details">
        <KeyValueRow term="Last sync">2 min ago</KeyValueRow>
        <KeyValueRow term="Price">Unknown</KeyValueRow>
      </KeyValue>,
    );
    const list = container.querySelector('dl');
    expect(list).toHaveClass('ui-kv');
    expect(list).toHaveAttribute('aria-label', 'Details');
    expect(
      Array.from(list?.children ?? [], (node) => `${node.tagName}:${node.textContent}`),
    ).toEqual(['DT:Last sync', 'DD:2 min ago', 'DT:Price', 'DD:Unknown']);
    // The e2e locator `dt[.="Last sync"]/following-sibling::dd[1]` finds the value.
    expect(screen.getByText('Last sync').nextElementSibling).toHaveTextContent('2 min ago');
    // A missing value is shown as the caller wrote it, never turned into 0.
    expect(screen.getByText('Price').nextElementSibling).toHaveTextContent('Unknown');
  });

  it('the panel variant is tinted; extra classes are kept', () => {
    const { container } = render(
      <KeyValue variant="panel" className="extra">
        <KeyValueRow term="Cost">$1,200</KeyValueRow>
      </KeyValue>,
    );
    expect(container.querySelector('dl')).toHaveClass('ui-kv', 'ui-kv--panel', 'extra');
  });
});
