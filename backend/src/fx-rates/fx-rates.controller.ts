import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { FxRatesService } from './fx-rates.service';

/** `?date=YYYY-MM-DD` asks for the rates effective on that Moscow date instead of today. */
export function parseRateDate(query: unknown): string | undefined {
  const keys = query && typeof query === 'object' ? Object.keys(query) : [];
  if (keys.some((key) => key !== 'date')) throw new BadRequestException('Invalid rate date');
  const date = (query as { date?: unknown } | undefined)?.date;
  if (date === undefined) return undefined;
  if (
    typeof date !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    Number.isNaN(Date.parse(`${date}T00:00:00Z`)) ||
    new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date ||
    date < '1992-07-01'
  )
    throw new BadRequestException('Invalid rate date');
  return date;
}

@Controller('fx-rates')
export class FxRatesController {
  constructor(private readonly rates: FxRatesService) {}

  @Get()
  read(@Query() query: unknown) {
    return this.rates.read(new Date(), parseRateDate(query));
  }
}
