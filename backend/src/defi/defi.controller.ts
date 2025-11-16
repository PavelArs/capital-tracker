import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
  Request,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SubscriptionGuard, RequireSubscription } from '../auth/guards/subscription.guard';
import { SubscriptionType } from '../entities/subscription.entity';
import { DefiService } from './defi.service';
import { CreateDeFiPositionDto } from './dto/create-defi-position.dto';
import { UpdateDeFiPositionDto } from './dto/update-defi-position.dto';

@Controller('defi')
@UseGuards(JwtAuthGuard, SubscriptionGuard)
export class DefiController {
  constructor(private defiService: DefiService) {}

  @Post()
  @RequireSubscription(SubscriptionType.PRO)
  async create(@Request() req, @Body() createDto: CreateDeFiPositionDto) {
    return this.defiService.create(req.user.userId, createDto);
  }

  @Get()
  @RequireSubscription(SubscriptionType.PRO)
  async findAll(@Request() req) {
    return this.defiService.findAll(req.user.userId);
  }

  @Get(':id')
  @RequireSubscription(SubscriptionType.PRO)
  async findOne(@Request() req, @Param('id') id: string) {
    return this.defiService.findOne(id, req.user.userId);
  }

  @Put(':id')
  @RequireSubscription(SubscriptionType.PRO)
  async update(
    @Request() req,
    @Param('id') id: string,
    @Body() updateDto: UpdateDeFiPositionDto,
  ) {
    return this.defiService.update(id, req.user.userId, updateDto);
  }

  @Post(':id/sync')
  @RequireSubscription(SubscriptionType.PRO)
  async syncPosition(@Request() req, @Param('id') id: string) {
    return this.defiService.syncPosition(id, req.user.userId);
  }

  @Delete(':id')
  @RequireSubscription(SubscriptionType.PRO)
  async remove(@Request() req, @Param('id') id: string) {
    await this.defiService.remove(id, req.user.userId);
    return { message: 'DeFi position deleted successfully' };
  }
}

