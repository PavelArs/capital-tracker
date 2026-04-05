import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { Repository } from 'typeorm';
import { CryptoPricesService } from '../crypto/crypto-prices.service';
import { CurrenciesService } from '../currencies/currencies.service';
import { Asset, AssetType, IncomeType } from '../entities/asset.entity';
import { CryptoWallet } from '../entities/crypto-wallet.entity';
import { Liability } from '../entities/liability.entity';

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
    @InjectPinoLogger(MetricsService.name)
    private readonly logger: PinoLogger,
  ) {}

  async getMetrics(userId: string, targetCurrency = 'USD') {
    const assets = await this.assetRepository.find({
      where: { userId },
      relations: ['currency'],
    });
    const liabilities = await this.liabilityRepository.find({
      where: { userId },
      relations: ['currency'],
    });
    const cryptoWallets = await this.cryptoWalletRepository.find({
      where: { userId },
    });

    // Separate Stock and Flow assets
    const stockAssets = assets.filter((asset) => asset.assetType === AssetType.STOCK);
    const flowAssets = assets.filter((asset) => asset.assetType === AssetType.FLOW);

    // Separate Flow assets into active and passive income
    const activeIncomeAssets = flowAssets.filter((asset) => asset.incomeType === IncomeType.ACTIVE);
    const passiveIncomeAssets = flowAssets.filter(
      (asset) => asset.incomeType === IncomeType.PASSIVE,
    );

    // Calculate Stock assets (балансовые активы - идут в net worth)
    const totalStockAssets = await this.calculateTotal(stockAssets, targetCurrency);

    // Calculate Flow assets (потоковые доходы - идут в cash flow)
    const totalFlowIncome = await this.calculateTotal(flowAssets, targetCurrency);

    // Calculate Active and Passive income separately
    const totalActiveIncome = await this.calculateTotal(activeIncomeAssets, targetCurrency);
    const totalPassiveIncome = await this.calculateTotal(passiveIncomeAssets, targetCurrency);

    // Calculate liabilities
    const totalLiabilities = await this.calculateTotal(liabilities, targetCurrency);

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
    const flRatio = monthlyExpenses > 0 ? totalPassiveIncome / monthlyExpenses : null;

    // Asset distribution (only stock assets + crypto) - with currency conversion
    const stockAssetDistribution = await this.calculateAssetDistributionWithConversion(
      stockAssets,
      totalStockAssets,
      targetCurrency,
    );

    // Flow income distribution - with currency conversion
    const flowIncomeDistribution = await this.calculateAssetDistributionWithConversion(
      flowAssets,
      totalFlowIncome,
      targetCurrency,
    );

    // Combined asset distribution (stock + flow)
    const assetDistribution = {
      ...stockAssetDistribution,
      ...flowIncomeDistribution,
    };

    // Liability distribution - with currency conversion
    const liabilityDistribution = await this.calculateLiabilityDistributionWithConversion(
      liabilities,
      totalLiabilities,
      targetCurrency,
    );

    return {
      netWorth,
      totalStockAssets: totalBalanceAssets, // балансовые активы + крипта
      totalFlowIncome, // потоковые доходы (все)
      totalActiveIncome, // активные доходы
      totalPassiveIncome, // пассивные доходы
      cryptoValue,
      totalLiabilities,
      monthlyExpenses,
      runway,
      flRatio, // рассчитывается только по пассивным доходам
      stockAssetDistribution,
      flowIncomeDistribution,
      assetDistribution, // Combined stock + flow distribution
      liabilityDistribution,
      currency: targetCurrency,
    };
  }

  async getCapitalHistory(userId: string, days = 30, targetCurrency = 'USD') {
    const history = [];
    const today = new Date();

    for (let i = days; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);

      const assets = await this.assetRepository
        .createQueryBuilder('asset')
        .leftJoinAndSelect('asset.currency', 'currency')
        .where('asset.userId = :userId', { userId })
        .andWhere('asset.date <= :date', { date })
        .getMany();

      const liabilities = await this.liabilityRepository
        .createQueryBuilder('liability')
        .leftJoinAndSelect('liability.currency', 'liabilityCurrency')
        .where('liability.userId = :userId', { userId })
        .andWhere('liability.date <= :date', { date })
        .getMany();

      const totalAssets = await this.calculateTotal(assets, targetCurrency);
      const totalLiabilities = await this.calculateTotal(liabilities, targetCurrency);
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
  ): Promise<number> {
    let total = 0;

    for (const item of items) {
      let amount = Number.parseFloat(item.amount.toString());
      const itemCurrency = item.currency?.code || 'USD';

      if (itemCurrency !== targetCurrency) {
        try {
          amount = await this.currenciesService.convert(amount, itemCurrency, targetCurrency);
        } catch (error) {
          this.logger.error(
            { err: error, from: itemCurrency, to: targetCurrency },
            'Error converting currency',
          );
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

    if (wallets.length === 0) {
      return 0;
    }

    for (const wallet of wallets) {
      let valueUSD = 0;

      try {
        if (wallet.type === 'ethereum') {
          // Get ETH price
          const ethPrice = await this.cryptoPricesService.getPrice('ETH');
          const ethBalance = Number.parseFloat(wallet.balance.toString());

          const ethValue = ethBalance * ethPrice;
          this.logger.info(
            { walletId: wallet.id, address: wallet.address, ethBalance, ethPrice, ethValue },
            'Calculated ETH wallet value',
          );

          if (ethPrice === 0) {
            this.logger.warn({ walletId: wallet.id, ethBalance }, 'ETH price is 0');
          }

          valueUSD += ethValue;

          // Add token values
          if (wallet.tokens && Array.isArray(wallet.tokens)) {
            this.logger.info(
              { walletId: wallet.id, tokenCount: wallet.tokens.length },
              'Found tokens in wallet',
            );

            // Get all token contract addresses
            const tokenAddresses = wallet.tokens
              .map((token) => token.contractAddress)
              .filter((addr) => addr);

            if (tokenAddresses.length > 0) {
              this.logger.info(
                { walletId: wallet.id, tokenCount: tokenAddresses.length, tokenAddresses },
                'Fetching token prices',
              );
              const tokenPrices = await this.cryptoPricesService.getBulkTokenPrices(tokenAddresses);
              this.logger.info({ walletId: wallet.id, tokenPrices }, 'Received token prices');

              for (const token of wallet.tokens) {
                if (token.contractAddress && token.balance) {
                  const tokenPrice = tokenPrices[token.contractAddress.toLowerCase()] || 0;
                  const tokenBalance = Number.parseFloat(token.balance.toString());
                  const tokenValue = tokenBalance * tokenPrice;

                  this.logger.info(
                    {
                      symbol: token.symbol,
                      contractAddress: token.contractAddress,
                      tokenBalance,
                      tokenPrice,
                      tokenValue,
                    },
                    'Calculated token value',
                  );

                  if (tokenPrice === 0 && tokenBalance > 0) {
                    this.logger.warn(
                      {
                        symbol: token.symbol,
                        contractAddress: token.contractAddress,
                        tokenBalance,
                      },
                      'Token price is 0 with positive balance',
                    );
                  }

                  valueUSD += tokenValue;
                }
              }
            } else {
              this.logger.info({ walletId: wallet.id }, 'No token contract addresses found');
            }
          } else {
            this.logger.info({ walletId: wallet.id }, 'No tokens found in wallet');
          }
        } else if (wallet.type === 'bitcoin') {
          // Get BTC price
          const btcPrice = await this.cryptoPricesService.getPrice('BTC');
          const btcBalance = Number.parseFloat(wallet.balance.toString());
          const btcValue = btcBalance * btcPrice;

          this.logger.info(
            { walletId: wallet.id, address: wallet.address, btcBalance, btcPrice, btcValue },
            'Calculated BTC wallet value',
          );

          if (btcPrice === 0) {
            this.logger.warn({ walletId: wallet.id, btcBalance }, 'BTC price is 0');
          }

          valueUSD += btcValue;
        }

        this.logger.info({ walletId: wallet.id, valueUSD }, 'Wallet value before conversion');

        // Convert to target currency if needed
        if (targetCurrency !== 'USD' && valueUSD > 0) {
          try {
            const convertedValue = await this.currenciesService.convert(
              valueUSD,
              'USD',
              targetCurrency,
            );
            this.logger.info(
              { walletId: wallet.id, fromValue: valueUSD, targetCurrency, convertedValue },
              'Converted wallet value to target currency',
            );
            valueUSD = convertedValue;
          } catch (error) {
            this.logger.error({ err: error, targetCurrency }, 'Error converting crypto value');
          }
        }

        this.logger.info({ walletId: wallet.id, finalValue: valueUSD }, 'Wallet final value');
        total += valueUSD;
      } catch (error) {
        this.logger.error({ err: error, walletId: wallet.id }, 'Error calculating wallet value');
        // Continue with other wallets even if one fails
      }
    }

    if (total === 0 && wallets.length > 0) {
      this.logger.warn(
        { walletCount: wallets.length },
        'Total crypto value is 0, this might indicate price fetching issues',
      );
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
    const regularLiabilities = liabilities.filter((l) => regularCategories.includes(l.category));

    let totalMonthly = 0;

    for (const liability of regularLiabilities) {
      let amount = Number.parseFloat(liability.amount.toString());
      const itemCurrency = liability.currency?.code || 'USD';

      // Convert to target currency
      if (itemCurrency !== targetCurrency) {
        try {
          amount = await this.currenciesService.convert(amount, itemCurrency, targetCurrency);
        } catch (error) {
          this.logger.error(
            { err: error, from: itemCurrency, to: targetCurrency },
            'Error converting currency',
          );
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
      let amount = Number.parseFloat(asset.amount.toString());
      const itemCurrency = asset.currency?.code || 'USD';

      // Convert to target currency
      if (itemCurrency !== targetCurrency) {
        try {
          amount = await this.currenciesService.convert(amount, itemCurrency, targetCurrency);
        } catch (error) {
          this.logger.error(
            { err: error, from: itemCurrency, to: targetCurrency },
            'Error converting currency',
          );
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
      let amount = Number.parseFloat(liability.amount.toString());
      const itemCurrency = liability.currency?.code || 'USD';

      // Convert to target currency
      if (itemCurrency !== targetCurrency) {
        try {
          amount = await this.currenciesService.convert(amount, itemCurrency, targetCurrency);
        } catch (error) {
          this.logger.error(
            { err: error, from: itemCurrency, to: targetCurrency },
            'Error converting currency',
          );
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
}
