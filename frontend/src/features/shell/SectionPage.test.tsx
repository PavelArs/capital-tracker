import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SummaryCard from '@/ui/SummaryCard';
import SectionPage, { SectionAction, SectionGrid } from './SectionPage';

afterEach(cleanup);

const renderPage = (onAdd = vi.fn()) =>
  render(
    <MemoryRouter>
      <SectionPage
        title="Things"
        intro="What this page holds."
        action={<SectionAction onClick={onAdd}>Add thing</SectionAction>}
        notice={<p role="status">Saved.</p>}
        summary={
          <SummaryCard label="Total in things" figures={[{ label: 'In things', value: '$1.00' }]} />
        }
        footnote={<p>Estimates, not promises.</p>}
      >
        <SectionGrid>
          <li>First thing</li>
        </SectionGrid>
      </SectionPage>
    </MemoryRouter>,
  );

describe('SECTION-LAYOUT: one frame for the section pages', () => {
  it('SECTION-LAYOUT-ACTION keeps the main action in the intro line, never in the page header', async () => {
    const onAdd = vi.fn();
    renderPage(onAdd);
    const add = screen.getByRole('button', { name: 'Add thing' });
    expect(add.closest('.ui-intro')).toHaveTextContent('What this page holds.');
    expect(
      within(screen.getByRole('banner')).queryByRole('button', { name: 'Add thing' }),
    ).toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: 'Things' })).toBeInTheDocument();
    await userEvent.click(add);
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it('SECTION-LAYOUT-ACTION-STYLE draws the main action as the primary button with a plus', () => {
    renderPage();
    const add = screen.getByRole('button', { name: 'Add thing' });
    expect(add).toHaveClass('shell-button', 'shell-button--primary');
    expect(add.querySelector('svg')).not.toBeNull();
  });

  it('SECTION-LAYOUT-ORDER shows header, intro, notice, totals, cards and the footnote in that order', () => {
    renderPage();
    const parts = [
      screen.getByRole('heading', { level: 1 }),
      screen.getByText('What this page holds.'),
      screen.getByRole('status'),
      screen.getByRole('region', { name: 'Total in things' }),
      screen.getByText('First thing'),
      screen.getByText('Estimates, not promises.'),
    ];
    parts.slice(1).forEach((part, index) => {
      expect(
        parts[index].compareDocumentPosition(part) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });
  });

  it('SECTION-LAYOUT-GRID lists the cards in a grid list', () => {
    renderPage();
    expect(screen.getByRole('list')).toHaveClass('section-grid');
  });
});
