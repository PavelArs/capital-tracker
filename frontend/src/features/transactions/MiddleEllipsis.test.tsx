import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import MiddleEllipsis from './MiddleEllipsis';

describe('TX-LONG-VALUES middle ellipsis', () => {
  it('keeps the whole value in the text and the tooltip, split only for the layout', () => {
    const address = `0x${'a'.repeat(38)}8F32`;
    const { container } = render(<MiddleEllipsis text={address} />);
    expect(container).toHaveTextContent(address);
    expect(screen.getByTitle(address)).toBeInTheDocument();
    expect(container.querySelector('.transactions-mid__tail')).toHaveTextContent(address.slice(-6));
  });

  it('leaves a short value alone', () => {
    const { container } = render(<MiddleEllipsis text="Savings" />);
    expect(container).toHaveTextContent('Savings');
    expect(container.querySelector('.transactions-mid')).toBeNull();
  });
});
