import { Controller, Get, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser, OwnerIdentity } from '../shared/decorators';
import { ErrorResponseDto } from '../shared/dto';
import { MetricsService } from './metrics.service';

@ApiTags('metrics')
@ApiCookieAuth('__Host-ct-session')
@Controller('metrics')
export class MetricsController {
  constructor(private readonly metricsService: MetricsService) {}

  @Get()
  @ApiOperation({
    summary: 'Get financial metrics',
    description:
      'Get comprehensive financial metrics including total assets, liabilities, net worth, and breakdown by category',
  })
  @ApiQuery({
    name: 'currency',
    required: false,
    description: 'Currency code for conversion (default: USD)',
    example: 'USD',
  })
  @ApiResponse({
    status: 200,
    description: 'Metrics retrieved successfully',
    schema: {
      properties: {
        totalAssets: { type: 'number', example: 150000 },
        totalLiabilities: { type: 'number', example: 50000 },
        netWorth: { type: 'number', example: 100000 },
        assetsByCategory: { type: 'object' },
        liabilitiesByCategory: { type: 'object' },
        currency: { type: 'string', example: 'USD' },
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
    type: ErrorResponseDto,
  })
  getMetrics(@CurrentUser() user: OwnerIdentity, @Query('currency') currency?: string) {
    return this.metricsService.getMetrics(user.userId, currency || 'USD');
  }

  @Get('history')
  @ApiOperation({
    summary: 'Get capital history',
    description: 'Get historical data of net worth and capital over time',
  })
  @ApiQuery({
    name: 'days',
    required: false,
    description: 'Number of days to retrieve (default: 30)',
    example: '30',
  })
  @ApiQuery({
    name: 'currency',
    required: false,
    description: 'Currency code for conversion (default: USD)',
    example: 'USD',
  })
  @ApiResponse({
    status: 200,
    description: 'Capital history retrieved successfully',
    schema: {
      type: 'array',
      items: {
        properties: {
          date: { type: 'string', format: 'date' },
          netWorth: { type: 'number' },
          assets: { type: 'number' },
          liabilities: { type: 'number' },
        },
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
    type: ErrorResponseDto,
  })
  getCapitalHistory(
    @CurrentUser() user: OwnerIdentity,
    @Query('days') days?: string,
    @Query('currency') currency?: string,
  ) {
    return this.metricsService.getCapitalHistory(
      user.userId,
      days ? Number.parseInt(days, 10) : 30,
      currency || 'USD',
    );
  }
}
