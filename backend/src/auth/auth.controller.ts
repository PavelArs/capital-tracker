import {
  Controller,
  Post,
  Body,
  Get,
  UseGuards,
  Request,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { Throttle } from "@nestjs/throttler";
import { AuthService } from "./auth.service";
import { RegisterDto } from "./dto/register.dto";
import { JwtAuthGuard } from "./guards/jwt-auth.guard";

@Controller("auth")
export class AuthController {
  constructor(private authService: AuthService) {}

  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post("register")
  async register(@Body() registerDto: RegisterDto) {
    return this.authService.register(registerDto);
  }

  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post("login")
  @UseGuards(AuthGuard("local"))
  async login(@Request() req) {
    return this.authService.login(req.user);
  }

  @Get("me")
  @UseGuards(JwtAuthGuard)
  async getProfile(@Request() req) {
    return this.authService.getProfile(req.user.userId);
  }

  @Post("invitation-code/generate")
  @UseGuards(JwtAuthGuard)
  async generateInvitationCode(@Request() req) {
    return this.authService.generateInvitationCode(req.user.userId);
  }

  @Get("invitation-code")
  @UseGuards(JwtAuthGuard)
  async getMyInvitationCode(@Request() req) {
    return this.authService.getMyInvitationCode(req.user.userId);
  }
}
