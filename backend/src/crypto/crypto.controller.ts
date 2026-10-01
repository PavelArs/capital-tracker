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
} from '@nestjs/common';
import {
  ApiBody,
  ApiCookieAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser, OwnerIdentity } from '../shared/decorators';
import { ErrorResponseDto, ValidationErrorResponseDto } from '../shared/dto';
import { CryptoPrices, CryptoPricesService } from './crypto-prices.service';
import { CryptoService } from './crypto.service';
import { CreateCryptoWalletDto } from './dto/create-crypto-wallet.dto';

@ApiTags('crypto')
@ApiCookieAuth('__Host-ct-session')
@Controller('crypto')
export class CryptoController {
  constructor(
    private readonly cryptoService: CryptoService,
    private readonly cryptoPricesService: CryptoPricesService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Add a crypto wallet',
    description: 'Add a new cryptocurrency wallet for tracking.',
  })
  @ApiResponse({
    status: 201,
    description: 'Wallet added successfully',
  })
  @ApiResponse({
    status: 400,
    description: 'Validation error',
    type: ValidationErrorResponseDto,
  })
  async create(@CurrentUser() user: OwnerIdentity, @Body() createDto: CreateCryptoWalletDto) {
    return this.cryptoService.create(user.userId, createDto);
  }

  @Get()
  @ApiOperation({
    summary: 'Get all crypto wallets',
    description: 'Retrieve all cryptocurrency wallets belonging to the authenticated user',
  })
  @ApiResponse({
    status: 200,
    description: 'Wallets retrieved successfully',
  })
  findAll(@CurrentUser() user: OwnerIdentity) {
    return this.cryptoService.findAll(user.userId);
  }

  @Get('prices')
  @ApiOperation({
    summary: 'Get crypto prices',
    description: 'Get current cryptocurrency prices in USD',
  })
  @ApiResponse({
    status: 200,
    description: 'Prices retrieved successfully',
    schema: {
      properties: {
        bitcoin: { type: 'number', example: 65000.5 },
        ethereum: { type: 'number', example: 3500.25 },
      },
    },
  })
  getPrices(): CryptoPrices {
    return this.cryptoPricesService.getAllPrices();
  }

  @Post('token-prices')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get token prices by contract addresses',
    description: 'Get prices for ERC-20 tokens by their contract addresses',
  })
  @ApiBody({
    schema: {
      properties: {
        contractAddresses: {
          type: 'array',
          items: { type: 'string' },
          example: ['0x1f9840a85d5af5bf1d1762f925bdaddc4201f984'],
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Token prices retrieved successfully',
  })
  async getTokenPrices(@Body() body: { contractAddresses: string[] }) {
    return this.cryptoPricesService.getBulkTokenPrices(body.contractAddresses);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get crypto wallet by ID',
    description: 'Retrieve a specific cryptocurrency wallet by its ID',
  })
  @ApiParam({ name: 'id', description: 'Wallet UUID', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Wallet retrieved successfully',
  })
  @ApiResponse({
    status: 404,
    description: 'Wallet not found',
    type: ErrorResponseDto,
  })
  findOne(@CurrentUser() user: OwnerIdentity, @Param('id') id: string) {
    return this.cryptoService.findOne(id, user.userId);
  }

  @Patch(':id/update-balance')
  @ApiOperation({
    summary: 'Update wallet balance',
    description:
      'Fetch and update the current balance of a cryptocurrency wallet from the blockchain',
  })
  @ApiParam({ name: 'id', description: 'Wallet UUID', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Balance updated successfully',
  })
  @ApiResponse({
    status: 404,
    description: 'Wallet not found',
    type: ErrorResponseDto,
  })
  updateBalance(@CurrentUser() user: OwnerIdentity, @Param('id') id: string) {
    return this.cryptoService.updateBalance(id, user.userId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a crypto wallet',
    description: 'Remove a cryptocurrency wallet from tracking',
  })
  @ApiParam({ name: 'id', description: 'Wallet UUID', format: 'uuid' })
  @ApiResponse({
    status: 204,
    description: 'Wallet deleted successfully',
  })
  @ApiResponse({
    status: 404,
    description: 'Wallet not found',
    type: ErrorResponseDto,
  })
  remove(@CurrentUser() user: OwnerIdentity, @Param('id') id: string) {
    return this.cryptoService.remove(id, user.userId);
  }
}
