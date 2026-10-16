import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Banner, type BannerTone } from './Banner';
import { Button } from './Button';

afterEach(cleanup);

describe('Banner', () => {
  it.each<[BannerTone, string]>([
    ['neg', 'alert'],
    ['pos', 'status'],
    ['info', 'note'],
    ['warn', 'note'],
    ['neutral', 'note'],
  ])('a %s banner is a %s by default', (tone, role) => {
    render(<Banner tone={tone}>Prices are from 12 March.</Banner>);
    const banner = screen.getByRole(role);
    expect(banner).toHaveTextContent('Prices are from 12 March.');
    // The old class names stay: tests and feature CSS still find banners by them.
    expect(banner).toHaveClass('ui-banner', `ui-banner--${tone}`);
  });

  it('takes the role the caller asks for, or none inside another live region', () => {
    const { rerender } = render(
      <Banner tone="warn" role="alert">
        Could not refresh.
      </Banner>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Could not refresh.');
    rerender(
      <Banner tone="neg" role="none">
        Inside a status line.
      </Banner>,
    );
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('Inside a status line.').closest('.ui-banner')).not.toHaveAttribute(
      'role',
    );
  });

  it('shows the tone icon hidden from screen readers, a chosen icon, or none', () => {
    const { container, rerender } = render(<Banner tone="info">Guidance.</Banner>);
    const icon = container.querySelector('svg');
    expect(icon).toHaveAttribute('aria-hidden', 'true');
    expect(icon).toHaveClass('ui-banner__icon');
    rerender(<Banner tone="neutral">Offline.</Banner>);
    expect(container.querySelector('svg')).toBeNull();
    rerender(
      <Banner tone="info" icon={false}>
        No icon.
      </Banner>,
    );
    expect(container.querySelector('svg')).toBeNull();
    rerender(
      <Banner tone="neutral" icon="wifi">
        Offline.
      </Banner>,
    );
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('reads the title, the text and the action in that order, with the id given', () => {
    render(
      <Banner
        tone="warn"
        id="stale"
        title="Showing saved data."
        action={<Button size="sm">Try again</Button>}
      >
        The last refresh failed.
      </Banner>,
    );
    const banner = screen.getByRole('note');
    expect(banner).toHaveAttribute('id', 'stale');
    expect(banner).toHaveTextContent('Showing saved data.The last refresh failed.Try again');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});
