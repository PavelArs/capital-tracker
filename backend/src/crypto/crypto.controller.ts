import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  UseGuards,
  Request,
  Patch,
  ForbiddenException,
} from '@nestjs/common';
import { CryptoService } from './crypto.service';
import { CreateCryptoWalletDto } from './dto/create-crypto-wallet.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SubscriptionGuard } from '../auth/guards/subscription.guard';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { SubscriptionType } from '../entities/subscription.entity';
import { CryptoType } from '../entities/crypto-wallet.entity';
import { CryptoPricesService, CryptoPrices } from './crypto-prices.service';

@Controller('crypto')
@UseGuards(JwtAuthGuard, SubscriptionGuard)
export class CryptoController {
  constructor(
    private readonly cryptoService: CryptoService,
    private readonly cryptoPricesService: CryptoPricesService,
    private readonly subscriptionsService: SubscriptionsService,
  ) {}

  @Post()
  async create(@Request() req, @Body() createDto: CreateCryptoWalletDto) {
    // Check if user has PRO subscription for additional blockchains
    const allowedFreeTypes = [CryptoType.BITCOIN, CryptoType.ETHEREUM];
    if (!allowedFreeTypes.includes(createDto.type)) {
      const hasProAccess = await this.subscriptionsService.checkFeatureAccess(
        req.user.userId,
        SubscriptionType.PRO,
      );
      if (!hasProAccess) {
        throw new ForbiddenException(
          'Additional blockchains require PRO subscription',
        );
      }
    }
    return this.cryptoService.create(req.user.userId, createDto);
  }

  @Get()
  findAll(@Request() req) {
    return this.cryptoService.findAll(req.user.userId);
  }

  @Get('prices')
  getPrices(): CryptoPrices {
    return this.cryptoPricesService.getAllPrices();
  }

  @Post('token-prices')
  async getTokenPrices(@Body() body: { contractAddresses: string[] }) {
    return this.cryptoPricesService.getBulkTokenPrices(body.contractAddresses);
  }

  @Get(':id')
  findOne(@Request() req, @Param('id') id: string) {
    return this.cryptoService.findOne(id, req.user.userId);
  }

  @Patch(':id/update-balance')
  updateBalance(@Request() req, @Param('id') id: string) {
    return this.cryptoService.updateBalance(id, req.user.userId);
  }

  @Delete(':id')
  remove(@Request() req, @Param('id') id: string) {
    return this.cryptoService.remove(id, req.user.userId);
  }
}

