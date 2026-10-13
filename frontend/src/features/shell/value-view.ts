import { storedChoice } from './stored-choice';

/** Values as counted, or in today's money after inflation. */
export type ValueView = 'nominal' | 'real';

const choice = storedChoice<ValueView>('value-view', 'nominal', 'real');

export const setValueView = choice.set;

/** The saved choice, nominal until the owner switches; saved in this browser. */
export const useValueView = choice.use;
