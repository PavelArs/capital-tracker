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
import { CapitalsService } from './capitals.service';
import { CreateCapitalDto } from './dto/create-capital.dto';
import { UpdateCapitalDto } from './dto/update-capital.dto';
import { CurrentUser, JwtPayload } from '../shared/decorators';

@Controller('capitals')
@UseGuards(JwtAuthGuard, SubscriptionGuard)
export class CapitalsController {
  constructor(private readonly capitalsService: CapitalsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequireSubscription(SubscriptionType.ENTERPRISE)
  async create(@CurrentUser() user: JwtPayload, @Body() createDto: CreateCapitalDto) {
    return this.capitalsService.create(user.userId, createDto);
  }

  @Get()
  @RequireSubscription(SubscriptionType.ENTERPRISE)
  async findAll(@CurrentUser() user: JwtPayload) {
    return this.capitalsService.findAll(user.userId);
  }

  @Get(':id')
  @RequireSubscription(SubscriptionType.ENTERPRISE)
  async findOne(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.capitalsService.findOne(id, user.userId);
  }

  @Put(':id')
  @RequireSubscription(SubscriptionType.ENTERPRISE)
  async update(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() updateDto: UpdateCapitalDto,
  ) {
    return this.capitalsService.update(id, user.userId, updateDto);
  }

  @Post(':id/set-default')
  @HttpCode(HttpStatus.OK)
  @RequireSubscription(SubscriptionType.ENTERPRISE)
  async setDefault(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.capitalsService.setDefault(id, user.userId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @RequireSubscription(SubscriptionType.ENTERPRISE)
  async remove(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    await this.capitalsService.remove(id, user.userId);
    return { message: 'Capital deleted successfully' };
  }
}
