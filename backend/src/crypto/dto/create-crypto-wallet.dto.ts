import { IsString, IsEnum } from 'class-validator';
import { CryptoType } from '../../entities/crypto-wallet.entity';

export class CreateCryptoWalletDto {
  @IsEnum(CryptoType)
  type: CryptoType;

  @IsString()
  address: string;
}

