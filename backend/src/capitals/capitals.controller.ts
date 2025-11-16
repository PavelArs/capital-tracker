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
import { CapitalsService } from './capitals.service';
import { CreateCapitalDto } from './dto/create-capital.dto';
import { UpdateCapitalDto } from './dto/update-capital.dto';

@Controller('capitals')
@UseGuards(JwtAuthGuard, SubscriptionGuard)
export class CapitalsController {
  constructor(private capitalsService: CapitalsService) {}

  @Post()
  @RequireSubscription(SubscriptionType.ENTERPRISE)
  async create(@Request() req, @Body() createDto: CreateCapitalDto) {
    return this.capitalsService.create(req.user.userId, createDto);
  }

  @Get()
  @RequireSubscription(SubscriptionType.ENTERPRISE)
  async findAll(@Request() req) {
    return this.capitalsService.findAll(req.user.userId);
  }

  @Get(':id')
  @RequireSubscription(SubscriptionType.ENTERPRISE)
  async findOne(@Request() req, @Param('id') id: string) {
    return this.capitalsService.findOne(id, req.user.userId);
  }

  @Put(':id')
  @RequireSubscription(SubscriptionType.ENTERPRISE)
  async update(
    @Request() req,
    @Param('id') id: string,
    @Body() updateDto: UpdateCapitalDto,
  ) {
    return this.capitalsService.update(id, req.user.userId, updateDto);
  }

  @Post(':id/set-default')
  @RequireSubscription(SubscriptionType.ENTERPRISE)
  async setDefault(@Request() req, @Param('id') id: string) {
    return this.capitalsService.setDefault(id, req.user.userId);
  }

  @Delete(':id')
  @RequireSubscription(SubscriptionType.ENTERPRISE)
  async remove(@Request() req, @Param('id') id: string) {
    await this.capitalsService.remove(id, req.user.userId);
    return { message: 'Capital deleted successfully' };
  }
}

