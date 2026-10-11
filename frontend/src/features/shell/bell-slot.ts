import { createContext } from 'react';

/**
 * On a phone the top bar (Layout) holds the notifications bell next to the owner. The bell
 * needs the attention data that only the pages see, so each page header draws it into this
 * slot instead of its own row. Null outside the shell.
 */
export const BellSlotContext = createContext<HTMLElement | null>(null);
