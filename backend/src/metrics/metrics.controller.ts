import { Controller, Get, Query, UseGuards, Request } from '@nestjs/common';
import { MetricsService } from './metrics.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('metrics')
@UseGuards(JwtAuthGuard)
export class MetricsController {
  constructor(private readonly metricsService: MetricsService) {}

  @Get()
  getMetrics(@Request() req, @Query('currency') currency?: string) {
    return this.metricsService.getMetrics(req.user.userId, currency || 'USD');
  }

  @Get('history')
  getCapitalHistory(
    @Request() req,
    @Query('days') days?: string,
    @Query('currency') currency?: string,
  ) {
    return this.metricsService.getCapitalHistory(
      req.user.userId,
      days ? parseInt(days) : 30,
      currency || 'USD',
    );
  }
}

