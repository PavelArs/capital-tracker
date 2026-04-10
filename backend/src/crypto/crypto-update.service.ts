import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import axios from 'axios';
import { PinoLogger } from 'nestjs-pino';
import { Repository } from 'typeorm';
import { CurrenciesService } from '../currencies/currencies.service';
import { CryptoType, CryptoWallet } from '../entities/crypto-wallet.entity';

@Injectable()
export class CryptoUpdateService {
  constructor(
    @InjectRepository(CryptoWallet)
    private cryptoWalletRepository: Repository<CryptoWallet>,
    private currenciesService: CurrenciesService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(CryptoUpdateService.name);
  }

  @Cron(CronExpression.EVERY_HOUR)
  async updateAllWallets() {
    const wallets = await this.cryptoWalletRepository.find();
    for (const wallet of wallets) {
      await this.updateWalletBalance(wallet.id);
    }
  }

  async updateWalletBalance(walletId: string) {
    const wallet = await this.cryptoWalletRepository.findOne({
      where: { id: walletId },
    });

    if (!wallet) {
      return;
    }

    try {
      if (wallet.type === CryptoType.ETHEREUM) {
        await this.updateEthereumWallet(wallet);
      } else if (wallet.type === CryptoType.BITCOIN) {
        await this.updateBitcoinWallet(wallet);
      }
    } catch (error) {
      this.logger.error({ walletId, error: error.message }, 'Error updating wallet');
    }
  }

  private async updateEthereumWallet(wallet: CryptoWallet) {
    try {
      const ethBalance = await this.getEthereumBalance(wallet.address);

      let tokens: any[] = [];
      try {
        tokens = await this.getEthereumTokens(wallet.address);
      } catch (tokenError) {
        this.logger.warn(
          { address: wallet.address, error: tokenError.message },
          'Error fetching tokens, continuing with ETH balance only',
        );
      }

      wallet.balance = ethBalance;
      wallet.tokens = tokens;
      wallet.lastUpdated = new Date();
      await this.cryptoWalletRepository.save(wallet);

      this.logger.info(
        { address: wallet.address, balance: ethBalance, tokenCount: tokens.length },
        'Updated Ethereum wallet',
      );
    } catch (error) {
      this.logger.error(
        { address: wallet.address, error: error.message },
        'Error updating Ethereum wallet',
      );
      throw error;
    }
  }

  private async updateBitcoinWallet(wallet: CryptoWallet) {
    try {
      const response = await axios.get(`https://blockstream.info/api/address/${wallet.address}`);

      const balance =
        response.data.chain_stats.funded_txo_sum - response.data.chain_stats.spent_txo_sum;
      wallet.balance = balance / 100000000;
      wallet.lastUpdated = new Date();
      await this.cryptoWalletRepository.save(wallet);
    } catch (error) {
      this.logger.error(
        { address: wallet.address, error: error.message },
        'Error updating Bitcoin wallet',
      );
    }
  }

  private async getEthereumBalance(address: string): Promise<number> {
    const normalizedAddress = address.startsWith('0x') ? address : `0x${address}`;

    const endpoints = [
      { url: 'https://eth.llamarpc.com', type: 'rpc' },
      { url: 'https://rpc.ankr.com/eth', type: 'rpc' },
      { url: 'https://ethereum.publicnode.com', type: 'rpc' },
    ];

    for (const endpoint of endpoints) {
      try {
        if (endpoint.type === 'rpc') {
          const response = await axios.post(
            endpoint.url,
            {
              jsonrpc: '2.0',
              method: 'eth_getBalance',
              params: [normalizedAddress.toLowerCase(), 'latest'],
              id: 1,
            },
            { timeout: 10000 },
          );

          if (response.data?.result && response.data.result !== '0x') {
            const balanceWei = BigInt(response.data.result);
            const ethBalance = Number(balanceWei) / 1e18;
            return ethBalance;
          }
        }
      } catch (_error) {
        this.logger.debug({ endpoint: endpoint.url }, 'Failed to get balance, trying next');
      }
    }

    // Fallback: Etherscan API
    try {
      const response = await axios.get(
        `https://api.etherscan.io/api?module=account&action=balance&address=${normalizedAddress}&tag=latest`,
        { timeout: 10000 },
      );
      if (response.data?.status === '1' && response.data.result) {
        const balanceWei = BigInt(response.data.result);
        return Number(balanceWei) / 1e18;
      }
    } catch (e) {
      this.logger.error({ error: e.message }, 'Error fetching ETH balance from Etherscan');
    }

    this.logger.error(
      { address: normalizedAddress },
      'Failed to fetch ETH balance from all endpoints',
    );
    return 0;
  }

