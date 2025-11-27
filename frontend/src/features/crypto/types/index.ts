import type { CryptoWallet } from '@shared/types';

export type WalletType = 'ethereum' | 'bitcoin';

export interface WalletFormData {
  type: WalletType;
  address: string;
}

export interface CryptoPrice {
  [symbol: string]: {
    usd: number;
  };
}

export interface TokenPrices {
  [address: string]: number;
}

// Component Props
export interface WalletFormProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => void;
  formData: WalletFormData;
  onTypeChange: (type: WalletType) => void;
  onAddressChange: (address: string) => void;
  submitting: boolean;
}

export interface WalletCardProps {
  wallet: CryptoWallet;
  cryptoPrices: CryptoPrice;
  tokenPrices: TokenPrices;
  onUpdateBalance: (id: string) => void;
  onDelete: (id: string) => void;
  isUpdating: boolean;
  isDeleting: boolean;
}
