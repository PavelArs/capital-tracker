import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import axios from 'axios';
import { CryptoWallet, CryptoType } from '../entities/crypto-wallet.entity';

@Injectable()
export class CryptoUpdateService {
  constructor(
    @InjectRepository(CryptoWallet)
    private cryptoWalletRepository: Repository<CryptoWallet>,
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
        console.error('Error fetching tokens (continuing with ETH balance only):', tokenError.message);
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
      const response = await axios.get(
        `https://blockstream.info/api/address/${wallet.address}`,
      );
      
      const balance = response.data.chain_stats.funded_txo_sum - response.data.chain_stats.spent_txo_sum;
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

          if (response.data && response.data.result && response.data.result !== '0x') {
            // Use BigInt for large numbers to avoid precision loss
            const balanceWei = BigInt(response.data.result);
            // Convert wei to ETH with better precision handling
            const ethBalance = Number(balanceWei) / 1e18;
            return ethBalance;
          }
        }
      } catch (error) {
        console.log(`Failed to get balance from ${endpoint.url}, trying next...`);
        continue;
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

    console.error(`Failed to fetch ETH balance for address ${normalizedAddress} from all endpoints`);
    return 0; // Return 0 instead of throwing to allow wallet creation even if balance fetch fails
  }

  private async getEthereumTokens(address: string): Promise<any[]> {
    // Normalize address - remove 0x prefix for Ethplorer
    const normalizedAddress = address.startsWith('0x') ? address.slice(2) : address;
    
    try {
      // Using Ethplorer API (free tier, no key required for basic info)
      const response = await axios.get(
        `https://api.ethplorer.io/getAddressInfo/${normalizedAddress}?apiKey=freekey`,
        { timeout: 10000 },
      );

      const tokens: any[] = [];

      if (response.data && response.data.tokens) {
        for (const token of response.data.tokens) {
          if (token.tokenInfo && parseFloat(token.balance || '0') > 0) {
            const decimals = parseInt(token.tokenInfo.decimals || '18', 10);
            const balance = parseFloat(token.balance || '0') / Math.pow(10, decimals);
            
            tokens.push({
              symbol: token.tokenInfo.symbol || 'UNKNOWN',
              name: token.tokenInfo.name || 'Unknown Token',
              balance: balance,
              contractAddress: token.tokenInfo.address,
              decimals: decimals,
            });
          }
        }
      }

      return tokens;
    } catch (error) {
      console.error('Error fetching Ethereum tokens:', error.message);
      
      // Fallback: try Etherscan API for token balances (limited without API key)
      try {
        // Note: Etherscan free tier has very limited token support
        // For production, you'd need an API key
        return [];
      } catch (e) {
        console.error('Error fetching tokens from fallback:', e.message);
        return [];
      }
    }
  }
}

