import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { GoogleLoginDto } from './dto/google-login.dto';
import { CompleteGoogleSignupDto } from './dto/complete-google-signup.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import { CurrentUser } from './current-user.decorator';
import type { JwtPayload } from './jwt.types';
import { SwitchCompanyDto } from './dto/switch-company.dto';
import { SetBusinessTypeDto } from './dto/set-business-type.dto';
import { PlatformAdminGuard } from '../platform-admin/platform-admin.guard';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Throttle({
    default: {
      ttl: 60_000,
      limit: process.env.NODE_ENV === 'production' ? 15 : 60,
    },
  })
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto.email, dto.password, dto.companyId);
  }

  @Throttle({
    default: {
      ttl: 60_000,
      limit: process.env.NODE_ENV === 'production' ? 8 : 30,
    },
  })
  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.auth.register(
      dto.name,
      dto.email,
      dto.password,
      dto.companyName,
      dto.acceptTerms,
      dto.acceptPrivacy,
    );
  }

  @Throttle({
    default: {
      ttl: 60_000,
      limit: process.env.NODE_ENV === 'production' ? 20 : 60,
    },
  })
  @Get('google')
  startGoogle(
    @Query('returnTo') returnTo: string | undefined,
    @Query('companyId') companyId: string | undefined,
    @Query('popup') popup: string | undefined,
    @Res() res: Response,
  ) {
    res.redirect(
      302,
      this.auth.buildGoogleAuthorizeRedirect(
        returnTo,
        companyId,
        popup === '1' || popup === 'true',
      ),
    );
  }

  @Throttle({
    default: {
      ttl: 60_000,
      limit: process.env.NODE_ENV === 'production' ? 20 : 60,
    },
  })
  @Get('google/callback')
  async googleCallback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') error: string | undefined,
    @Res() res: Response,
  ) {
    const url = await this.auth.handleGoogleOAuthCallback({
      code,
      state,
      error,
    });
    res.redirect(302, url);
  }

  @Throttle({
    default: {
      ttl: 60_000,
      limit: process.env.NODE_ENV === 'production' ? 20 : 60,
    },
  })
  @Post('google')
  async google(@Body() dto: GoogleLoginDto) {
    const result = await this.auth.googleLogin(dto.idToken, dto.companyName);
    if (result.kind === 'signup') {
      return {
        needsSignup: true,
        signupToken: result.signupToken,
        email: result.email,
        name: result.name,
      };
    }
    return { accessToken: result.accessToken, user: result.user };
  }

  @Throttle({
    default: {
      ttl: 60_000,
      limit: process.env.NODE_ENV === 'production' ? 8 : 30,
    },
  })
  @Post('google/complete')
  completeGoogleSignup(@Body() dto: CompleteGoogleSignupDto) {
    return this.auth.completeGoogleSignup(dto);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: JwtPayload) {
    return this.auth.me(user);
  }

  @Post('switch-company')
  @UseGuards(JwtAuthGuard)
  switchCompany(
    @CurrentUser() user: JwtPayload,
    @Body() dto: SwitchCompanyDto,
  ) {
    return this.auth.switchCompany(user.sub, dto.companyId);
  }

  @Post('platform/enter-company')
  @UseGuards(JwtAuthGuard, PlatformAdminGuard)
  enterCompany(
    @CurrentUser() user: JwtPayload,
    @Body() dto: SwitchCompanyDto,
  ) {
    return this.auth.enterCompanyAsPlatformAdmin(user.sub, dto.companyId);
  }

  @Post('platform/home')
  @UseGuards(JwtAuthGuard, PlatformAdminGuard)
  platformHome(@CurrentUser() user: JwtPayload) {
    return this.auth.exitToPlatformAdmin(user.sub);
  }

  @Post('business-setup')
  @UseGuards(JwtAuthGuard)
  setBusinessType(
    @CurrentUser() user: JwtPayload,
    @Body() dto: SetBusinessTypeDto,
  ) {
    return this.auth.setBusinessType(user.sub, dto.businessType, user.companyId);
  }
}
