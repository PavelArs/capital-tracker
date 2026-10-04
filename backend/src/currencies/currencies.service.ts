import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Currency } from '../entities/currency.entity';
import { UserCurrencyPreference } from '../entities/UserCurrencyPreference.entity';
import { CurrencyUpdateService } from './currency-update.service';

@Injectable()
export class CurrenciesService {
  constructor(
    @InjectRepository(Currency)
    private currencyRepository: Repository<Currency>,
    @InjectRepository(UserCurrencyPreference)
    private userCurrencyPreferenceRepository: Repository<UserCurrencyPreference>,
    private currencyUpdateService: CurrencyUpdateService,
  ) {}

  // Получить все валюты с учетом предпочтений пользователя
  async findAll(userId?: string): Promise<Currency[]> {
    const currencies = await this.currencyRepository.find({
      where: { isActive: true },
      order: { code: 'ASC' },
    });

    if (!userId) {
      return currencies;
    }

    // Получаем скрытые валюты пользователя
    const hiddenPreferences = await this.userCurrencyPreferenceRepository.find({
      where: { userId, isHidden: true },
    });

    const hiddenCurrencyIds = new Set(hiddenPreferences.map((pref) => pref.currencyId));

    // Фильтруем валюты, исключая скрытые
    return currencies.filter((currency) => !hiddenCurrencyIds.has(currency.id));
  }

  async findByCode(code: string): Promise<Currency> {
    const currency = await this.currencyRepository.findOne({ where: { code } });
    if (!currency) {
      throw new NotFoundException(`Currency with code ${code} not found`);
    }
    return currency;
  }

  async getExchangeRates(baseCurrency = 'USD') {
    return this.currencyUpdateService.getExchangeRates(baseCurrency);
  }

  async convert(amount: number, from: string, to: string): Promise<number> {
    if (from === to) {
      return amount;
    }

    try {
      // Get all rates in USD base
      const ratesInUSD = await this.getExchangeRates('USD');

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

  // Скрыть валюту для пользователя
  async hideCurrency(userId: string, currencyId: string): Promise<void> {
    // Проверяем, что валюта существует
    const currency = await this.currencyRepository.findOne({
      where: { id: currencyId },
    });

    if (!currency) {
      throw new NotFoundException(`Currency with ID ${currencyId} not found`);
    }

    if (!currency.isSystem) {
      throw new BadRequestException('Only system currencies can be hidden.');
    }

    // Проверяем, есть ли уже предпочтение
    let preference = await this.userCurrencyPreferenceRepository.findOne({
      where: { userId, currencyId },
    });

    if (preference) {
      preference.isHidden = true;
    } else {
      preference = this.userCurrencyPreferenceRepository.create({
        userId,
        currencyId,
        isHidden: true,
      });
    }

    await this.userCurrencyPreferenceRepository.save(preference);
  }

  // Показать валюту для пользователя
  async showCurrency(userId: string, currencyId: string): Promise<void> {
    const preference = await this.userCurrencyPreferenceRepository.findOne({
      where: { userId, currencyId },
    });

    if (preference) {
      preference.isHidden = false;
      await this.userCurrencyPreferenceRepository.save(preference);
    }
  }

  // Получить список скрытых валют пользователя
  async getHiddenCurrencies(userId: string): Promise<Currency[]> {
    const preferences = await this.userCurrencyPreferenceRepository.find({
      where: { userId, isHidden: true },
    });

    if (preferences.length === 0) {
      return [];
    }

    const currencyIds = preferences.map((pref) => pref.currencyId);

    // Загружаем валюты отдельным запросом
    const currencies = await this.currencyRepository
      .createQueryBuilder('currency')
      .whereInIds(currencyIds)
      .getMany();

    return currencies;
  }
}
