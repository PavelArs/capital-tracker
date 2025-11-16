import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Asset, AssetType, IncomeType } from '../entities/asset.entity';
import { Liability } from '../entities/liability.entity';
import { CryptoWallet } from '../entities/crypto-wallet.entity';
import { CurrenciesService } from '../currencies/currencies.service';
import { CryptoPricesService } from '../crypto/crypto-prices.service';

@Injectable()
export class MetricsService {
  constructor(
    @InjectRepository(Asset)
    private assetRepository: Repository<Asset>,
    @InjectRepository(Liability)
    private liabilityRepository: Repository<Liability>,
    @InjectRepository(CryptoWallet)
    private cryptoWalletRepository: Repository<CryptoWallet>,
    private currenciesService: CurrenciesService,
    private cryptoPricesService: CryptoPricesService,
  ) {}

  async getMetrics(userId: string, targetCurrency: string = 'USD') {
    const assets = await this.assetRepository.find({ where: { userId } });
    const liabilities = await this.liabilityRepository.find({ where: { userId } });
    const cryptoWallets = await this.cryptoWalletRepository.find({ where: { userId } });

    // Separate Stock and Flow assets
    const stockAssets = assets.filter(asset => asset.assetType === AssetType.STOCK);
    const flowAssets = assets.filter(asset => asset.assetType === AssetType.FLOW);
    
    // Separate Flow assets into active and passive income
    const activeIncomeAssets = flowAssets.filter(asset => asset.incomeType === IncomeType.ACTIVE);
    const passiveIncomeAssets = flowAssets.filter(asset => asset.incomeType === IncomeType.PASSIVE);

    // Calculate Stock assets (балансовые активы - идут в net worth)
    const totalStockAssets = await this.calculateTotal(stockAssets, targetCurrency, 'asset');
    
    // Calculate Flow assets (потоковые доходы - идут в cash flow)
    const totalFlowIncome = await this.calculateTotal(flowAssets, targetCurrency, 'asset');
    
    // Calculate Active and Passive income separately
    const totalActiveIncome = await this.calculateTotal(activeIncomeAssets, targetCurrency, 'asset');
    const totalPassiveIncome = await this.calculateTotal(passiveIncomeAssets, targetCurrency, 'asset');
    
    // Calculate liabilities
    const totalLiabilities = await this.calculateTotal(liabilities, targetCurrency, 'liability');
    
    // Add crypto to stock assets (crypto is always stock)
    const cryptoValue = await this.calculateCryptoValue(cryptoWallets, targetCurrency);
    const totalBalanceAssets = totalStockAssets + cryptoValue;

    // Net worth = Stock assets - Liabilities
    const netWorth = totalBalanceAssets - totalLiabilities;

    // Calculate monthly expenses (from liabilities)
    const monthlyExpenses = await this.calculateMonthlyExpenses(liabilities, targetCurrency);

    // Runway (months of expenses covered by net worth)
    const runway = monthlyExpenses > 0 ? netWorth / monthlyExpenses : null;

    // FL-ratio (Financial Independence ratio)
    // Calculated from PASSIVE income only: how much passive income covers monthly expenses
    // FL-ratio = Passive Income / Monthly Expenses (shows coverage ratio)
    // If passive income >= monthly expenses, FL-ratio >= 1.0 (100%+ coverage)
    // This indicates financial independence (can cover expenses without active work)
    const flRatio = monthlyExpenses > 0 ? (totalPassiveIncome / monthlyExpenses) : null;

    // Asset distribution (only stock assets + crypto) - with currency conversion
    const stockAssetDistribution = await this.calculateAssetDistributionWithConversion(stockAssets, totalStockAssets, targetCurrency);
    
    // Flow income distribution - with currency conversion
    const flowIncomeDistribution = await this.calculateAssetDistributionWithConversion(flowAssets, totalFlowIncome, targetCurrency);

    // Combined asset distribution (stock + flow)
    const assetDistribution = { ...stockAssetDistribution, ...flowIncomeDistribution };

    // Liability distribution - with currency conversion
    const liabilityDistribution = await this.calculateLiabilityDistributionWithConversion(liabilities, totalLiabilities, targetCurrency);

    return {
      netWorth,
      totalStockAssets: totalBalanceAssets,  // балансовые активы + крипта
      totalFlowIncome,                       // потоковые доходы (все)
      totalActiveIncome,                     // активные доходы
      totalPassiveIncome,                    // пассивные доходы
      cryptoValue,
      totalLiabilities,
      monthlyExpenses,
      runway,
      flRatio,                               // рассчитывается только по пассивным доходам
      stockAssetDistribution,
      flowIncomeDistribution,
      assetDistribution, // Combined stock + flow distribution
      liabilityDistribution,
      currency: targetCurrency,
    };
  }

