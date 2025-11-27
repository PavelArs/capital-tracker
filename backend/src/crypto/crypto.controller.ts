import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  UseGuards,
  Patch,
  ForbiddenException,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { CryptoService } from './crypto.service';
import { CreateCryptoWalletDto } from './dto/create-crypto-wallet.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SubscriptionGuard } from '../auth/guards/subscription.guard';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { SubscriptionType } from '../entities/subscription.entity';
import { CryptoType } from '../entities/crypto-wallet.entity';
import { CryptoPricesService, CryptoPrices } from './crypto-prices.service';
import { CurrentUser, JwtPayload } from '../shared/decorators';

@Controller('crypto')
@UseGuards(JwtAuthGuard, SubscriptionGuard)
export class CryptoController {
  constructor(
    private readonly cryptoService: CryptoService,
    private readonly cryptoPricesService: CryptoPricesService,
    private readonly subscriptionsService: SubscriptionsService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@CurrentUser() user: JwtPayload, @Body() createDto: CreateCryptoWalletDto) {
    // Check if user has PRO subscription for additional blockchains
    const allowedFreeTypes = [CryptoType.BITCOIN, CryptoType.ETHEREUM];
    if (!allowedFreeTypes.includes(createDto.type)) {
      const hasProAccess = await this.subscriptionsService.checkFeatureAccess(
        user.userId,
        SubscriptionType.PRO,
      );
      if (!hasProAccess) {
        throw new ForbiddenException('Additional blockchains require PRO subscription');
      }
    }
    return this.cryptoService.create(user.userId, createDto);
  }

  @Get()
  findAll(@CurrentUser() user: JwtPayload) {
    return this.cryptoService.findAll(user.userId);
  }

  @Get('prices')
  getPrices(): CryptoPrices {
    return this.cryptoPricesService.getAllPrices();
  }

  @Post('token-prices')
  @HttpCode(HttpStatus.OK)
  async getTokenPrices(@Body() body: { contractAddresses: string[] }) {
    return this.cryptoPricesService.getBulkTokenPrices(body.contractAddresses);
  }

  @Get(':id')
  findOne(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.cryptoService.findOne(id, user.userId);
  }

  @Patch(':id/update-balance')
  updateBalance(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.cryptoService.updateBalance(id, user.userId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.cryptoService.remove(id, user.userId);
  }
}
