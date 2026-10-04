import { Controller, Get } from '@nestjs/common';
import { FxRatesService } from './fx-rates.service';

@Controller('fx-rates')
export class FxRatesController {
  constructor(private readonly rates: FxRatesService) {}

  @Get()
  read() {
    return this.rates.read();
  }
}
