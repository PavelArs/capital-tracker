import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsString } from 'class-validator';
import { CryptoType } from '../../entities/crypto-wallet.entity';

/**
 * DTO for creating a new crypto wallet
 */
export class CreateCryptoWalletDto {
  @ApiProperty({
    description: 'Blockchain type',
    enum: CryptoType,
    example: CryptoType.ETHEREUM,
  })
  @IsEnum(CryptoType)
  type: CryptoType;

  @ApiProperty({
    description: 'Wallet address',
    example: '0x742d35Cc6634C0532925a3b844Bc9e7595f8bE',
  })
  @IsString()
  address: string;
}
