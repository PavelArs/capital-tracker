import { storedChoice } from './stored-choice';

/** Which rate values after inflation use: the published index, or the owner's own yearly rate. */
export type InflationBasis = 'official' | 'personal';

const choice = storedChoice<InflationBasis>('inflation-basis', 'official', 'personal');

export const setInflationBasis = choice.set;

/** The saved choice, official until the owner picks their own rate; saved in this browser. */
export const useInflationBasis = choice.use;
