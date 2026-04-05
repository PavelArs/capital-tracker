import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import axios from 'axios';
import { Repository } from 'typeorm';
import { CurrenciesService } from '../currencies/currencies.service';
import { CryptoType, CryptoWallet } from '../entities/crypto-wallet.entity';

@Injectable()
export class CryptoUpdateService {
  constructor(
    @InjectRepository(CryptoWallet)
    private cryptoWalletRepository: Repository<CryptoWallet>,
    private currenciesService: CurrenciesService,
  ) {}

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
      console.error(`Error updating wallet ${walletId}:`, error.message);
    }
  }

  private async updateEthereumWallet(wallet: CryptoWallet) {
    try {
      // Get ETH balance
      const ethBalance = await this.getEthereumBalance(wallet.address);

      // Get ERC-20 tokens
      let tokens: any[] = [];
      try {
        tokens = await this.getEthereumTokens(wallet.address);
      } catch (tokenError) {
        console.error(
          'Error fetching tokens (continuing with ETH balance only):',
          tokenError.message,
        );
        // Continue even if tokens fail - at least we have ETH balance
      }

      wallet.balance = ethBalance;
      wallet.tokens = tokens;
      wallet.lastUpdated = new Date();
      await this.cryptoWalletRepository.save(wallet);

      console.log(`Updated wallet ${wallet.address}: ${ethBalance} ETH, ${tokens.length} tokens`);
    } catch (error) {
      console.error(`Error updating Ethereum wallet ${wallet.address}:`, error.message);
      throw error; // Re-throw to allow caller to handle
    }
  }

  private async updateBitcoinWallet(wallet: CryptoWallet) {
    try {
      // Using Blockstream API (public, no key required)
      const response = await axios.get(`https://blockstream.info/api/address/${wallet.address}`);

      const balance =
        response.data.chain_stats.funded_txo_sum - response.data.chain_stats.spent_txo_sum;
      wallet.balance = balance / 100000000; // Convert satoshi to BTC
      wallet.lastUpdated = new Date();
      await this.cryptoWalletRepository.save(wallet);
    } catch (error) {
      console.error('Error updating Bitcoin wallet:', error.message);
    }
  }

  private async getEthereumBalance(address: string): Promise<number> {
    // Normalize address - ensure it has 0x prefix
    const normalizedAddress = address.startsWith('0x') ? address : `0x${address}`;

    // Try multiple endpoints for reliability
    const endpoints = [
      // Public RPC endpoints
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
            // Use BigInt for large numbers to avoid precision loss
            const balanceWei = BigInt(response.data.result);
            // Convert wei to ETH with better precision handling
            const ethBalance = Number(balanceWei) / 1e18;
            return ethBalance;
          }
        }
      } catch (_error) {
        console.log(`Failed to get balance from ${endpoint.url}, trying next...`);
      }
    }

    // Fallback: try Etherscan API (no key required for basic balance)
    try {
      const response = await axios.get(
        `https://api.etherscan.io/api?module=account&action=balance&address=${normalizedAddress}&tag=latest`,
        { timeout: 10000 },
      );
      if (response.data && response.data.status === '1' && response.data.result) {
        const balanceWei = BigInt(response.data.result);
        return Number(balanceWei) / 1e18;
      }
    } catch (e) {
      console.error('Error fetching ETH balance from Etherscan:', e.message);
    }

    console.error(
      `Failed to fetch ETH balance for address ${normalizedAddress} from all endpoints`,
    );
    return 0; // Return 0 instead of throwing to allow wallet creation even if balance fetch fails
  }

  private async getEthereumTokens(address: string): Promise<any[]> {
    // Normalize address - ensure it has 0x prefix
    const normalizedAddress = address.startsWith('0x') ? address : `0x${address}`;

    try {
      // Get list of active currencies from settings with contract addresses
      const currencies = await this.currenciesService.findAll();

      // Filter currencies that have contract addresses (ERC-20 tokens)
      const tokenCurrencies = currencies.filter((c) => c.contractAddress?.startsWith('0x'));

      if (tokenCurrencies.length === 0) {
        return [];
      }

      // Fetch all token balances in parallel for better performance
      const balancePromises = tokenCurrencies.map(async (currency) => {
        try {
          const balance = await this.getERC20TokenBalance(
            normalizedAddress,
            currency.contractAddress,
          );
          return { currency, balance };
        } catch (error) {
          console.error(
            `Error fetching balance for token ${currency.code} (${currency.contractAddress}):`,
            error.message,
          );
          return { currency, balance: 0 };
        }
      });

      const balanceResults = await Promise.all(balancePromises);
      const tokens: any[] = [];

      // Process only tokens with non-zero balance
      for (const { currency, balance } of balanceResults) {
        if (balance > 0) {
          try {
            // Get token decimals (default to 18 if not available)
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
            console.error(`Error getting decimals for token ${currency.code}:`, error.message);
            // Skip this token if we can't get decimals
          }
        }
      }

      return tokens;
    } catch (error) {
      console.error('Error fetching Ethereum tokens:', error.message);
      return [];
    }
  }

  private async getERC20TokenBalance(
    walletAddress: string,
    contractAddress: string,
  ): Promise<number> {
    // ERC-20 balanceOf function signature: balanceOf(address) -> uint256
    // Function selector: 0x70a08231
    const functionSelector = '0x70a08231';

    // Pad wallet address to 32 bytes (64 hex chars)
    const paddedAddress = walletAddress.toLowerCase().slice(2).padStart(64, '0');
    const data = functionSelector + paddedAddress;

    const normalizedContractAddress = contractAddress.startsWith('0x')
      ? contractAddress.toLowerCase()
      : `0x${contractAddress.toLowerCase()}`;

    // Try multiple endpoints for reliability
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
              params: [
                {
                  to: normalizedContractAddress,
                  data: data,
                },
                'latest',
              ],
              id: 1,
            },
            { timeout: 10000 },
          );

          if (response.data?.result && response.data.result !== '0x') {
            // Parse hex result to number
            const balanceHex = response.data.result;
            if (balanceHex === '0x' || balanceHex === '0x0') {
              return 0;
            }
            const balanceWei = BigInt(balanceHex);
            return Number(balanceWei);
          }
        }
      } catch (_error) {
        console.log(`Failed to get token balance from ${endpoint.url}, trying next...`);
      }
    }

    return 0;
  }

  private async getTokenDecimals(contractAddress: string): Promise<number | null> {
    // ERC-20 decimals() function signature: decimals() -> uint8
    // Function selector: 0x313ce567
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
              params: [
                {
                  to: normalizedContractAddress,
                  data: functionSelector,
                },
                'latest',
              ],
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

    return null; // Return null if decimals cannot be fetched
  }
}
