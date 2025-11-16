import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { CurrencyUpdateService } from "./currency-update.service";
import { Currency, CurrencyType } from "../entities/currency.entity";
import { CreateCurrencyDto } from "./dto/create-currency.dto";
import { UpdateCurrencyDto } from "./dto/update-currency.dto";

@Injectable()
export class CurrenciesService {
  constructor(
    @InjectRepository(Currency)
    private currencyRepository: Repository<Currency>,
    private currencyUpdateService: CurrencyUpdateService
  ) {}

  async create(createCurrencyDto: CreateCurrencyDto): Promise<Currency> {
    const currency = this.currencyRepository.create(createCurrencyDto);
    return this.currencyRepository.save(currency);
  }

  async findAll(): Promise<Currency[]> {
    return this.currencyRepository.find({
      where: { isActive: true },
      order: { code: "ASC" },
    });
  }

  async findOne(id: string): Promise<Currency> {
    const currency = await this.currencyRepository.findOne({ where: { id } });
    if (!currency) {
      throw new NotFoundException(`Currency with ID ${id} not found`);
    }
    return currency;
  }

  async findByCode(code: string): Promise<Currency> {
    const currency = await this.currencyRepository.findOne({ where: { code } });
    if (!currency) {
      throw new NotFoundException(`Currency with code ${code} not found`);
    }
    return currency;
  }

  async update(
    id: string,
    updateCurrencyDto: UpdateCurrencyDto
  ): Promise<Currency> {
    const currency = await this.findOne(id);
    Object.assign(currency, updateCurrencyDto);
    return this.currencyRepository.save(currency);
  }

  async remove(id: string): Promise<void> {
    const currency = await this.findOne(id);
    await this.currencyRepository.remove(currency);
  }

  async getExchangeRates(baseCurrency: string = "USD") {
    return this.currencyUpdateService.getExchangeRates(baseCurrency);
  }

  async convert(amount: number, from: string, to: string): Promise<number> {
    if (from === to) {
      return amount;
    }

    try {
      // Get all rates in USD base
      const ratesInUSD = await this.getExchangeRates("USD");

      const fromRateInUSD = ratesInUSD[from];
      const toRateInUSD = ratesInUSD[to];

      if (!fromRateInUSD) {
        throw new Error(`Currency ${from} not found`);
      }
      if (!toRateInUSD) {
        throw new Error(`Currency ${to} not found`);
      }

      // Convert: amount in FROM -> USD -> TO
      // fromRateInUSD: how many FROM units per 1 USD (e.g., 0.92 EUR per 1 USD)
      // toRateInUSD: how many TO units per 1 USD (e.g., 91.5 RUB per 1 USD)
      // Step 1: Convert FROM to USD
      const amountInUSD = amount / fromRateInUSD;
      // Step 2: Convert USD to TO
      const amountInTO = amountInUSD * toRateInUSD;

      return amountInTO;
    } catch (error) {
      console.error(`Error converting ${from} to ${to}:`, error.message);
      throw new Error(`Failed to convert ${from} to ${to}: ${error.message}`);
    }
  }

  async getAllCurrencies() {
    const rates = await this.getExchangeRates();
    return Object.keys(rates);
  }
}
