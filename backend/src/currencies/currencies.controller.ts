import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { CurrenciesService } from './currencies.service';
import { ToggleCurrencyDto } from './dto/toggle-currency.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser, JwtPayload } from '../shared/decorators';
import { MessageResponseDto, ErrorResponseDto, ValidationErrorResponseDto } from '../shared/dto';

@ApiTags('currencies')
@ApiBearerAuth('JWT-auth')
@Controller('currencies')
@UseGuards(JwtAuthGuard)
export class CurrenciesController {
  constructor(private readonly currenciesService: CurrenciesService) {}

  @Get('list')
  @ApiOperation({
    summary: 'Get user currencies',
    description: 'Get all currencies visible to the authenticated user',
  })
  @ApiResponse({
    status: 200,
    description: 'Currencies retrieved successfully',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
    type: ErrorResponseDto,
  })
  findAll(@CurrentUser() user: JwtPayload) {
    return this.currenciesService.findAll(user.userId);
  }

  @Get('rates')
  @ApiOperation({
    summary: 'Get exchange rates',
    description: 'Get current exchange rates for a base currency',
  })
  @ApiQuery({
    name: 'base',
    required: false,
    description: 'Base currency code (default: USD)',
    example: 'USD',
  })
  @ApiResponse({
    status: 200,
    description: 'Exchange rates retrieved successfully',
  })
  getExchangeRates(@Query('base') base?: string) {
    return this.currenciesService.getExchangeRates(base || 'USD');
  }

  @Get('convert')
  @ApiOperation({
    summary: 'Convert currency',
    description: 'Convert an amount from one currency to another',
  })
  @ApiQuery({ name: 'amount', description: 'Amount to convert', example: '100' })
  @ApiQuery({ name: 'from', description: 'Source currency code', example: 'USD' })
  @ApiQuery({ name: 'to', description: 'Target currency code', example: 'EUR' })
  @ApiResponse({
    status: 200,
    description: 'Conversion result',
    schema: {
      properties: {
        amount: { type: 'number', example: 100 },
        from: { type: 'string', example: 'USD' },
        to: { type: 'string', example: 'EUR' },
        result: { type: 'number', example: 92.5 },
        rate: { type: 'number', example: 0.925 },
      },
    },
  })
  convert(@Query('amount') amount: string, @Query('from') from: string, @Query('to') to: string) {
    return this.currenciesService.convert(parseFloat(amount), from, to);
  }

  @Get('hidden')
  @ApiOperation({
    summary: 'Get hidden currencies',
    description: 'Get list of currencies hidden by the user',
  })
  @ApiResponse({
    status: 200,
    description: 'Hidden currencies retrieved successfully',
  })
  async getHiddenCurrencies(@CurrentUser() user: JwtPayload) {
    return this.currenciesService.getHiddenCurrencies(user.userId);
  }

  @Get()
  @ApiOperation({
    summary: 'Get all currencies',
    description: 'Get all available currencies in the system',
  })
  @ApiResponse({
    status: 200,
    description: 'All currencies retrieved successfully',
  })
  getAllCurrencies() {
    return this.currenciesService.getAllCurrencies();
  }

  @Post('hide')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Hide a currency',
    description: 'Hide a specific currency from the user view',
  })
  @ApiResponse({
    status: 200,
    description: 'Currency hidden successfully',
    type: MessageResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Validation error',
    type: ValidationErrorResponseDto,
  })
  async hideCurrency(@CurrentUser() user: JwtPayload, @Body() toggleDto: ToggleCurrencyDto) {
    await this.currenciesService.hideCurrency(user.userId, toggleDto.currencyId);
    return { message: 'Currency hidden successfully' };
  }

  @Post('show')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Show a currency',
    description: 'Make a hidden currency visible again',
  })
  @ApiResponse({
    status: 200,
    description: 'Currency shown successfully',
    type: MessageResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Validation error',
    type: ValidationErrorResponseDto,
  })
  async showCurrency(@CurrentUser() user: JwtPayload, @Body() toggleDto: ToggleCurrencyDto) {
    await this.currenciesService.showCurrency(user.userId, toggleDto.currencyId);
    return { message: 'Currency shown successfully' };
  }

  @Post('toggle')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Toggle currency visibility',
    description: 'Toggle the visibility of a currency',
  })
  @ApiResponse({
    status: 200,
    description: 'Currency visibility toggled successfully',
    type: MessageResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Validation error',
    type: ValidationErrorResponseDto,
  })
  async toggleCurrency(@CurrentUser() user: JwtPayload, @Body() toggleDto: ToggleCurrencyDto) {
    if (toggleDto.isHidden) {
      await this.currenciesService.hideCurrency(user.userId, toggleDto.currencyId);
    } else {
      await this.currenciesService.showCurrency(user.userId, toggleDto.currencyId);
    }
    return { message: 'Currency visibility toggled successfully' };
  }
}
