import { Body, Controller, Param, Post, Res } from '@nestjs/common';
import { Response } from 'express';
import { CurrentUser, OwnerIdentity } from '../shared/decorators';
import { CapitalReturnService } from './capital-return.service';

@Controller('accounting/accounts/:accountId/capital-returns')
export class CapitalReturnController {
  constructor(private readonly returns: CapitalReturnService) {}

  @Post(':id/voids')
  async voidReturn(
    @CurrentUser() owner: OwnerIdentity,
    @Param('accountId') account: string,
    @Param('id') id: string,
    @Body() input: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.returns.void(owner.userId, account, id, input);
    response.status(result.created ? 201 : 200);
    return result.value;
  }
}
