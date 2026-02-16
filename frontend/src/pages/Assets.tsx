import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { assetsApi, currenciesApi } from '@api';
import type { Asset, Currency } from '@shared/types';
import { PageHeader, SubNav } from '@components/common';
import AssetsSkeleton from '@components/AssetsSkeleton';
import ErrorMessage from '@components/ErrorMessage';
import {
  AssetForm,
  AssetList,
  AssetViewControls,
  AssetTotals,
  AssetChart,
  useCurrencyConversion,
  CHART_COLORS,
  getInitialFormData,
} from '@features/assets';
import { DEFAULT_CURRENCIES } from '@shared/constants/currencies';
import type {
  AssetTab,
  ViewMode,
  GroupBy,
  AssetFormData,
  TotalAmount,
  AssetChartData,
} from '@features/assets';
import './Assets.css';

export default function Assets() {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const { convertAmount, clearCache } = useCurrencyConversion();

  // Determine active tab from URL
  const getActiveTab = useCallback((): AssetTab => {
    const path = location.pathname;
    if (path.includes('/assets/stock')) return 'stock';
    if (path.includes('/assets/flow')) return 'flow';
    if (path.includes('/assets/overview')) return 'overview';
    return 'overview';
  }, [location.pathname]);

  const [activeTab, setActiveTab] = useState<AssetTab>(getActiveTab());
  const [assets, setAssets] = useState<Asset[]>([]);
  const [currencies, setCurrencies] = useState<Currency[]>(DEFAULT_CURRENCIES);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('single');
  const [selectedCurrency, setSelectedCurrency] = useState('USD');
  const [groupBy, setGroupBy] = useState<GroupBy>('name');
  const [totalAmount, setTotalAmount] = useState<TotalAmount>({ stock: [], flow: [] });
  const [formData, setFormData] = useState<AssetFormData>(getInitialFormData('1'));
  const [chartData, setChartData] = useState<AssetChartData | null>(null);

  const fetchingRef = useRef(false);

  // Sub-navigation tabs
  const subNavTabs = useMemo(
    () => [
      { key: 'overview', label: t('assets.overview'), path: '/assets/overview' },
      { key: 'stock', label: t('assets.stockAssets'), path: '/assets/stock' },
      { key: 'flow', label: t('assets.flowAssets'), path: '/assets/flow' },
    ],
    [t]
  );

  // Update active tab when location changes
  useEffect(() => {
    setActiveTab(getActiveTab());
  }, [getActiveTab]);

  // Redirect to overview if on base /assets path
  useEffect(() => {
    if (location.pathname === '/assets') {
      navigate('/assets/overview', { replace: true });
    }
  }, [location.pathname, navigate]);

  // Clear currency cache when selected currency changes
  useEffect(() => {
    clearCache();
  }, [selectedCurrency, clearCache]);

  // Fetch currencies and assets on mount
  useEffect(() => {
    const fetchData = async () => {
      await Promise.all([fetchCurrencies(), fetchAssets()]);
    };
    fetchData();
  }, []);

  // Set default currencyId when currencies are loaded
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
    } catch (err) {
      console.warn('Could not load currencies from API, using defaults');
    }
  };

  const fetchAssets = useCallback(async () => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    try {
      setError(null);
      const data = await assetsApi.getAll();
      setAssets(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : t('common.errorLoading');
      setError(message);
    } finally {
      setLoading(false);
      fetchingRef.current = false;
    }
  }, [t]);

  const getFilteredAssets = useCallback(() => {
    if (activeTab === 'stock') return assets.filter((a) => a.assetType === 'stock');
    if (activeTab === 'flow') return assets.filter((a) => a.assetType === 'flow');
    return assets;
  }, [assets, activeTab]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);

    try {
      let currencyIdToUse = formData.currencyId;
      if (!currencyIdToUse && currencies.length > 0) {
        const usdCurrency = currencies.find((c) => c.code === 'USD');
        currencyIdToUse = usdCurrency?.id || currencies[0]?.id || '';
      }

      const payload = {
        name: formData.name,
        assetType: formData.assetType,
        category: formData.category,
        amount: parseFloat(formData.amount),
        currencyId: currencyIdToUse,
        date: formData.date,
        description: formData.description,
        ...(formData.assetType === 'flow' && formData.incomeType
          ? { incomeType: formData.incomeType }
          : {}),
      };

      if (editingId) {
        await assetsApi.update(editingId, payload as Parameters<typeof assetsApi.update>[1]);
      } else {
        await assetsApi.create(payload as Parameters<typeof assetsApi.create>[0]);
      }

      setShowForm(false);
      setEditingId(null);
      const usdCurrency = currencies.find((c) => c.code === 'USD');
      setFormData(getInitialFormData(usdCurrency?.id || currencies[0]?.id || ''));
      fetchAssets();
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
    (asset: Asset) => {
      try {
        const availableCurrencies = currencies.length > 0 ? currencies : DEFAULT_CURRENCIES;
        setEditingId(asset.id);

        const assetCurrencyCode =
          typeof asset.currency === 'object' && asset.currency !== null
            ? (asset.currency as { code?: string }).code || 'USD'
            : String(asset.currency || 'USD');
        const assetCurrencyId =
          availableCurrencies.find((c) => c.code === assetCurrencyCode)?.id ||
          availableCurrencies.find((c) => c.code === 'USD')?.id ||
          availableCurrencies[0]?.id ||
          '';

        setFormData({
          name: asset.name || '',
          assetType: asset.assetType || 'stock',
          category: asset.category || 'investments',
          incomeType: (asset as { incomeType?: 'active' | 'passive' | '' }).incomeType || '',
          amount: asset.amount?.toString() || '0',
          currencyId: assetCurrencyId,
          date: asset.date
            ? new Date(asset.date).toISOString().split('T')[0]
            : new Date().toISOString().split('T')[0],
          description: asset.description || '',
        });

        setShowForm(true);
      } catch (err) {
        alert('Error editing asset: ' + (err as Error).message);
      }
    },
    [currencies]
  );

  const handleCancel = useCallback(() => {
    setShowForm(false);
    setEditingId(null);
    const usdCurrency = currencies.find((c) => c.code === 'USD');
    setFormData(getInitialFormData(usdCurrency?.id || currencies[0]?.id || ''));
  }, [currencies]);

  const handleDelete = useCallback(
    async (id: string) => {
      if (window.confirm(t('assets.deleteConfirm'))) {
        setDeletingId(id);
        try {
          await assetsApi.delete(id);
          fetchAssets();
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
    [fetchAssets, t]
  );

  const handleRetry = useCallback(() => {
    setLoading(true);
    setError(null);
    fetchAssets();
  }, [fetchAssets]);

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

  const handleTabChange = useCallback(
    (tab: string) => {
      const navTab = subNavTabs.find((t) => t.key === tab);
      if (navTab) {
        navigate(navTab.path);
        setActiveTab(tab as AssetTab);
      }
    },
    [navigate, subNavTabs]
  );

  // Chart data preparation
  const prepareChartData = useCallback(async (): Promise<AssetChartData | null> => {
    const filteredAssets = getFilteredAssets();
    if (!filteredAssets || filteredAssets.length === 0) return null;

    const categoryTotals: Record<string, number> = {};
    const categoryTotalsUSD: Record<string, number> = {};

    for (const asset of filteredAssets) {
      try {
        const assetCurrencyCode =
          typeof asset.currency === 'object' && asset.currency !== null
            ? (asset.currency as { code?: string }).code || 'USD'
            : String(asset.currency || 'USD');
        const amount = parseFloat(String(asset.amount));

        if (isNaN(amount) || amount <= 0) continue;

        const key =
          viewMode === 'all'
            ? groupBy === 'category'
              ? `${asset.category} (${assetCurrencyCode})`
              : `${asset.name} (${asset.category}) (${assetCurrencyCode})`
            : groupBy === 'category'
              ? asset.category
              : `${asset.name} (${asset.category})`;

        let amountInUSD = amount;
        if (assetCurrencyCode !== 'USD') {
          try {
            amountInUSD = await convertAmount(amount, assetCurrencyCode, 'USD');
            if (isNaN(amountInUSD) || amountInUSD <= 0) amountInUSD = amount;
          } catch {
            amountInUSD = amount;
          }
        }

        if (viewMode === 'all') {
          categoryTotals[key] = (categoryTotals[key] || 0) + amount;
        }
        categoryTotalsUSD[key] = (categoryTotalsUSD[key] || 0) + amountInUSD;
      } catch {
        continue;
      }
    }

    if (viewMode === 'single') {
      for (const [category, amountUSD] of Object.entries(categoryTotalsUSD)) {
        if (selectedCurrency === 'USD') {
          categoryTotals[category] = amountUSD;
        } else {
          try {
            categoryTotals[category] = await convertAmount(amountUSD, 'USD', selectedCurrency);
          } catch {
            categoryTotals[category] = amountUSD;
          }
        }
      }
    }

    if (Object.keys(categoryTotals).length === 0) return null;

    const totalUSD = Object.values(categoryTotalsUSD).reduce((sum, val) => sum + val, 0);
    const keys = Object.keys(categoryTotals);
    const labels = keys.map((key) => {
      const usdValue = categoryTotalsUSD[key] || 0;
      const percentage = totalUSD > 0 ? (usdValue / totalUSD) * 100 : 0;
      return `${key} (${percentage.toFixed(1)}%)`;
    });
    const dataValues = keys.map((key) => categoryTotalsUSD[key] || 0);

    return {
      labels,
      datasets: [
        {
          data: dataValues,
          backgroundColor: CHART_COLORS,
        },
      ],
      _originalTotals: categoryTotals,
      _usdTotals: categoryTotalsUSD,
      _totalUSD: totalUSD,
      _keys: keys,
    };
  }, [getFilteredAssets, viewMode, selectedCurrency, convertAmount, groupBy]);

  // Update chart data
  useEffect(() => {
    const updateChart = async () => {
      const filteredAssets = getFilteredAssets();
      if (filteredAssets.length > 0) {
        const data = await prepareChartData();
        setChartData(data);
      } else {
        setChartData(null);
      }
    };
    updateChart();
  }, [getFilteredAssets, prepareChartData]);

  // Calculate total amounts
  useEffect(() => {
    const calculateTotalAmount = async () => {
      const filteredAssets = getFilteredAssets();
      if (!filteredAssets || filteredAssets.length === 0) {
        setTotalAmount({ stock: [], flow: [] });
        return;
      }

      const stockAssets = filteredAssets.filter((a) => a.assetType === 'stock');
      const flowAssets = filteredAssets.filter((a) => a.assetType === 'flow');

      if (viewMode === 'single') {
        let stockTotal = 0;
        let flowTotal = 0;

        for (const asset of stockAssets) {
          try {
            const assetCurrencyCode =
              typeof asset.currency === 'object' && asset.currency !== null
                ? (asset.currency as { code?: string }).code || 'USD'
                : String(asset.currency || 'USD');
            stockTotal += await convertAmount(
              parseFloat(String(asset.amount)),
              assetCurrencyCode,
              selectedCurrency
            );
          } catch {
            continue;
          }
        }

        for (const asset of flowAssets) {
          try {
            const assetCurrencyCode =
              typeof asset.currency === 'object' && asset.currency !== null
                ? (asset.currency as { code?: string }).code || 'USD'
                : String(asset.currency || 'USD');
            flowTotal += await convertAmount(
              parseFloat(String(asset.amount)),
              assetCurrencyCode,
              selectedCurrency
            );
          } catch {
            continue;
          }
        }

        setTotalAmount({
          stock: stockTotal > 0 ? [{ currency: selectedCurrency, amount: stockTotal }] : [],
          flow: flowTotal > 0 ? [{ currency: selectedCurrency, amount: flowTotal }] : [],
        });
      } else {
        const stockTotalsByCurrency: Record<string, number> = {};
        const flowTotalsByCurrency: Record<string, number> = {};

        for (const asset of stockAssets) {
          const assetCurrencyCode =
            typeof asset.currency === 'object' && asset.currency !== null
              ? (asset.currency as { code?: string }).code || 'USD'
              : String(asset.currency || 'USD');
          stockTotalsByCurrency[assetCurrencyCode] =
            (stockTotalsByCurrency[assetCurrencyCode] || 0) + parseFloat(String(asset.amount));
        }

        for (const asset of flowAssets) {
          const assetCurrencyCode =
            typeof asset.currency === 'object' && asset.currency !== null
              ? (asset.currency as { code?: string }).code || 'USD'
              : String(asset.currency || 'USD');
          flowTotalsByCurrency[assetCurrencyCode] =
            (flowTotalsByCurrency[assetCurrencyCode] || 0) + parseFloat(String(asset.amount));
        }

        setTotalAmount({
          stock: Object.entries(stockTotalsByCurrency).map(([currency, amount]) => ({
            currency,
            amount,
          })),
          flow: Object.entries(flowTotalsByCurrency).map(([currency, amount]) => ({
            currency,
            amount,
          })),
        });
      }
    };

    calculateTotalAmount();
  }, [assets, viewMode, selectedCurrency, convertAmount, getFilteredAssets]);

  const filteredAssets = useMemo(() => getFilteredAssets(), [getFilteredAssets]);

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
    <div className="assets-page">
      <PageHeader
        title={t('assets.title')}
        actionLabel={showForm ? t('common.cancel') : t('assets.addAsset')}
        onAction={showForm ? handleCancel : handleOpenForm}
      />

      <SubNav items={subNavTabs} activeKey={activeTab} onSelect={handleTabChange} />

      <AssetForm
        isOpen={showForm}
        onClose={handleCancel}
        onSubmit={handleSubmit}
        formData={formData}
        setFormData={setFormData}
        currencies={currencies}
        editingId={editingId}
        submitting={submitting}
      />

      <AssetViewControls
        viewMode={viewMode}
        setViewMode={setViewMode}
        groupBy={groupBy}
        setGroupBy={setGroupBy}
        selectedCurrency={selectedCurrency}
        setSelectedCurrency={setSelectedCurrency}
        currencies={currencies}
      />

      <AssetTotals totalAmount={totalAmount} viewMode={viewMode} activeTab={activeTab} />

      <div className="assets-content-wrapper">
        <AssetList
          assets={filteredAssets}
          activeTab={activeTab}
          onEdit={handleEdit}
          onDelete={handleDelete}
          deletingId={deletingId}
        />

        {filteredAssets.length > 0 && (
          <AssetChart
            chartData={chartData}
            selectedCurrency={selectedCurrency}
            viewMode={viewMode}
          />
        )}
      </div>
    </div>
  );
}
