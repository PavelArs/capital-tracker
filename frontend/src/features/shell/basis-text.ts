// Which rate a real figure rests on, said beside that figure only.
export function basisText(
  basis: 'official' | 'personal',
  real: { estimated: boolean; ownRate?: boolean },
  currency: string,
): string {
  if (basis === 'personal' && real.ownRate !== false) return 'at your own rate';
  const estimated = real.estimated ? ', latest months estimated' : '';
  return basis === 'official'
    ? `at the official rate${estimated}`
    : `no rate of your own for ${currency}, so the official one${estimated}`;
}
