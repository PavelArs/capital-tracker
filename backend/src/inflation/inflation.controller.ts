import { Body, Controller, Delete, Get, Param, Put, Query } from '@nestjs/common';
import { CurrentUser, OwnerIdentity } from '../shared/decorators';
import { InflationService } from './inflation.service';

@Controller('inflation')
export class InflationController {
  constructor(private readonly inflation: InflationService) {}

  @Get()
  overview(@CurrentUser() owner: OwnerIdentity) {
    return this.inflation.overview(owner.userId);
  }

  @Get('factor')
  factor(@CurrentUser() owner: OwnerIdentity, @Query() query: unknown) {
    return this.inflation.factor(owner.userId, query);
  }

  @Put('personal-rates/:currency')
  setPersonalRate(
    @CurrentUser() owner: OwnerIdentity,
    @Param('currency') currency: string,
    @Body() input: unknown,
  ) {
    return this.inflation.setPersonalRate(owner.userId, currency, input);
  }

  @Put('months/:currency/:month')
  setMonth(
    @CurrentUser() owner: OwnerIdentity,
    @Param('currency') currency: string,
    @Param('month') month: string,
    @Body() input: unknown,
  ) {
    return this.inflation.setMonth(owner.userId, currency, month, input);
  }

  @Delete('months/:currency/:month')
  removeMonth(
    @CurrentUser() owner: OwnerIdentity,
    @Param('currency') currency: string,
    @Param('month') month: string,
  ) {
    return this.inflation.removeMonth(owner.userId, currency, month);
  }
}