  async getCapitalHistory(userId: string, days: number = 30, targetCurrency: string = 'USD') {
    const history = [];
    const today = new Date();

    for (let i = days; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);

      const assets = await this.assetRepository
        .createQueryBuilder('asset')
        .where('asset.userId = :userId', { userId })
        .andWhere('asset.date <= :date', { date })
        .getMany();

      const liabilities = await this.liabilityRepository
        .createQueryBuilder('liability')
        .where('liability.userId = :userId', { userId })
        .andWhere('liability.date <= :date', { date })
        .getMany();

      const totalAssets = await this.calculateTotal(assets, targetCurrency, 'asset');
      const totalLiabilities = await this.calculateTotal(liabilities, targetCurrency, 'liability');
      const netWorth = totalAssets - totalLiabilities;

      history.push({
        date: date.toISOString().split('T')[0],
        netWorth,
        totalAssets,
        totalLiabilities,
      });
    }

    return history;
  }

  private async calculateTotal(
    items: Asset[] | Liability[],
    targetCurrency: string,
    type: 'asset' | 'liability',
  ): Promise<number> {
    let total = 0;

    for (const item of items) {
      let amount = parseFloat(item.amount.toString());
      const itemCurrency = item.currency || 'USD';

      if (itemCurrency !== targetCurrency) {
        try {
          amount = await this.currenciesService.convert(amount, itemCurrency, targetCurrency);
        } catch (error) {
          console.error(`Error converting ${itemCurrency} to ${targetCurrency}:`, error.message);
        }
      }

      total += amount;
    }

    return total;
  }

  private async calculateCryptoValue(
    wallets: CryptoWallet[],
    targetCurrency: string,
  ): Promise<number> {
    let total = 0;

    for (const wallet of wallets) {
      let valueUSD = 0;
      
      try {
        if (wallet.type === 'ethereum') {
          // Get ETH price
          const ethPrice = await this.cryptoPricesService.getPrice('ETH');
          const ethBalance = parseFloat(wallet.balance.toString());
          valueUSD += ethBalance * ethPrice;

          // Add token values
          if (wallet.tokens && Array.isArray(wallet.tokens)) {
            // Get all token contract addresses
            const tokenAddresses = wallet.tokens
              .map(token => token.contractAddress)
              .filter(addr => addr);

            if (tokenAddresses.length > 0) {
              const tokenPrices = await this.cryptoPricesService.getBulkTokenPrices(tokenAddresses);
              
              for (const token of wallet.tokens) {
                if (token.contractAddress && token.balance) {
                  const tokenPrice = tokenPrices[token.contractAddress.toLowerCase()] || 0;
                  const tokenBalance = parseFloat(token.balance.toString());
                  valueUSD += tokenBalance * tokenPrice;
                }
              }
            }
          }
        } else if (wallet.type === 'bitcoin') {
          // Get BTC price
          const btcPrice = await this.cryptoPricesService.getPrice('BTC');
          const btcBalance = parseFloat(wallet.balance.toString());
          valueUSD += btcBalance * btcPrice;
        }

        // Convert to target currency if needed
        if (targetCurrency !== 'USD' && valueUSD > 0) {
          try {
            valueUSD = await this.currenciesService.convert(valueUSD, 'USD', targetCurrency);
          } catch (error) {
            console.error(`Error converting crypto value to ${targetCurrency}:`, error.message);
          }
        }

        total += valueUSD;
      } catch (error) {
        console.error(`Error calculating value for wallet ${wallet.id}:`, error.message);
        // Continue with other wallets even if one fails
      }
    }

    return total;
  }

  private async calculateMonthlyExpenses(
    liabilities: Liability[],
    targetCurrency: string,
  ): Promise<number> {
    // Calculate average monthly expenses from liabilities
    // Regular categories: subscriptions, regular_expenses (use frequency)
    // Non-regular categories: loans, mortgage, credit_card, other (use deadline, not included in monthly)
    const regularCategories = ['subscriptions', 'regular_expenses'];
    const regularLiabilities = liabilities.filter((l) =>
      regularCategories.includes(l.category),
    );

    let totalMonthly = 0;

    for (const liability of regularLiabilities) {
      let amount = parseFloat(liability.amount.toString());
      const itemCurrency = liability.currency || 'USD';

      // Convert to target currency
      if (itemCurrency !== targetCurrency) {
        try {
          amount = await this.currenciesService.convert(amount, itemCurrency, targetCurrency);
        } catch (error) {
          console.error(`Error converting ${itemCurrency} to ${targetCurrency}:`, error.message);
        }
      }

      // Convert to monthly amount based on frequency
      if (liability.frequency) {
        switch (liability.frequency) {
          case 'daily':
            amount = amount * 30; // ~30 days per month
            break;
          case 'weekly':
            amount = amount * 4.33; // ~4.33 weeks per month
            break;
          case 'monthly':
            // Already monthly
            break;
          case 'quarterly':
            amount = amount / 3; // 3 months per quarter
            break;
          case 'yearly':
            amount = amount / 12; // 12 months per year
            break;
        }
      } else {
        // If no frequency specified, assume monthly for regular categories
        // (backward compatibility)
      }

      totalMonthly += amount;
    }

    return totalMonthly;
  }

  private async calculateAssetDistributionWithConversion(
    assets: Asset[],
    total: number,
    targetCurrency: string,
  ): Promise<Record<string, number>> {
    const distribution: Record<string, number> = {};

    for (const asset of assets) {
      let amount = parseFloat(asset.amount.toString());
      const itemCurrency = asset.currency || 'USD';

      // Convert to target currency
      if (itemCurrency !== targetCurrency) {
        try {
          amount = await this.currenciesService.convert(amount, itemCurrency, targetCurrency);
        } catch (error) {
          console.error(`Error converting ${itemCurrency} to ${targetCurrency}:`, error.message);
        }
      }

      if (!distribution[asset.category]) {
        distribution[asset.category] = 0;
      }
      distribution[asset.category] += amount;
    }

    // Convert to percentages
    const result: Record<string, number> = {};
    for (const [category, value] of Object.entries(distribution)) {
      result[category] = total > 0 ? (value / total) * 100 : 0;
    }

    return result;
  }

  private async calculateLiabilityDistributionWithConversion(
    liabilities: Liability[],
    total: number,
    targetCurrency: string,
  ): Promise<Record<string, number>> {
    const distribution: Record<string, number> = {};

    for (const liability of liabilities) {
      let amount = parseFloat(liability.amount.toString());
      const itemCurrency = liability.currency || 'USD';

      // Convert to target currency
      if (itemCurrency !== targetCurrency) {
        try {
          amount = await this.currenciesService.convert(amount, itemCurrency, targetCurrency);
        } catch (error) {
          console.error(`Error converting ${itemCurrency} to ${targetCurrency}:`, error.message);
        }
      }

      if (!distribution[liability.category]) {
        distribution[liability.category] = 0;
      }
      distribution[liability.category] += amount;
    }

    // Convert to percentages
    const result: Record<string, number> = {};
    for (const [category, value] of Object.entries(distribution)) {
      result[category] = total > 0 ? (value / total) * 100 : 0;
    }

    return result;
  }

  // Legacy methods kept for backward compatibility (deprecated)
  private calculateAssetDistribution(assets: Asset[], total: number): Record<string, number> {
    const distribution: Record<string, number> = {};

    for (const asset of assets) {
      const amount = parseFloat(asset.amount.toString());
      if (!distribution[asset.category]) {
        distribution[asset.category] = 0;
      }
      distribution[asset.category] += amount;
    }

    // Convert to percentages
    const result: Record<string, number> = {};
    for (const [category, value] of Object.entries(distribution)) {
      result[category] = total > 0 ? (value / total) * 100 : 0;
    }

    return result;
  }

  private calculateLiabilityDistribution(
    liabilities: Liability[],
    total: number,
  ): Record<string, number> {
    const distribution: Record<string, number> = {};

    for (const liability of liabilities) {
      const amount = parseFloat(liability.amount.toString());
      if (!distribution[liability.category]) {
        distribution[liability.category] = 0;
      }
      distribution[liability.category] += amount;
    }

    // Convert to percentages
    const result: Record<string, number> = {};
    for (const [category, value] of Object.entries(distribution)) {
      result[category] = total > 0 ? (value / total) * 100 : 0;
    }

    return result;
  }
}

