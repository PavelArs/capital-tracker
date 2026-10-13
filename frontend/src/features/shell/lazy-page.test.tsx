import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Suspense } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { lazyPage } from './lazy-page';
import PageLoadBoundary from './PageLoadBoundary';

const Screen = () => <p>Screen is here</p>;

function open(load: () => Promise<{ default: typeof Screen }>) {
  const Page = lazyPage(load);
  render(
    <MemoryRouter>
      <PageLoadBoundary>
        <Suspense fallback={<p>Loading</p>}>
          <Page />
        </Suspense>
      </PageLoadBoundary>
    </MemoryRouter>,
  );
  return Page;
}

describe('lazyPage', () => {
  it('shows the screen once its file has arrived', async () => {
    open(() => Promise.resolve({ default: Screen }));
    expect(await screen.findByText('Screen is here')).toBeInTheDocument();
  });

  it('says so when the file does not arrive and asks again on Try again', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const load = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ default: Screen });
    open(load);
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be loaded');
    // The failure is shown, not asked about again until the owner says so.
    expect(load).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Screen is here')).toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('asks again for a file that failed when it is fetched ahead later', async () => {
    const load = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ default: Screen });
    const Page = lazyPage(load);
    await expect(Page.preload()).rejects.toThrow('offline');
    await expect(Page.preload()).resolves.toMatchObject({ default: Screen });
    expect(load).toHaveBeenCalledTimes(2);
  });
});
