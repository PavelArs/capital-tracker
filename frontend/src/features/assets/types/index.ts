import type { Asset, Currency } from '@shared/types';

export type AssetTab = 'stock' | 'flow' | 'overview';
export type ViewMode = 'single' | 'all';
export type GroupBy = 'name' | 'category';
export type IncomeType = 'active' | 'passive' | '';

export interface AssetFormData {
  name: string;
  assetType: string;
  category: string;
  incomeType: IncomeType;
  amount: string;
  currencyId: string;
  date: string;
  description: string;
}

export interface TotalAmount {
  stock: { currency: string; amount: number }[];
  flow: { currency: string; amount: number }[];
}

export interface ExchangeRateCache {
  [key: string]: { rate: number; timestamp: number };
}

export interface AssetChartData {
  labels: string[];
  datasets: {
    data: number[];
    backgroundColor: string[];
  }[];
  _originalTotals: Record<string, number>;
  _usdTotals: Record<string, number>;
  _totalUSD: number;
  _keys: string[];
}

export interface CategoryOption {
  value: string;
  labelKey: string;
}

// Component Props
export interface AssetFormProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => void;
  formData: AssetFormData;
  setFormData: React.Dispatch<React.SetStateAction<AssetFormData>>;
  currencies: Currency[];
  editingId: string | null;
  submitting: boolean;
}

export interface AssetCardProps {
  asset: Asset;
  onEdit: (asset: Asset) => void;
  onDelete: (id: string) => void;
  isDeleting: boolean;
}
