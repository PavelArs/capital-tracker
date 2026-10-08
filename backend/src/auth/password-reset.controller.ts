import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ResetConfirmDto, ResetRequestDto, ResetTokenDto } from './dto/password-reset.dto';
import { PasswordResetService, ResetLinkState } from './password-reset.service';
import { Public } from './public.decorator';
import { AuthRequestLimit } from './request-limit.decorator';

// Public like password login: an anonymous session, exact Origin and CSRF are still required.
@ApiTags('auth')
@Controller('auth/password-reset')
export class PasswordResetController {
  constructor(private readonly resets: PasswordResetService) {}

  @Public()
  @AuthRequestLimit('reset-ip')
  @Post()
  @HttpCode(202)
  @ApiOperation({ summary: 'Email the owner a single-use reset link; same answer for any email' })
  async request(@Body() body: ResetRequestDto): Promise<void> {
    await this.resets.request(body.email);
  }

  @Public()
  @AuthRequestLimit('reset-ip')
  @Post('status')
  @HttpCode(200)
  async status(@Body() body: ResetTokenDto): Promise<{ state: ResetLinkState }> {
    return { state: await this.resets.status(body.token) };
  }

  @Public()
  @AuthRequestLimit('reset-ip')
  @Post('confirm')
  @HttpCode(204)
  @ApiOperation({ summary: 'Set a new password with a reset link and sign out every session' })
  async confirm(@Body() body: ResetConfirmDto): Promise<void> {
    await this.resets.confirm(body.token, body.password);
  }
}
