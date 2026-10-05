import { Controller, Get, Query } from '@nestjs/common';
import { CurrentUser, OwnerIdentity } from '../shared/decorators';
import { OperationListService } from './operation-list.service';

@Controller('accounting/operations')
export class OperationListController {
  constructor(private readonly operations: OperationListService) {}

  @Get()
  read(@CurrentUser() owner: OwnerIdentity, @Query() query: unknown) {
    return this.operations.read(owner.userId, query);
  }
}