  private async getEthereumTokens(address: string): Promise<any[]> {
    const normalizedAddress = address.startsWith('0x') ? address : `0x${address}`;

    try {
      const currencies = await this.currenciesService.findAll();
      const tokenCurrencies = currencies.filter((c) => c.contractAddress?.startsWith('0x'));

      if (tokenCurrencies.length === 0) {
        return [];
      }

      const balancePromises = tokenCurrencies.map(async (currency) => {
        try {
          const balance = await this.getERC20TokenBalance(
            normalizedAddress,
            currency.contractAddress,
          );
          return { currency, balance };
        } catch (error) {
          this.logger.error(
            { token: currency.code, contract: currency.contractAddress, error: error.message },
            'Error fetching token balance',
          );
          return { currency, balance: 0 };
        }
      });

      const balanceResults = await Promise.all(balancePromises);
      const tokens: any[] = [];

      for (const { currency, balance } of balanceResults) {
        if (balance > 0) {
          try {
            const decimals = (await this.getTokenDecimals(currency.contractAddress)) || 18;
            const formattedBalance = balance / 10 ** decimals;

            tokens.push({
              symbol: currency.code,
              name: currency.name,
              balance: formattedBalance,
              contractAddress: currency.contractAddress.toLowerCase(),
              decimals: decimals,
            });
          } catch (error) {
            this.logger.error(
              { token: currency.code, error: error.message },
              'Error getting token decimals',
            );
          }
        }
      }

      return tokens;
    } catch (error) {
      this.logger.error({ error: error.message }, 'Error fetching Ethereum tokens');
      return [];
    }
  }

  private async getERC20TokenBalance(
    walletAddress: string,
    contractAddress: string,
  ): Promise<number> {
    const functionSelector = '0x70a08231';
    const paddedAddress = walletAddress.toLowerCase().slice(2).padStart(64, '0');
    const data = functionSelector + paddedAddress;

    const normalizedContractAddress = contractAddress.startsWith('0x')
      ? contractAddress.toLowerCase()
      : `0x${contractAddress.toLowerCase()}`;

    const endpoints = [
      { url: 'https://eth.llamarpc.com', type: 'rpc' },
      { url: 'https://rpc.ankr.com/eth', type: 'rpc' },
      { url: 'https://ethereum.publicnode.com', type: 'rpc' },
    ];

    for (const endpoint of endpoints) {
      try {
        if (endpoint.type === 'rpc') {
          const response = await axios.post(
            endpoint.url,
            {
              jsonrpc: '2.0',
              method: 'eth_call',
              params: [{ to: normalizedContractAddress, data: data }, 'latest'],
              id: 1,
            },
            { timeout: 10000 },
          );

          if (response.data?.result && response.data.result !== '0x') {
            const balanceHex = response.data.result;
            if (balanceHex === '0x' || balanceHex === '0x0') {
              return 0;
            }
            const balanceWei = BigInt(balanceHex);
            return Number(balanceWei);
          }
        }
      } catch (_error) {
        this.logger.debug({ endpoint: endpoint.url }, 'Failed to get token balance, trying next');
      }
    }

    return 0;
  }

  private async getTokenDecimals(contractAddress: string): Promise<number | null> {
    const functionSelector = '0x313ce567';

    const normalizedContractAddress = contractAddress.startsWith('0x')
      ? contractAddress.toLowerCase()
      : `0x${contractAddress.toLowerCase()}`;

    const endpoints = [
      { url: 'https://eth.llamarpc.com', type: 'rpc' },
      { url: 'https://rpc.ankr.com/eth', type: 'rpc' },
      { url: 'https://ethereum.publicnode.com', type: 'rpc' },
    ];

    for (const endpoint of endpoints) {
      try {
        if (endpoint.type === 'rpc') {
          const response = await axios.post(
            endpoint.url,
            {
              jsonrpc: '2.0',
              method: 'eth_call',
              params: [{ to: normalizedContractAddress, data: functionSelector }, 'latest'],
              id: 1,
            },
            { timeout: 10000 },
          );

          if (response.data?.result && response.data.result !== '0x') {
            const decimalsHex = response.data.result;
            const decimals = Number.parseInt(decimalsHex, 16);
            return decimals;
          }
        }
      } catch (_error) {}
    }

    return null;
  }
}
