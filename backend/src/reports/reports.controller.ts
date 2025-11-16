import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  UseGuards,
  Request,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SubscriptionGuard, RequireSubscription } from '../auth/guards/subscription.guard';
import { SubscriptionType } from '../entities/subscription.entity';
import { ReportsService } from './reports.service';
import { CreateReportDto } from './dto/create-report.dto';

@Controller('reports')
@UseGuards(JwtAuthGuard, SubscriptionGuard)
export class ReportsController {
  constructor(private reportsService: ReportsService) {}

  @Post()
  @RequireSubscription(SubscriptionType.ENTERPRISE)
  async create(@Request() req, @Body() createDto: CreateReportDto) {
    return this.reportsService.create(req.user.userId, createDto);
  }

  @Get()
  @RequireSubscription(SubscriptionType.ENTERPRISE)
  async findAll(@Request() req) {
    return this.reportsService.findAll(req.user.userId);
  }

  @Get(':id')
  @RequireSubscription(SubscriptionType.ENTERPRISE)
  async findOne(@Request() req, @Param('id') id: string) {
    return this.reportsService.findOne(id, req.user.userId);
  }

  @Post(':id/generate')
  @RequireSubscription(SubscriptionType.ENTERPRISE)
  async generateReport(@Request() req, @Param('id') id: string) {
    return this.reportsService.generateReport(id, req.user.userId);
  }

  @Delete(':id')
  @RequireSubscription(SubscriptionType.ENTERPRISE)
  async remove(@Request() req, @Param('id') id: string) {
    await this.reportsService.remove(id, req.user.userId);
    return { message: 'Report deleted successfully' };
  }
}

