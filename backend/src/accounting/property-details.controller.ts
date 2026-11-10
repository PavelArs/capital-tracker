import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { CurrentUser, OwnerIdentity } from '../shared/decorators';
import { PropertyDetailsService } from './property-details.service';

@Controller('accounting')
export class PropertyDetailsController {
  constructor(private readonly details: PropertyDetailsService) {}

  @Get('property-details')
  list(@CurrentUser() owner: OwnerIdentity) {
    return this.details.list(owner.userId);
  }

  @Put('instruments/:id/property')
  set(@CurrentUser() owner: OwnerIdentity, @Param('id') id: string, @Body() body: unknown) {
    return this.details.set(owner.userId, id, body);
  }
}
