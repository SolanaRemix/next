import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import {
  REFRESH_COOKIE_NAME,
  REFRESH_TOKEN_TTL_MILLISECONDS,
} from './auth.constants.js';
import { CurrentUser, Public, Roles } from './auth.decorators.js';
import type { AuthUser } from './auth-user.js';
import { AssignRoleDto, CredentialsDto, ListUsersQueryDto } from './auth.dto.js';
import { AuthService, type AuthSession } from './auth.service.js';

function setRefreshCookie(response: Response, token: string): void {
  response.cookie(REFRESH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/api/auth',
    maxAge: REFRESH_TOKEN_TTL_MILLISECONDS,
  });
}

function clearRefreshCookie(response: Response): void {
  response.clearCookie(REFRESH_COOKIE_NAME, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/api/auth',
  });
}

function publicSession(session: AuthSession) {
  const { refreshToken, ...body } = session;
  return body;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  async register(
    @Body() credentials: CredentialsDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const session = await this.authService.register(credentials.email, credentials.password);
    setRefreshCookie(response, session.refreshToken);
    return publicSession(session);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() credentials: CredentialsDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const session = await this.authService.login(credentials.email, credentials.password);
    setRefreshCookie(response, session.refreshToken);
    return publicSession(session);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const session = await this.authService.refresh(
      request.cookies?.[REFRESH_COOKIE_NAME] as string | undefined,
    );
    setRefreshCookie(response, session.refreshToken);
    return publicSession(session);
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.authService.logout(
      request.cookies?.[REFRESH_COOKIE_NAME] as string | undefined,
    );
    clearRefreshCookie(response);
  }

  @Get('me')
  currentUser(@CurrentUser() user: AuthUser): AuthUser {
    return user;
  }

  @Roles('SuperAdmin')
  @Get('users')
  listUsers(@Query() query: ListUsersQueryDto) {
    return this.authService.listUsers(query.limit, query.cursor);
  }

  @Roles('SuperAdmin')
  @Patch('users/:id/role')
  assignRole(
    @CurrentUser() actor: AuthUser,
    @Param('id', new ParseUUIDPipe()) targetId: string,
    @Body() request: AssignRoleDto,
  ) {
    return this.authService.assignRole(actor.id, targetId, request.role);
  }
}
