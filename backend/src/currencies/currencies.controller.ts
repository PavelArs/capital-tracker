import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { CurrenciesService } from './currencies.service';
import { ToggleCurrencyDto } from './dto/toggle-currency.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser, JwtPayload } from '../shared/decorators';

@Controller('currencies')
@UseGuards(JwtAuthGuard)
export class CurrenciesController {
  constructor(private readonly currenciesService: CurrenciesService) {}

  @Get('list')
  findAll(@CurrentUser() user: JwtPayload) {
    return this.currenciesService.findAll(user.userId);
  }

  @Get('rates')
  getExchangeRates(@Query('base') base?: string) {
    return this.currenciesService.getExchangeRates(base || 'USD');
  }

  @Get('convert')
  convert(
    @Query('amount') amount: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.currenciesService.convert(parseFloat(amount), from, to);
  }

  @Get('hidden')
  async getHiddenCurrencies(@CurrentUser() user: JwtPayload) {
    return this.currenciesService.getHiddenCurrencies(user.userId);
  }

  @Get()
  getAllCurrencies() {
    return this.currenciesService.getAllCurrencies();
  }

  @Post('hide')
  @HttpCode(HttpStatus.OK)
  async hideCurrency(
    @CurrentUser() user: JwtPayload,
    @Body() toggleDto: ToggleCurrencyDto,
  ) {
    await this.currenciesService.hideCurrency(user.userId, toggleDto.currencyId);
    return { message: 'Currency hidden successfully' };
  }

  @Post('show')
  @HttpCode(HttpStatus.OK)
  async showCurrency(
    @CurrentUser() user: JwtPayload,
    @Body() toggleDto: ToggleCurrencyDto,
  ) {
    await this.currenciesService.showCurrency(user.userId, toggleDto.currencyId);
    return { message: 'Currency shown successfully' };
  }

  @Post('toggle')
  @HttpCode(HttpStatus.OK)
  async toggleCurrency(
    @CurrentUser() user: JwtPayload,
    @Body() toggleDto: ToggleCurrencyDto,
  ) {
    if (toggleDto.isHidden) {
      await this.currenciesService.hideCurrency(user.userId, toggleDto.currencyId);
    } else {
      await this.currenciesService.showCurrency(user.userId, toggleDto.currencyId);
    }
    return { message: 'Currency visibility toggled successfully' };
  }
}
