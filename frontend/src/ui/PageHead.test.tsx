import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { Button } from './Button';
import { Crumb, PageHead } from './PageHead';

afterEach(cleanup);

describe('Crumb and PageHead', () => {
  it('the crumb is a link back named "Back to <parent>"', () => {
    render(
      <MemoryRouter>
        <Crumb to="/portfolio">Portfolio</Crumb>
      </MemoryRouter>,
    );
    const link = screen.getByRole('link', { name: 'Back to Portfolio' });
    expect(link).toHaveAttribute('href', '/portfolio');
    expect(link).toHaveTextContent('Portfolio');
    expect(link.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('the head is an h2 with its id, the subtitle, the aside and the actions', () => {
    render(
      <PageHead
        icon={<span>B</span>}
        title="Bitcoin"
        titleId="asset-title"
        subtitle="BTC · Crypto"
        aside={<p>$64,000.00</p>}
        actions={<Button>Hide asset</Button>}
      />,
    );
    const heading = screen.getByRole('heading', { level: 2, name: 'Bitcoin' });
    expect(heading).toHaveAttribute('id', 'asset-title');
    expect(screen.getByText('BTC · Crypto')).toHaveClass('ui-page-head__sub');
    expect(screen.getByText('$64,000.00')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hide asset' })).toBeInTheDocument();
    expect(screen.getByText('B').parentElement).toHaveAttribute('aria-hidden', 'true');
  });
});
