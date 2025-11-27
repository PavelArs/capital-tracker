import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { LiabilitiesService } from './liabilities.service';
import { CreateLiabilityDto } from './dto/create-liability.dto';
import { UpdateLiabilityDto } from './dto/update-liability.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser, JwtPayload } from '../shared/decorators';

@Controller('liabilities')
@UseGuards(JwtAuthGuard)
export class LiabilitiesController {
  constructor(private readonly liabilitiesService: LiabilitiesService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@CurrentUser() user: JwtPayload, @Body() createLiabilityDto: CreateLiabilityDto) {
    return this.liabilitiesService.create(user.userId, createLiabilityDto);
  }

  @Get()
  findAll(@CurrentUser() user: JwtPayload) {
    return this.liabilitiesService.findAll(user.userId);
  }

  @Get(':id')
  findOne(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.liabilitiesService.findOne(id, user.userId);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() updateLiabilityDto: UpdateLiabilityDto,
  ) {
    return this.liabilitiesService.update(id, user.userId, updateLiabilityDto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.liabilitiesService.remove(id, user.userId);
  }
}
