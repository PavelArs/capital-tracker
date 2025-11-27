import { IsBoolean, IsNotEmpty, IsUUID } from 'class-validator';

export class ToggleCurrencyDto {
  @IsUUID()
  @IsNotEmpty()
  currencyId: string;

  @IsBoolean()
  @IsNotEmpty()
  isHidden: boolean;
}
