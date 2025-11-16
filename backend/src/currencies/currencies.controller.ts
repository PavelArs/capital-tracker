import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  UseGuards,
} from "@nestjs/common";
import { CurrenciesService } from "./currencies.service";
import { CreateCurrencyDto } from "./dto/create-currency.dto";
import { UpdateCurrencyDto } from "./dto/update-currency.dto";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";

@Controller("currencies")
@UseGuards(JwtAuthGuard)
export class CurrenciesController {
  constructor(private readonly currenciesService: CurrenciesService) {}

  @Post()
  create(@Body() createCurrencyDto: CreateCurrencyDto) {
    return this.currenciesService.create(createCurrencyDto);
  }

  @Get("list")
  findAll() {
    return this.currenciesService.findAll();
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

  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.currenciesService.findOne(id);
  }

  @Patch(":id")
  update(
    @Param("id") id: string,
    @Body() updateCurrencyDto: UpdateCurrencyDto
  ) {
    return this.currenciesService.update(id, updateCurrencyDto);
  }

  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.currenciesService.remove(id);
  }

  @Get()
  getAllCurrencies() {
    return this.currenciesService.getAllCurrencies();
  }
}
