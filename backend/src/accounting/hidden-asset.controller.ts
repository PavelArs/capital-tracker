import { Controller, Delete, Get, Param, Put } from '@nestjs/common';
import { CurrentUser, OwnerIdentity } from '../shared/decorators';
import { HiddenAssetService } from './hidden-asset.service';

@Controller('accounting/hidden-assets')
export class HiddenAssetController {
  constructor(private readonly hidden: HiddenAssetService) {}

  @Get()
  list(@CurrentUser() owner: OwnerIdentity) {
    return this.hidden.list(owner.userId);
  }

  @Put(':id')
  hide(@CurrentUser() owner: OwnerIdentity, @Param('id') id: string) {
    return this.hidden.hide(owner.userId, id);
  }

  @Delete(':id')
  show(@CurrentUser() owner: OwnerIdentity, @Param('id') id: string) {
    return this.hidden.show(owner.userId, id);
  }
}
