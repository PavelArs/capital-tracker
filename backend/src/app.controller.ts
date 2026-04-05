import { Controller, Get } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  @ApiExcludeEndpoint()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('health')
  @ApiTags('health')
  @ApiOperation({
    summary: 'Simple health check',
    description: 'Returns basic health status of the API',
  })
  @ApiResponse({
    status: 200,
    description: 'API is healthy',
    schema: {
      properties: {
        status: { type: 'string', example: 'ok' },
        timestamp: { type: 'string', format: 'date-time' },
        service: { type: 'string', example: 'capital-tracker-backend' },
      },
    },
  })
  health() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      service: 'capital-tracker-backend',
    };
  }
}
