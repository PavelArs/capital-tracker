import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import SummaryCard from './SummaryCard';

afterEach(cleanup);

describe('SECTION-SUMMARY: the totals card of a section page', () => {
  it('SECTION-SUMMARY-FIGURES shows each figure as a label and its value, side by side in one card', () => {
    render(
      <SummaryCard
        label="Total in things"
        figures={[
          { label: 'In things', value: '$10.00' },
          { label: 'Share of net worth', value: '12.5%' },
        ]}
      />,
    );
    const card = screen.getByRole('region', { name: 'Total in things' });
    const terms = within(card).getAllByRole('term');
    expect(terms.map((term) => term.textContent)).toEqual(['In things', 'Share of net worth']);
    expect(card).toHaveTextContent('In things$10.00Share of net worth12.5%');
  });

  it('SECTION-SUMMARY-REASON puts a figure’s reason under that figure and the card’s note last', () => {
    render(
      <SummaryCard
        label="Total in things"
        figures={[
          { label: 'In things', value: '$10.00' },
          { label: 'Share of net worth', value: '—', note: 'Net worth unknown.' },
        ]}
        note="1 thing without a price left out."
      />,
    );
    expect(screen.getByRole('region', { name: 'Total in things' })).toHaveTextContent(
      'In things$10.00Share of net worth—Net worth unknown.1 thing without a price left out.',
    );
  });
});
