import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { MetricsService } from './metrics.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser, JwtPayload } from '../shared/decorators';

@Controller('metrics')
@UseGuards(JwtAuthGuard)
export class MetricsController {
  constructor(private readonly metricsService: MetricsService) {}

  @Get()
  getMetrics(@CurrentUser() user: JwtPayload, @Query('currency') currency?: string) {
    return this.metricsService.getMetrics(user.userId, currency || 'USD');
  }

  @Get('history')
  getCapitalHistory(
    @CurrentUser() user: JwtPayload,
    @Query('days') days?: string,
    @Query('currency') currency?: string,
  ) {
    return this.metricsService.getCapitalHistory(
      user.userId,
      days ? parseInt(days, 10) : 30,
      currency || 'USD',
    );
  }
}
