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
} from '@nestjs/common';
import { CryptoService } from './crypto.service';
import { CreateCryptoWalletDto } from './dto/create-crypto-wallet.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CryptoPricesService, CryptoPrices } from './crypto-prices.service';

@Controller('crypto')
@UseGuards(JwtAuthGuard)
export class CryptoController {
  constructor(
    private readonly cryptoService: CryptoService,
    private readonly cryptoPricesService: CryptoPricesService,
  ) {}

  @Post()
  create(@Request() req, @Body() createDto: CreateCryptoWalletDto) {
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

