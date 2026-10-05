import { Body, Controller, Get, Put } from '@nestjs/common';
import { CurrentUser, OwnerIdentity } from '../shared/decorators';
import { OwnerSettingsService } from './owner-settings.service';

@Controller('owner-settings')
export class OwnerSettingsController {
  constructor(private readonly settings: OwnerSettingsService) {}

  @Get()
  read(@CurrentUser() owner: OwnerIdentity) {
    return this.settings.read(owner.userId);
  }

  @Put()
  update(@CurrentUser() owner: OwnerIdentity, @Body() input: unknown) {
    return this.settings.update(owner.userId, input);
  }
}
