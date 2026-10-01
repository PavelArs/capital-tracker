import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { assertEmptyInput } from './display-fx-domain';
import { DisplayFxService } from './display-fx.service';

@Controller('reporting/usd-display')
export class DisplayFxController {
  constructor(private readonly fx: DisplayFxService) {}

  @Get()
  read(@Query() query: unknown) {
    return this.fx.read(query);
  }

  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() body: unknown, @Query() query: unknown) {
    assertEmptyInput(body);
    assertEmptyInput(query);
    return this.fx.collect();
  }
}
