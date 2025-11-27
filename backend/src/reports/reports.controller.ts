import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SubscriptionGuard, RequireSubscription } from '../auth/guards/subscription.guard';
import { SubscriptionType } from '../entities/subscription.entity';
import { ReportsService } from './reports.service';
import { CreateReportDto } from './dto/create-report.dto';
import { CurrentUser, JwtPayload } from '../shared/decorators';

@Controller('reports')
@UseGuards(JwtAuthGuard, SubscriptionGuard)
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequireSubscription(SubscriptionType.ENTERPRISE)
  async create(@CurrentUser() user: JwtPayload, @Body() createDto: CreateReportDto) {
    return this.reportsService.create(user.userId, createDto);
  }

  @Get()
  @RequireSubscription(SubscriptionType.ENTERPRISE)
  async findAll(@CurrentUser() user: JwtPayload) {
    return this.reportsService.findAll(user.userId);
  }

  @Get(':id')
  @RequireSubscription(SubscriptionType.ENTERPRISE)
  async findOne(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.reportsService.findOne(id, user.userId);
  }

  @Post(':id/generate')
  @HttpCode(HttpStatus.OK)
  @RequireSubscription(SubscriptionType.ENTERPRISE)
  async generateReport(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.reportsService.generateReport(id, user.userId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @RequireSubscription(SubscriptionType.ENTERPRISE)
  async remove(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    await this.reportsService.remove(id, user.userId);
    return { message: 'Report deleted successfully' };
  }
}
