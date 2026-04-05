import type { Currency, Liability } from '@shared/types';

export type FrequencyType = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly' | '';

export interface LiabilityFormData {
  name: string;
  category: string;
  amount: string;
  currencyId: string;
  date: string;
  description: string;
  frequency: FrequencyType;
  deadline: string;
}

export interface CategoryOption {
  value: string;
  labelKey: string;
}

// Component Props
export interface LiabilityFormProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => void;
  formData: LiabilityFormData;
  setFormData: React.Dispatch<React.SetStateAction<LiabilityFormData>>;
  currencies: Currency[];
  editingId: string | null;
  submitting: boolean;
}

export interface LiabilityCardProps {
  liability: Liability;
  onEdit: (liability: Liability) => void;
  onDelete: (id: string) => void;
  isDeleting: boolean;
}
