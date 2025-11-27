import type { WalletFormData } from '../types';

export const WALLET_TYPES = [
  { value: 'ethereum', label: 'Ethereum' },
  { value: 'bitcoin', label: 'Bitcoin' },
] as const;

export const ADDRESS_PLACEHOLDERS = {
  ethereum: '0x...',
  bitcoin: 'bc1... or 1... or 3...',
} as const;

export const getInitialFormData = (): WalletFormData => ({
  type: 'ethereum',
  address: '',
});
