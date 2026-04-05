import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser, JwtPayload } from '../shared/decorators';
import { ErrorResponseDto, ValidationErrorResponseDto } from '../shared/dto';
import { AssetsService } from './assets.service';
import { CreateAssetDto } from './dto/create-asset.dto';
import { UpdateAssetDto } from './dto/update-asset.dto';

@ApiTags('assets')
@ApiBearerAuth('JWT-auth')
@Controller('assets')
@UseGuards(JwtAuthGuard)
export class AssetsController {
  constructor(private readonly assetsService: AssetsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create a new asset',
    description: 'Add a new asset to the user portfolio (stock assets or income flows)',
  })
  @ApiResponse({
    status: 201,
    description: 'Asset created successfully',
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
  create(@CurrentUser() user: JwtPayload, @Body() createAssetDto: CreateAssetDto) {
    return this.assetsService.create(user.userId, createAssetDto);
  }

  @Get()
  @ApiOperation({
    summary: 'Get all assets',
    description: 'Retrieve all assets belonging to the authenticated user',
  })
  @ApiResponse({
    status: 200,
    description: 'Assets retrieved successfully',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
    type: ErrorResponseDto,
  })
  findAll(@CurrentUser() user: JwtPayload) {
    return this.assetsService.findAll(user.userId);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get asset by ID',
    description: 'Retrieve a specific asset by its ID',
  })
  @ApiParam({ name: 'id', description: 'Asset UUID', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Asset retrieved successfully',
  })
  @ApiResponse({
    status: 404,
    description: 'Asset not found',
    type: ErrorResponseDto,
  })
  findOne(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.assetsService.findOne(id, user.userId);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update an asset',
    description: 'Update an existing asset by its ID',
  })
  @ApiParam({ name: 'id', description: 'Asset UUID', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Asset updated successfully',
  })
  @ApiResponse({
    status: 400,
    description: 'Validation error',
    type: ValidationErrorResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Asset not found',
    type: ErrorResponseDto,
  })
  update(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() updateAssetDto: UpdateAssetDto,
  ) {
    return this.assetsService.update(id, user.userId, updateAssetDto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete an asset',
    description: 'Remove an asset from the user portfolio',
  })
  @ApiParam({ name: 'id', description: 'Asset UUID', format: 'uuid' })
  @ApiResponse({
    status: 204,
    description: 'Asset deleted successfully',
  })
  @ApiResponse({
    status: 404,
    description: 'Asset not found',
    type: ErrorResponseDto,
  })
  remove(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.assetsService.remove(id, user.userId);
  }
}
