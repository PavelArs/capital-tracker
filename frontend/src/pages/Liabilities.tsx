import { currenciesApi, liabilitiesApi } from '@api';
import AssetsSkeleton from '@components/AssetsSkeleton';
import ErrorMessage from '@components/ErrorMessage';
import { PageHeader } from '@components/common';
import {
  LiabilityChart,
  LiabilityForm,
  LiabilityList,
  REGULAR_CATEGORIES,
  getInitialFormData,
} from '@features/liabilities';
import type { LiabilityFormData } from '@features/liabilities';
import { DEFAULT_CURRENCIES } from '@shared/constants/currencies';
import type { Currency, Liability } from '@shared/types';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import './Liabilities.css';

export default function Liabilities() {
  const { t } = useTranslation();
  const [liabilities, setLiabilities] = useState<Liability[]>([]);
  const [currencies, setCurrencies] = useState<Currency[]>(DEFAULT_CURRENCIES);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<LiabilityFormData>(getInitialFormData('1'));

  const fetchingRef = useRef(false);

  useEffect(() => {
    const fetchData = async () => {
      await Promise.all([fetchCurrencies(), fetchLiabilities()]);
    };
    fetchData();
  }, []);

  useEffect(() => {
    if (currencies.length > 0 && !formData.currencyId) {
      const usdCurrency = currencies.find((c) => c.code === 'USD');
      if (usdCurrency) {
        setFormData((prev) => ({ ...prev, currencyId: usdCurrency.id }));
      } else {
        setFormData((prev) => ({ ...prev, currencyId: currencies[0].id }));
      }
    }
  }, [currencies, formData.currencyId]);

  const fetchCurrencies = async () => {
    try {
      const data = await currenciesApi.getList();
      if (data && data.length > 0) {
        setCurrencies(data);
        setFormData((prev) => {
          const currentIsValid = data.some((c: Currency) => c.id === prev.currencyId);
          if (currentIsValid) return prev;
          const usdCurrency = data.find((c: Currency) => c.code === 'USD');
          return { ...prev, currencyId: usdCurrency?.id || data[0]?.id || '1' };
        });
      }
    } catch {
      console.warn('Could not load currencies from API, using defaults');
    }
  };

  const fetchLiabilities = useCallback(async () => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    try {
      setError(null);
      const data = await liabilitiesApi.getAll();
      setLiabilities(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : t('common.errorLoading');
      setError(message);
    } finally {
      setLoading(false);
      fetchingRef.current = false;
    }
  }, [t]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);

    try {
      let currencyIdToUse = formData.currencyId;
      if (!currencyIdToUse && currencies.length > 0) {
        const usdCurrency = currencies.find((c) => c.code === 'USD');
        currencyIdToUse = usdCurrency?.id || currencies[0]?.id || '';
      }

      const isRecurring = REGULAR_CATEGORIES.includes(formData.category);
      const payload = {
        name: formData.name,
        category: formData.category,
        liabilityType: isRecurring ? 'recurring' : 'one_time',
        amount: Number.parseFloat(formData.amount),
        currencyId: currencyIdToUse,
        date: formData.date,
        description: formData.description,
        frequency: isRecurring ? formData.frequency || 'monthly' : null,
        deadline: !isRecurring ? formData.deadline || null : null,
      } as const;

      if (editingId) {
        await liabilitiesApi.update(
          editingId,
          payload as Parameters<typeof liabilitiesApi.update>[1],
        );
      } else {
        await liabilitiesApi.create(payload as Parameters<typeof liabilitiesApi.create>[0]);
      }

      setShowForm(false);
      setEditingId(null);
      const usdCurrency = currencies.find((c) => c.code === 'USD');
      setFormData(getInitialFormData(usdCurrency?.id || currencies[0]?.id || ''));
      fetchLiabilities();
    } catch (err: unknown) {
      const errorMessage =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ||
        t('common.errorSaving');
      alert(errorMessage);
    } finally {
      setSubmitting(false);
    }
  };

  const handleEdit = useCallback(
    (liability: Liability) => {
      try {
        const availableCurrencies = currencies.length > 0 ? currencies : DEFAULT_CURRENCIES;
        setEditingId(liability.id);

        const liabilityCurrencyCode =
          typeof liability.currency === 'object' && liability.currency !== null
            ? (liability.currency as { code?: string }).code || 'USD'
            : String(liability.currency || 'USD');
        const liabilityCurrencyId =
          availableCurrencies.find((c) => c.code === liabilityCurrencyCode)?.id ||
          availableCurrencies.find((c) => c.code === 'USD')?.id ||
          availableCurrencies[0]?.id ||
          '';

        const category = liability.category || 'subscriptions';
        const isRegular = REGULAR_CATEGORIES.includes(category);
        const extLiability = liability as { frequency?: string; deadline?: string };

        setFormData({
          name: liability.name || '',
          category,
          amount: liability.amount?.toString() || '0',
          currencyId: liabilityCurrencyId,
          date: liability.date
            ? new Date(liability.date).toISOString().split('T')[0]
            : new Date().toISOString().split('T')[0],
          description: liability.description || '',
          frequency: isRegular
            ? (extLiability.frequency as LiabilityFormData['frequency']) || 'monthly'
            : '',
          deadline:
            !isRegular && extLiability.deadline
              ? new Date(extLiability.deadline).toISOString().split('T')[0]
              : '',
        });

        setShowForm(true);
      } catch (err) {
        alert(`Error editing liability: ${(err as Error).message}`);
      }
    },
    [currencies],
  );

  const handleCancel = useCallback(() => {
    setShowForm(false);
    setEditingId(null);
    const usdCurrency = currencies.find((c) => c.code === 'USD');
    setFormData(getInitialFormData(usdCurrency?.id || currencies[0]?.id || ''));
  }, [currencies]);

  const handleDelete = useCallback(
    async (id: string) => {
      if (window.confirm(t('liabilities.deleteConfirm'))) {
        setDeletingId(id);
        try {
          await liabilitiesApi.delete(id);
          fetchLiabilities();
        } catch (err: unknown) {
          const errorMessage =
            (err as { response?: { data?: { message?: string } } })?.response?.data?.message ||
            t('common.errorDeleting');
          alert(errorMessage);
        } finally {
          setDeletingId(null);
        }
      }
    },
    [fetchLiabilities, t],
  );

  const handleRetry = useCallback(() => {
    setLoading(true);
    setError(null);
    fetchLiabilities();
  }, [fetchLiabilities]);

  const handleOpenForm = useCallback(() => {
    if (!formData.currencyId && currencies.length > 0) {
      const usdCurrency = currencies.find((c) => c.code === 'USD');
      setFormData((prev) => ({
        ...prev,
        currencyId: usdCurrency?.id || currencies[0]?.id || '',
      }));
    }
    setShowForm(true);
  }, [currencies, formData.currencyId]);

  if (loading) return <AssetsSkeleton />;

  if (error) {
    return (
      <ErrorMessage
        type="page"
        title={t('common.error')}
        message={error}
        onRetry={handleRetry}
        retryText={t('common.retry')}
      />
    );
  }

  return (
    <div className="liabilities-page">
      <PageHeader
        title={t('liabilities.title')}
        actionLabel={showForm ? t('common.cancel') : t('liabilities.addLiability')}
        onAction={showForm ? handleCancel : handleOpenForm}
      />

      <LiabilityForm
        isOpen={showForm}
        onClose={handleCancel}
        onSubmit={handleSubmit}
        formData={formData}
        setFormData={setFormData}
        currencies={currencies}
        editingId={editingId}
        submitting={submitting}
      />

      <div className="liabilities-content-wrapper">
        <LiabilityList
          liabilities={liabilities}
          onEdit={handleEdit}
          onDelete={handleDelete}
          deletingId={deletingId}
        />

        <LiabilityChart liabilities={liabilities} />
      </div>
    </div>
  );
}
