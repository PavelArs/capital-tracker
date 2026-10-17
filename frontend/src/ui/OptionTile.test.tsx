import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OptionGrid, OptionTile } from './OptionTile';

afterEach(cleanup);

describe('OptionGrid and OptionTile', () => {
  it('a compact grid is a named group of toggle buttons', async () => {
    const pick = vi.fn();
    render(
      <OptionGrid label="What is it?">
        <OptionTile pressed title="Buy" onClick={pick} />
        <OptionTile pressed={false} title="Reward" description="Staking, airdrop" onClick={pick} />
      </OptionGrid>,
    );
    const group = screen.getByRole('group', { name: 'What is it?' });
    expect(group).toHaveClass('ui-opt-grid');
    const buy = within(group).getByRole('button', { name: 'Buy' });
    expect(buy).toHaveAttribute('aria-pressed', 'true');
    expect(buy).toHaveAttribute('type', 'button');
    expect(buy).toHaveClass('ui-opt');
    const reward = within(group).getByRole('button', { name: /^Reward/ });
    expect(reward).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(reward);
    expect(pick).toHaveBeenCalledOnce();
  });

  it('a tile is named by its title first, then the description and "Suggested"', () => {
    render(
      <OptionGrid labelledBy="net" layout="tile">
        <span id="net">Network</span>
        <OptionTile
          pressed={false}
          icon={<span>SOL</span>}
          title="Solana"
          description="SOL and SPL tokens"
          suggested
          wide
          onClick={() => {}}
        />
      </OptionGrid>,
    );
    const group = screen.getByRole('group', { name: 'Network' });
    expect(group).toHaveClass('ui-tile-grid');
    const tile = within(group).getByRole('button', { name: /^Solana/ });
    expect(tile).toHaveAccessibleName('Solana SOL and SPL tokens Suggested');
    expect(tile).toHaveClass('ui-tile', 'ui-tile--wide');
    // The icon is decoration: the name does not start with it.
    expect(tile.querySelector('.ui-tile__icon')).toHaveAttribute('aria-hidden', 'true');
  });

  it('a disabled option cannot be chosen', async () => {
    const pick = vi.fn();
    render(
      <OptionGrid label="Kind">
        <OptionTile pressed={false} disabled title="Crypto" onClick={pick} />
      </OptionGrid>,
    );
    const option = screen.getByRole('button', { name: 'Crypto' });
    expect(option).toBeDisabled();
    await userEvent.click(option);
    expect(pick).not.toHaveBeenCalled();
  });
});
