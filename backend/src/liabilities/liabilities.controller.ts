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
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { LiabilitiesService } from './liabilities.service';
import { CreateLiabilityDto } from './dto/create-liability.dto';
import { UpdateLiabilityDto } from './dto/update-liability.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser, JwtPayload } from '../shared/decorators';
import { ErrorResponseDto, ValidationErrorResponseDto } from '../shared/dto';

@ApiTags('liabilities')
@ApiBearerAuth('JWT-auth')
@Controller('liabilities')
@UseGuards(JwtAuthGuard)
export class LiabilitiesController {
  constructor(private readonly liabilitiesService: LiabilitiesService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create a new liability',
    description: 'Add a new liability/expense to the user portfolio',
  })
  @ApiResponse({
    status: 201,
    description: 'Liability created successfully',
  })
  @ApiResponse({
    status: 400,
    description: 'Validation error',
    type: ValidationErrorResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
    type: ErrorResponseDto,
  })
  create(@CurrentUser() user: JwtPayload, @Body() createLiabilityDto: CreateLiabilityDto) {
    return this.liabilitiesService.create(user.userId, createLiabilityDto);
  }

  @Get()
  @ApiOperation({
    summary: 'Get all liabilities',
    description: 'Retrieve all liabilities belonging to the authenticated user',
  })
  @ApiResponse({
    status: 200,
    description: 'Liabilities retrieved successfully',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
    type: ErrorResponseDto,
  })
  findAll(@CurrentUser() user: JwtPayload) {
    return this.liabilitiesService.findAll(user.userId);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get liability by ID',
    description: 'Retrieve a specific liability by its ID',
  })
  @ApiParam({ name: 'id', description: 'Liability UUID', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Liability retrieved successfully',
  })
  @ApiResponse({
    status: 404,
    description: 'Liability not found',
    type: ErrorResponseDto,
  })
  findOne(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.liabilitiesService.findOne(id, user.userId);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update a liability',
    description: 'Update an existing liability by its ID',
  })
  @ApiParam({ name: 'id', description: 'Liability UUID', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Liability updated successfully',
  })
  @ApiResponse({
    status: 400,
    description: 'Validation error',
    type: ValidationErrorResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Liability not found',
    type: ErrorResponseDto,
  })
  update(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() updateLiabilityDto: UpdateLiabilityDto,
  ) {
    return this.liabilitiesService.update(id, user.userId, updateLiabilityDto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a liability',
    description: 'Remove a liability from the user portfolio',
  })
  @ApiParam({ name: 'id', description: 'Liability UUID', format: 'uuid' })
  @ApiResponse({
    status: 204,
    description: 'Liability deleted successfully',
  })
  @ApiResponse({
    status: 404,
    description: 'Liability not found',
    type: ErrorResponseDto,
  })
  remove(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.liabilitiesService.remove(id, user.userId);
  }
}
