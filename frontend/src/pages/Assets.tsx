import { useEffect, useState, useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import axios from "axios";
import { Pie } from "react-chartjs-2";
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from "chart.js";
import "./Assets.css";

ChartJS.register(ArcElement, Tooltip, Legend);

interface Currency {
  id: string;
  code: string;
  name: string;
  symbol: string;
  type: string;
}

export default function Assets() {
  const location = useLocation();
  const navigate = useNavigate();

  // Determine active tab from URL
  const getActiveTab = () => {
    const path = location.pathname;
    if (path.includes("/assets/stock")) return "stock";
    if (path.includes("/assets/flow")) return "flow";
    if (path.includes("/assets/overview")) return "overview";
    return "overview"; // default
  };

  const [activeTab, setActiveTab] = useState<"stock" | "flow" | "overview">(
    getActiveTab()
  );
  const [assets, setAssets] = useState<any[]>([]);
  const [currencies, setCurrencies] = useState<Currency[]>([
    // Default currencies - will be replaced if API succeeds
    { id: "1", code: "USD", name: "US Dollar", symbol: "$", type: "fiat" },
    { id: "2", code: "EUR", name: "Euro", symbol: "€", type: "fiat" },
    { id: "3", code: "RUB", name: "Russian Ruble", symbol: "₽", type: "fiat" },
    { id: "4", code: "BTC", name: "Bitcoin", symbol: "₿", type: "crypto" },
    { id: "5", code: "ETH", name: "Ethereum", symbol: "Ξ", type: "crypto" },
    { id: "6", code: "USDT", name: "Tether", symbol: "₮", type: "stablecoin" },
  ]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"single" | "all">("single");
  const [selectedCurrency, setSelectedCurrency] = useState("USD");
  const [groupBy, setGroupBy] = useState<"name" | "category">("name");
  const [totalAmount, setTotalAmount] = useState<{
    stock: { currency: string; amount: number }[];
    flow: { currency: string; amount: number }[];
  }>({ stock: [], flow: [] });
  const [formData, setFormData] = useState({
    name: "",
    assetType: "stock",
    category: "investments",
    incomeType: "" as "active" | "passive" | "",
    amount: "",
    currencyId: "",
    date: new Date().toISOString().split("T")[0],
    description: "",
  });

  // Update active tab when location changes
  useEffect(() => {
    const tab = getActiveTab();
    setActiveTab(tab);
  }, [location.pathname]);

  // Redirect to overview if on base /assets path
  useEffect(() => {
    if (location.pathname === "/assets") {
      navigate("/assets/overview", { replace: true });
    }
  }, [location.pathname, navigate]);

  useEffect(() => {
    fetchCurrencies();
    fetchAssets();
  }, []);

  useEffect(() => {
    // Set default currencyId when currencies are loaded
    if (currencies.length > 0 && !formData.currencyId) {
      const usdCurrency = currencies.find((c) => c.code === "USD");
      if (usdCurrency) {
        setFormData((prev) => ({ ...prev, currencyId: usdCurrency.id }));
      } else {
        setFormData((prev) => ({ ...prev, currencyId: currencies[0].id }));
      }
    }
  }, [currencies]);

  const fetchCurrencies = async () => {
    try {
      const response = await axios.get("/currencies/list");
      if (response.data && response.data.length > 0) {
        setCurrencies(response.data);
        console.log("✅ Loaded currencies from API:", response.data.length);
      } else {
        console.log("⚠️ API returned empty list, keeping default currencies");
      }
    } catch (error: any) {
      console.log(
        "⚠️ Could not load currencies from API, using defaults:",
        error?.message || "Unknown error"
      );
      // Keep default currencies that were set in useState
    }
  };

  const fetchAssets = async () => {
    try {
      const response = await axios.get("/assets");
      setAssets(response.data);
    } catch (error) {
      console.error("Error fetching assets:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      // Find currency code from currencyId
      const selectedCurrencyObj = currencies.find(
        (c) => c.id === formData.currencyId
      );
      const currencyCode = selectedCurrencyObj?.code || "USD";

      const payload: any = {
        name: formData.name,
        assetType: formData.assetType,
        category: formData.category,
        amount: parseFloat(formData.amount),
        currency: currencyCode,
        date: formData.date,
        description: formData.description,
      };

      // Add incomeType only for flow assets
      if (formData.assetType === "flow" && formData.incomeType) {
        payload.incomeType = formData.incomeType;
      }

      if (editingId) {
        // Update existing asset
        await axios.patch(`/assets/${editingId}`, payload);
      } else {
        // Create new asset
        await axios.post("/assets", payload);
      }
      setShowForm(false);
      setEditingId(null);
      const usdCurrency = currencies.find((c) => c.code === "USD");
      setFormData({
        name: "",
        assetType: "stock",
        category: "investments",
        incomeType: "",
        amount: "",
        currencyId: usdCurrency?.id || currencies[0]?.id || "",
        date: new Date().toISOString().split("T")[0],
        description: "",
      });
      fetchAssets();
    } catch (error) {
      console.error("Error saving asset:", error);
    }
  };

  const handleEdit = (asset: any) => {
    try {
      console.log("handleEdit called with asset:", asset);
      console.log("Available currencies:", currencies);

      // Use fallback currencies if API currencies not loaded yet
      const availableCurrencies =
        currencies.length > 0
          ? currencies
          : [
              {
                id: "1",
                code: "USD",
                name: "US Dollar",
                symbol: "$",
                type: "fiat",
              },
              { id: "2", code: "EUR", name: "Euro", symbol: "€", type: "fiat" },
              {
                id: "3",
                code: "RUB",
                name: "Russian Ruble",
                symbol: "₽",
                type: "fiat",
              },
              {
                id: "4",
                code: "BTC",
                name: "Bitcoin",
                symbol: "₿",
                type: "crypto",
              },
              {
                id: "5",
                code: "ETH",
                name: "Ethereum",
                symbol: "Ξ",
                type: "crypto",
              },
              {
                id: "6",
                code: "USDT",
                name: "Tether",
                symbol: "₮",
                type: "stablecoin",
              },
            ];

      setEditingId(asset.id);

      // Handle both currency object and currency string
      const assetCurrencyCode = asset.currency?.code || asset.currency || "USD";
      console.log("Asset currency code:", assetCurrencyCode);

      const assetCurrencyId =
        availableCurrencies.find((c) => c.code === assetCurrencyCode)?.id ||
        availableCurrencies.find((c) => c.code === "USD")?.id ||
        availableCurrencies[0]?.id ||
        "";

      console.log("Found currency ID:", assetCurrencyId);

      setFormData({
        name: asset.name || "",
        assetType: asset.assetType || "stock",
        category: asset.category || "investments",
        incomeType: asset.incomeType || "",
        amount: asset.amount?.toString() || "0",
        currencyId: assetCurrencyId,
        date: asset.date
          ? new Date(asset.date).toISOString().split("T")[0]
          : new Date().toISOString().split("T")[0],
        description: asset.description || "",
      });

      console.log("Form data set, opening form. editingId:", asset.id);
      setShowForm(true);
      console.log("showForm should be true now");
    } catch (error) {
      console.error("Error in handleEdit:", error);
      alert("Error editing asset: " + (error as Error).message);
    }
  };

  const handleCancel = () => {
    setShowForm(false);
    setEditingId(null);
    const usdCurrency = currencies.find((c) => c.code === "USD");
    setFormData({
      name: "",
      assetType: "stock",
      category: "investments",
      incomeType: "",
      amount: "",
      currencyId: usdCurrency?.id || currencies[0]?.id || "",
      date: new Date().toISOString().split("T")[0],
      description: "",
    });
  };

  const handleDelete = async (id: string) => {
    if (window.confirm("Are you sure you want to delete this asset?")) {
      try {
        await axios.delete(`/assets/${id}`);
        fetchAssets();
      } catch (error) {
        console.error("Error deleting asset:", error);
      }
    }
  };

  const convertAmount = useCallback(
    async (
      amount: number,
      fromCurrency: string,
      toCurrency: string
    ): Promise<number> => {
      if (fromCurrency === toCurrency) {
        return amount;
      }
      try {
        const response = await axios.get("/currencies/convert", {
          params: { amount, from: fromCurrency, to: toCurrency },
        });
        console.log(
          `Convert ${amount} ${fromCurrency} to ${toCurrency}:`,
          response.data
        );
        return typeof response.data === "number"
          ? response.data
          : parseFloat(response.data);
      } catch (error) {
        console.error("Error converting currency:", error);
        return amount;
      }
    },
    []
  );

  // Filter assets based on active tab
  const getFilteredAssets = useCallback(() => {
    if (activeTab === "stock") {
      return assets.filter((a) => a.assetType === "stock");
    } else if (activeTab === "flow") {
      return assets.filter((a) => a.assetType === "flow");
    }
    return assets; // overview - show all
  }, [assets, activeTab]);

  const prepareChartData = useCallback(async () => {
    const filteredAssets = getFilteredAssets();
    if (!filteredAssets || filteredAssets.length === 0) {
      return null;
    }

    console.log(
      "Preparing chart data for assets:",
      filteredAssets.length,
      "assets (tab:",
      activeTab,
      ")"
    );
    const categoryTotals: Record<string, number> = {};
    const categoryTotalsUSD: Record<string, number> = {}; // For percentage calculation

    if (viewMode === "all") {
      // In "all" mode: show assets in their original currencies,
      // but calculate percentages using USD conversion for accurate proportions
      for (const asset of filteredAssets) {
        try {
          const assetCurrencyCode =
            asset.currency?.code || asset.currency || "USD";
          // Group by name or category based on groupBy setting
          const key =
            groupBy === "category"
              ? `${asset.category} (${assetCurrencyCode})`
              : `${asset.name} (${asset.category}) (${assetCurrencyCode})`;
          const amount = parseFloat(asset.amount);

          if (isNaN(amount) || amount <= 0) {
            console.warn(`Skipping asset with invalid amount:`, asset);
            continue;
          }

          // Store original amount for display
          categoryTotals[key] = (categoryTotals[key] || 0) + amount;

          // Convert to USD for percentage calculation
          let amountInUSD = amount;
          if (assetCurrencyCode !== "USD") {
            try {
              amountInUSD = await convertAmount(
                amount,
                assetCurrencyCode,
                "USD"
              );
              if (isNaN(amountInUSD) || amountInUSD <= 0) {
                console.warn(
                  `Invalid USD conversion result for ${assetCurrencyCode}, using original amount`
                );
                amountInUSD = amount; // Fallback to original amount
              }
            } catch (conversionError) {
              console.error(
                `Error converting ${amount} ${assetCurrencyCode} to USD:`,
                conversionError
              );
              // Use original amount as fallback for percentage calculation
              // This ensures the asset is still displayed even if conversion fails
              amountInUSD = amount;
            }
          }

          // Use same key for USD totals to match percentages
          categoryTotalsUSD[key] = (categoryTotalsUSD[key] || 0) + amountInUSD;
          console.log(
            `Processed asset: ${asset.name}, ${amount} ${assetCurrencyCode} = ${amountInUSD} USD, key: ${key}`
          );
        } catch (error) {
          console.error("Error processing asset for chart:", error, asset);
          // Continue processing other assets even if one fails
        }
      }
      console.log("Category totals (all mode):", categoryTotals);
      console.log("Category totals USD (all mode):", categoryTotalsUSD);
    } else {
      // In "single" mode: convert all to USD first for accurate proportions,
      // then convert to selected currency for display

      // Step 1: Convert all assets to USD for proper proportion calculation
      for (const asset of filteredAssets) {
        try {
          const assetCurrencyCode =
            asset.currency?.code || asset.currency || "USD";
          const amount = parseFloat(asset.amount);

          if (isNaN(amount) || amount <= 0) {
            console.warn(`Skipping asset with invalid amount:`, asset);
            continue;
          }

          // Convert to USD first
          let amountInUSD = amount;
          if (assetCurrencyCode !== "USD") {
            try {
              amountInUSD = await convertAmount(
                amount,
                assetCurrencyCode,
                "USD"
              );
              if (isNaN(amountInUSD) || amountInUSD <= 0) {
                console.warn(
                  `Invalid USD conversion result for ${assetCurrencyCode}, using original amount`
                );
                amountInUSD = amount; // Fallback to original amount
              }
            } catch (conversionError) {
              console.error(
                `Error converting ${amount} ${assetCurrencyCode} to USD:`,
                conversionError
              );
              // Use original amount as fallback
              amountInUSD = amount;
            }
          }

          // Group by name or category based on groupBy setting
          const key =
            groupBy === "category"
              ? asset.category
              : `${asset.name} (${asset.category})`;
          categoryTotalsUSD[key] = (categoryTotalsUSD[key] || 0) + amountInUSD;
          console.log(
            `Processed asset: ${asset.name}, ${amount} ${assetCurrencyCode} = ${amountInUSD} USD, category: ${key}`
          );
        } catch (error) {
          console.error("Error processing asset for chart:", error, asset);
          // Continue processing other assets even if one fails
        }
      }
      console.log("Category totals USD (single mode):", categoryTotalsUSD);

      // Step 2: Convert totals from USD to selected currency for display
      for (const [category, amountUSD] of Object.entries(categoryTotalsUSD)) {
        if (selectedCurrency === "USD") {
          categoryTotals[category] = amountUSD;
        } else {
          try {
            const convertedAmount = await convertAmount(
              amountUSD,
              "USD",
              selectedCurrency
            );
            categoryTotals[category] = convertedAmount;
          } catch (error) {
            console.error(
              `Error converting ${category} to ${selectedCurrency}:`,
              error
            );
            categoryTotals[category] = amountUSD; // Fallback to USD
          }
        }
      }
    }

    if (Object.keys(categoryTotals).length === 0) {
      return null;
    }

    // Calculate total in USD for percentage calculation
    const totalUSD = Object.values(categoryTotalsUSD).reduce(
      (sum, val) => sum + val,
      0
    );

    // Calculate percentages based on USD values for accurate proportions
    // Use USD values for data to ensure visual proportions match percentages
    const keys = Object.keys(categoryTotals);
    const labels = keys.map((key) => {
      const usdValue = categoryTotalsUSD[key] || 0;
      const percentage = totalUSD > 0 ? (usdValue / totalUSD) * 100 : 0;
      return `${key} (${percentage.toFixed(1)}%)`;
    });

    // Use USD values for data array to ensure correct visual proportions
    // The order must match the keys order
    const dataValues = keys.map((key) => categoryTotalsUSD[key] || 0);

    return {
      labels: labels,
      datasets: [
        {
          data: dataValues, // Use USD values for correct visual proportions
          backgroundColor: [
            "#FF6384",
            "#36A2EB",
            "#FFCE56",
            "#4BC0C0",
            "#9966FF",
            "#FF9F40",
            "#FF8A80",
            "#EA80FC",
            "#8C9EFF",
            "#82B1FF",
          ],
        },
      ],
      // Store original totals for display in tooltip
      _originalTotals: categoryTotals,
      // Store USD totals for percentage calculation
      _usdTotals: categoryTotalsUSD,
      _totalUSD: totalUSD,
      // Store keys order to match data with original values
      _keys: keys,
    };
  }, [
    getFilteredAssets,
    viewMode,
    selectedCurrency,
    convertAmount,
    activeTab,
    groupBy,
  ]);

  const [chartData, setChartData] = useState<any>(null);

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

  useEffect(() => {
    const calculateTotalAmount = async () => {
      const filteredAssets = getFilteredAssets();
      if (!filteredAssets || filteredAssets.length === 0) {
        setTotalAmount({ stock: [], flow: [] });
        return;
      }

      // Separate assets by type (from filtered assets)
      const stockAssets = filteredAssets.filter((a) => a.assetType === "stock");
      const flowAssets = filteredAssets.filter((a) => a.assetType === "flow");

      if (viewMode === "single") {
        // Calculate totals in selected currency
        let stockTotal = 0;
        let flowTotal = 0;

        // Calculate stock total
        for (const asset of stockAssets) {
          try {
            const assetCurrencyCode =
              asset.currency?.code || asset.currency || "USD";
            const amount = await convertAmount(
              parseFloat(asset.amount),
              assetCurrencyCode,
              selectedCurrency
            );
            stockTotal += amount;
          } catch (error) {
            console.error("Error converting stock asset for total:", error);
          }
        }

        // Calculate flow total
        for (const asset of flowAssets) {
          try {
            const assetCurrencyCode =
              asset.currency?.code || asset.currency || "USD";
            const amount = await convertAmount(
              parseFloat(asset.amount),
              assetCurrencyCode,
              selectedCurrency
            );
            flowTotal += amount;
          } catch (error) {
            console.error("Error converting flow asset for total:", error);
          }
        }

        setTotalAmount({
          stock:
            stockTotal > 0
              ? [{ currency: selectedCurrency, amount: stockTotal }]
              : [],
          flow:
            flowTotal > 0
              ? [{ currency: selectedCurrency, amount: flowTotal }]
              : [],
        });
      } else {
        // Calculate totals by original currency
        const stockTotalsByCurrency: Record<string, number> = {};
        const flowTotalsByCurrency: Record<string, number> = {};

        for (const asset of stockAssets) {
          const assetCurrencyCode =
            asset.currency?.code || asset.currency || "USD";
          const amount = parseFloat(asset.amount);
          stockTotalsByCurrency[assetCurrencyCode] =
            (stockTotalsByCurrency[assetCurrencyCode] || 0) + amount;
        }

        for (const asset of flowAssets) {
          const assetCurrencyCode =
            asset.currency?.code || asset.currency || "USD";
          const amount = parseFloat(asset.amount);
          flowTotalsByCurrency[assetCurrencyCode] =
            (flowTotalsByCurrency[assetCurrencyCode] || 0) + amount;
        }

        const stockTotals = Object.entries(stockTotalsByCurrency).map(
          ([currency, amount]) => ({
            currency,
            amount,
          })
        );
        const flowTotals = Object.entries(flowTotalsByCurrency).map(
          ([currency, amount]) => ({
            currency,
            amount,
          })
        );

        setTotalAmount({
          stock: stockTotals,
          flow: flowTotals,
        });
      }
    };

    calculateTotalAmount();
  }, [assets, viewMode, selectedCurrency, convertAmount, getFilteredAssets]);

  if (loading) {
    return <div className="loading">Loading...</div>;
  }

  return (
    <div className="assets-page">
      <div className="page-header">
        <h1>Assets</h1>
        <button
          onClick={() => {
            if (showForm) {
              handleCancel();
            } else {
              setShowForm(true);
            }
          }}
        >
          {showForm ? "Cancel" : "Add Asset"}
        </button>
      </div>

      {/* Sub-navigation menu */}
      <div className="sub-nav">
        <button
          className={`sub-nav-btn ${activeTab === "overview" ? "active" : ""}`}
          onClick={() => {
            navigate("/assets/overview");
            setActiveTab("overview");
          }}
        >
          Overview
        </button>
        <button
          className={`sub-nav-btn ${activeTab === "stock" ? "active" : ""}`}
          onClick={() => {
            navigate("/assets/stock");
            setActiveTab("stock");
          }}
        >
          Stock Assets
        </button>
        <button
          className={`sub-nav-btn ${activeTab === "flow" ? "active" : ""}`}
          onClick={() => {
            navigate("/assets/flow");
            setActiveTab("flow");
          }}
        >
          Flow Assets
        </button>
      </div>

      {showForm && (
        <div className="modal-overlay" onClick={handleCancel}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{editingId ? "Edit Asset" : "Add New Asset"}</h2>
              <button className="modal-close" onClick={handleCancel}>
                ×
              </button>
            </div>
            <form onSubmit={handleSubmit} className="asset-form">
              <div className="form-row">
                <div className="form-group">
                  <label>Name</label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) =>
                      setFormData({ ...formData, name: e.target.value })
                    }
                    required
                  />
                </div>
                <div className="form-group">
                  <label>Asset Type</label>
                  <select
                    value={formData.assetType}
                    onChange={(e) => {
                      const assetType = e.target.value;
                      const defaultCategory =
                        assetType === "stock" ? "investments" : "salary";
                      // Set default income type for flow assets based on category
                      const defaultIncomeType =
                        assetType === "flow" ? "active" : "";
                      setFormData({
                        ...formData,
                        assetType,
                        category: defaultCategory,
                        incomeType: defaultIncomeType,
                      });
                    }}
                    required
                  >
                    <option value="stock">Stock (Балансовые активы)</option>
                    <option value="flow">Flow (Потоковые доходы)</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Category</label>
                  <select
                    value={formData.category}
                    onChange={(e) => {
                      const category = e.target.value;
                      // Auto-set income type based on category for flow assets
                      let incomeType = formData.incomeType;
                      if (formData.assetType === "flow") {
                        // Active income: salary, freelance
                        if (category === "salary" || category === "freelance") {
                          incomeType = "active";
                        }
                        // Passive income: dividends, rent_income, pension
                        else if (
                          category === "dividends" ||
                          category === "rent_income" ||
                          category === "pension"
                        ) {
                          incomeType = "passive";
                        }
                      }
                      setFormData({ ...formData, category, incomeType });
                    }}
                    required
                  >
                    {formData.assetType === "stock" ? (
                      <>
                        <option value="real_estate">Real Estate</option>
                        <option value="investments">Investments</option>
                        <option value="savings">Savings</option>
                        <option value="crypto">Crypto</option>
                        <option value="vehicle">Vehicle</option>
                        <option value="equipment">Equipment</option>
                        <option value="other">Other</option>
                      </>
                    ) : (
                      <>
                        <option value="salary">Salary</option>
                        <option value="dividends">Dividends</option>
                        <option value="freelance">Freelance</option>
                        <option value="rent_income">Rent Income</option>
                        <option value="pension">Pension</option>
                        <option value="other">Other</option>
                      </>
                    )}
                  </select>
                </div>
                {formData.assetType === "flow" && (
                  <div className="form-group">
                    <label>Income Type</label>
                    <select
                      value={formData.incomeType}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          incomeType: e.target.value as "active" | "passive",
                        })
                      }
                      required
                    >
                      <option value="active">
                        Active (требует активной работы)
                      </option>
                      <option value="passive">Passive (пассивный доход)</option>
                    </select>
                  </div>
                )}
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Amount</label>
                  <input
                    type="number"
                    step="0.01"
                    value={formData.amount}
                    onChange={(e) =>
                      setFormData({ ...formData, amount: e.target.value })
                    }
                    required
                  />
                </div>
                <div className="form-group">
                  <label>Currency</label>
                  <select
                    value={formData.currencyId}
                    onChange={(e) =>
                      setFormData({ ...formData, currencyId: e.target.value })
                    }
                    required
                  >
                    {currencies.map((curr) => (
                      <option key={curr.id} value={curr.id}>
                        {curr.code} - {curr.name} ({curr.symbol})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label>Date</label>
                  <input
                    type="date"
                    value={formData.date}
                    onChange={(e) =>
                      setFormData({ ...formData, date: e.target.value })
                    }
                    required
                  />
                </div>
              </div>
              <div className="form-group">
                <label>Description</label>
                <textarea
                  value={formData.description}
                  onChange={(e) =>
                    setFormData({ ...formData, description: e.target.value })
                  }
                />
              </div>
              <div className="form-actions">
                <button type="submit">
                  {editingId ? "Update Asset" : "Create Asset"}
                </button>
                <button
                  type="button"
                  onClick={handleCancel}
                  className="cancel-btn"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="view-controls">
        <div className="view-mode-switch">
          <label>View Mode:</label>
          <button
            className={`mode-btn ${viewMode === "single" ? "active" : ""}`}
            onClick={() => setViewMode("single")}
          >
            Single Currency
          </button>
          <button
            className={`mode-btn ${viewMode === "all" ? "active" : ""}`}
            onClick={() => setViewMode("all")}
          >
            All Currencies
          </button>
        </div>
        <div className="group-by-switch">
          <label>Group By:</label>
          <button
            className={`mode-btn ${groupBy === "name" ? "active" : ""}`}
            onClick={() => setGroupBy("name")}
          >
            By Name
          </button>
          <button
            className={`mode-btn ${groupBy === "category" ? "active" : ""}`}
            onClick={() => setGroupBy("category")}
          >
            By Category
          </button>
        </div>
        {viewMode === "single" && (
          <div className="currency-selector">
            <label>Display Currency:</label>
            <select
              value={selectedCurrency}
              onChange={(e) => setSelectedCurrency(e.target.value)}
            >
              {currencies.map((curr) => (
                <option key={curr.id} value={curr.code}>
                  {curr.code} ({curr.symbol})
                </option>
              ))}
            </select>
            {((activeTab === "overview" &&
              (totalAmount.stock.length > 0 || totalAmount.flow.length > 0)) ||
              (activeTab === "stock" && totalAmount.stock.length > 0) ||
              (activeTab === "flow" && totalAmount.flow.length > 0)) && (
              <div className="total-amounts-container">
                {(activeTab === "overview" || activeTab === "stock") &&
                  totalAmount.stock.length > 0 && (
                    <div className="total-amount stock-total">
                      <span className="total-label">Stock Assets:</span>
                      <span className="total-value">
                        {totalAmount.stock[0].amount.toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}{" "}
                        {totalAmount.stock[0].currency}
                      </span>
                    </div>
                  )}
                {(activeTab === "overview" || activeTab === "flow") &&
                  totalAmount.flow.length > 0 && (
                    <div className="total-amount flow-total">
                      <span className="total-label">Flow Income:</span>
                      <span className="total-value">
                        {totalAmount.flow[0].amount.toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}{" "}
                        {totalAmount.flow[0].currency}
                      </span>
                    </div>
                  )}
              </div>
            )}
          </div>
        )}
        {viewMode === "all" &&
          ((activeTab === "overview" &&
            (totalAmount.stock.length > 0 || totalAmount.flow.length > 0)) ||
            (activeTab === "stock" && totalAmount.stock.length > 0) ||
            (activeTab === "flow" && totalAmount.flow.length > 0)) && (
            <div className="total-amounts-all">
              {(activeTab === "overview" || activeTab === "stock") &&
                totalAmount.stock.length > 0 && (
                  <div className="total-section">
                    <span className="total-label">Stock Assets:</span>
                    <div className="total-amounts-list">
                      {totalAmount.stock.map((item, index) => (
                        <span
                          key={index}
                          className="total-amount-item stock-item"
                        >
                          {item.amount.toLocaleString(undefined, {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}{" "}
                          {item.currency}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              {(activeTab === "overview" || activeTab === "flow") &&
                totalAmount.flow.length > 0 && (
                  <div className="total-section">
                    <span className="total-label">Flow Income:</span>
                    <div className="total-amounts-list">
                      {totalAmount.flow.map((item, index) => (
                        <span
                          key={index}
                          className="total-amount-item flow-item"
                        >
                          {item.amount.toLocaleString(undefined, {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}{" "}
                          {item.currency}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
            </div>
          )}
      </div>

      {getFilteredAssets().length > 0 && chartData && (
        <div className="chart-container">
          <h2>
            Asset Distribution
            {viewMode === "single" && (
              <span className="currency-badge"> ({selectedCurrency})</span>
            )}
          </h2>
          <Pie
            data={chartData}
            options={{
              plugins: {
                tooltip: {
                  callbacks: {
                    label: function (context) {
                      const label = context.label || "";
                      let currency = "";
                      let percentage = "";
                      let displayValue = 0;

                      // Extract percentage from label
                      // Format in "all" mode with groupBy="name": "Asset Name (Category) (CURRENCY) (XX.X%)"
                      // Format in "all" mode with groupBy="category": "Category (CURRENCY) (XX.X%)"
                      // Format in "single" mode with groupBy="name": "Asset Name (Category) (XX.X%)"
                      // Format in "single" mode with groupBy="category": "Category (XX.X%)"
                      const labelMatch = label.match(/^(.+?)\s*\(([\d.]+)%\)$/);
                      let cleanLabel = labelMatch ? labelMatch[1] : label;
                      const labelPercentage = labelMatch ? labelMatch[2] : null;

                      // Get the original value (not USD) for display
                      // Use dataIndex to get the correct key from _keys array
                      if (chartData?._keys && chartData?._originalTotals) {
                        const key = chartData._keys[context.dataIndex];
                        displayValue = chartData._originalTotals[key] || 0;
                      } else {
                        // Fallback to parsed value if original totals not available
                        displayValue = context.parsed || 0;
                      }

                      if (viewMode === "single") {
                        currency = selectedCurrency;
                        // Use percentage from label (already calculated)
                        if (labelPercentage) {
                          percentage = ` (${labelPercentage}%)`;
                        } else {
                          // Fallback: calculate percentage from chart data
                          if (chartData?._usdTotals && chartData?._totalUSD) {
                            const key = chartData._keys[context.dataIndex];
                            const usdValue = chartData._usdTotals[key] || 0;
                            const pct =
                              chartData._totalUSD > 0
                                ? (usdValue / chartData._totalUSD) * 100
                                : 0;
                            percentage = ` (${pct.toFixed(1)}%)`;
                          }
                        }
                      } else {
                        // Extract currency from label if in "all" mode
                        // Format: "Asset Name (Category) (CURRENCY) (XX.X%)"
                        // Find the currency code - it's the last group in parentheses before the percentage
                        // Match all groups in parentheses and take the last one that looks like a currency code
                        const parenthesesMatches =
                          cleanLabel.match(/\(([^)]+)\)/g);
                        if (
                          parenthesesMatches &&
                          parenthesesMatches.length > 0
                        ) {
                          // Get the last match (should be currency code)
                          const lastMatch =
                            parenthesesMatches[parenthesesMatches.length - 1];
                          const currencyCandidate = lastMatch.replace(
                            /[()]/g,
                            ""
                          );
                          // Check if it's a currency code (3+ uppercase letters/numbers like BTC, ETH, USDT)
                          if (/^[A-Z0-9]{3,}$/.test(currencyCandidate)) {
                            currency = currencyCandidate;
                            // Remove currency from cleanLabel for cleaner display
                            cleanLabel = cleanLabel.replace(
                              /\s*\([A-Z0-9]{3,}\)\s*$/,
                              ""
                            );
                          }
                        }
                        // Use percentage from label
                        if (labelPercentage) {
                          percentage = ` (${labelPercentage}%)`;
                        }
                      }

                      return `${cleanLabel}: ${displayValue.toLocaleString(
                        undefined,
                        {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        }
                      )} ${currency}${percentage}`;
                    },
                  },
                },
              },
            }}
          />
        </div>
      )}

      <div className="assets-list">
        <h2>
          {activeTab === "stock"
            ? "Stock Assets"
            : activeTab === "flow"
            ? "Flow Assets"
            : "All Assets"}
        </h2>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th>Category</th>
              <th>Amount</th>
              <th>Currency</th>
              <th>Date</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {getFilteredAssets().map((asset) => (
              <tr key={asset.id}>
                <td>{asset.name}</td>
                <td>
                  <span className={`asset-type-badge ${asset.assetType}`}>
                    {asset.assetType === "stock" ? "Stock" : "Flow"}
                  </span>
                </td>
                <td>{asset.category}</td>
                <td>{parseFloat(asset.amount).toLocaleString()}</td>
                <td>{asset.currency?.code || asset.currency || "USD"}</td>
                <td>{new Date(asset.date).toLocaleDateString()}</td>
                <td>
                  <button
                    className="edit-btn"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      console.log("Edit button clicked for asset:", asset.id);
                      handleEdit(asset);
                    }}
                  >
                    Edit
                  </button>
                  <button
                    className="delete-btn"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleDelete(asset.id);
                    }}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
