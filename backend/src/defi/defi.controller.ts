import {
  Controller,
  Get,
  Post,
  Put,
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
import { DefiService } from './defi.service';
import { CreateDeFiPositionDto } from './dto/create-defi-position.dto';
import { UpdateDeFiPositionDto } from './dto/update-defi-position.dto';
import { CurrentUser, JwtPayload } from '../shared/decorators';

@Controller('defi')
@UseGuards(JwtAuthGuard, SubscriptionGuard)
export class DefiController {
  constructor(private readonly defiService: DefiService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequireSubscription(SubscriptionType.PRO)
  async create(@CurrentUser() user: JwtPayload, @Body() createDto: CreateDeFiPositionDto) {
    return this.defiService.create(user.userId, createDto);
  }

  @Get()
  @RequireSubscription(SubscriptionType.PRO)
  async findAll(@CurrentUser() user: JwtPayload) {
    return this.defiService.findAll(user.userId);
  }

  @Get(':id')
  @RequireSubscription(SubscriptionType.PRO)
  async findOne(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.defiService.findOne(id, user.userId);
  }

  @Put(':id')
  @RequireSubscription(SubscriptionType.PRO)
  async update(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() updateDto: UpdateDeFiPositionDto,
  ) {
    return this.defiService.update(id, user.userId, updateDto);
  }

  @Post(':id/sync')
  @HttpCode(HttpStatus.OK)
  @RequireSubscription(SubscriptionType.PRO)
  async syncPosition(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.defiService.syncPosition(id, user.userId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @RequireSubscription(SubscriptionType.PRO)
  async remove(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    await this.defiService.remove(id, user.userId);
    return { message: 'DeFi position deleted successfully' };
  }
}
