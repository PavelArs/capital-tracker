import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  UseGuards,
  Req,
} from "@nestjs/common";
import { CurrenciesService } from "./currencies.service";
import { ToggleCurrencyDto } from "./dto/toggle-currency.dto";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";

@Controller("currencies")
@UseGuards(JwtAuthGuard)
export class CurrenciesController {
  constructor(private readonly currenciesService: CurrenciesService) {}

  @Get("list")
  findAll(@Req() req) {
    const userId = req.user?.userId;
    return this.currenciesService.findAll(userId);
  }

  @Get("rates")
  getExchangeRates(@Query("base") base?: string) {
    return this.currenciesService.getExchangeRates(base || "USD");
  }

  @Get("convert")
  convert(
    @Query("amount") amount: string,
    @Query("from") from: string,
    @Query("to") to: string
  ) {
    return this.currenciesService.convert(parseFloat(amount), from, to);
  }

  // Получить список скрытых валют пользователя
  @Get("hidden")
  async getHiddenCurrencies(@Req() req) {
    const userId = req.user.userId;
    return this.currenciesService.getHiddenCurrencies(userId);
  }

  @Get()
  getAllCurrencies() {
    return this.currenciesService.getAllCurrencies();
  }

  // Скрыть системную валюту для пользователя
  @Post("hide")
  async hideCurrency(@Req() req, @Body() toggleDto: ToggleCurrencyDto) {
    const userId = req.user.userId;
    await this.currenciesService.hideCurrency(userId, toggleDto.currencyId);
    return { message: "Currency hidden successfully" };
  }

  // Показать системную валюту для пользователя
  @Post("show")
  async showCurrency(@Req() req, @Body() toggleDto: ToggleCurrencyDto) {
    const userId = req.user.userId;
    await this.currenciesService.showCurrency(userId, toggleDto.currencyId);
    return { message: "Currency shown successfully" };
  }

  // Переключить видимость валюты (универсальный эндпоинт)
  @Post("toggle")
  async toggleCurrency(@Req() req, @Body() toggleDto: ToggleCurrencyDto) {
    const userId = req.user.userId;
    if (toggleDto.isHidden) {
      await this.currenciesService.hideCurrency(userId, toggleDto.currencyId);
    } else {
      await this.currenciesService.showCurrency(userId, toggleDto.currencyId);
    }
    return { message: "Currency visibility toggled successfully" };
  }
}
