import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Request,
} from '@nestjs/common';
import { LiabilitiesService } from './liabilities.service';
import { CreateLiabilityDto } from './dto/create-liability.dto';
import { UpdateLiabilityDto } from './dto/update-liability.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('liabilities')
@UseGuards(JwtAuthGuard)
export class LiabilitiesController {
  constructor(private readonly liabilitiesService: LiabilitiesService) {}

  @Post()
  create(@Request() req, @Body() createLiabilityDto: CreateLiabilityDto) {
    return this.liabilitiesService.create(req.user.userId, createLiabilityDto);
  }

  @Get()
  findAll(@Request() req) {
    return this.liabilitiesService.findAll(req.user.userId);
  }

  @Get(':id')
  findOne(@Request() req, @Param('id') id: string) {
    return this.liabilitiesService.findOne(id, req.user.userId);
  }

  @Patch(':id')
  update(
    @Request() req,
    @Param('id') id: string,
    @Body() updateLiabilityDto: UpdateLiabilityDto,
  ) {
    return this.liabilitiesService.update(id, req.user.userId, updateLiabilityDto);
  }

  @Delete(':id')
  remove(@Request() req, @Param('id') id: string) {
    return this.liabilitiesService.remove(id, req.user.userId);
  }
}

