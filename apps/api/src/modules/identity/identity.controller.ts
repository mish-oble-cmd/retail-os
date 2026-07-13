import { Body, Controller, Get, HttpCode, Post, Req, UnauthorizedException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { loginSchema, signupSchema, totpActivateSchema } from './dto';
import { IdentityService, type Identity } from './identity.service';

function requireSession(req: Request): { storeId: string; staffId: string } {
  const { storeId, staffId } = req.session;
  if (!storeId || !staffId) throw new UnauthorizedException('Sign in first');
  return { storeId, staffId };
}

function toResource(identity: Identity) {
  return {
    staff_id: identity.staffId,
    store_id: identity.storeId,
    name: identity.name,
    email: identity.email,
    role: identity.roleName,
  };
}

@ApiTags('auth')
@Controller('auth')
export class IdentityController {
  constructor(private readonly identity: IdentityService) {}

  @Post('signup')
  @ApiOperation({
    operationId: 'signup',
    summary: 'Create a store and its Owner account (minimal Phase 0 signup)',
  })
  async signup(@Body() body: unknown, @Req() req: Request) {
    const input = signupSchema.parse(body);
    const identity = await this.identity.signup({
      email: input.email,
      password: input.password,
      name: input.name,
      storeName: input.store_name,
      currency: input.currency,
    });
    req.session.staffId = identity.staffId;
    req.session.storeId = identity.storeId;
    return toResource(identity);
  }

  @Post('login')
  @HttpCode(200)
  @ApiOperation({
    operationId: 'login',
    summary: 'Sign in with email + password (+ TOTP when enrolled)',
  })
  async login(@Body() body: unknown, @Req() req: Request) {
    const input = loginSchema.parse(body);
    const identity = await this.identity.login(input.email, input.password, input.totp_code);
    // Fresh session id on privilege change (session-fixation hygiene).
    await new Promise<void>((resolve, reject) =>
      req.session.regenerate((err) =>
        err ? reject(err instanceof Error ? err : new Error(String(err))) : resolve(),
      ),
    );
    req.session.staffId = identity.staffId;
    req.session.storeId = identity.storeId;
    return toResource(identity);
  }

  @Post('logout')
  @HttpCode(204)
  @ApiOperation({ operationId: 'logout', summary: 'Destroy the current session' })
  async logout(@Req() req: Request) {
    await new Promise<void>((resolve) => req.session.destroy(() => resolve()));
  }

  @Get('me')
  @ApiOperation({ operationId: 'getMe', summary: 'Current session identity' })
  async me(@Req() req: Request) {
    const { storeId, staffId } = requireSession(req);
    return toResource(await this.identity.me(storeId, staffId));
  }

  @Post('totp/enroll')
  @ApiOperation({
    operationId: 'totpEnroll',
    summary: 'Start TOTP enrollment (optional in Phase 0)',
  })
  async totpEnroll(@Req() req: Request) {
    const { storeId, staffId } = requireSession(req);
    const enrollment = await this.identity.totpEnroll(storeId, staffId);
    return { secret: enrollment.secret, otpauth_url: enrollment.otpauthUrl };
  }

  @Post('totp/activate')
  @HttpCode(204)
  @ApiOperation({
    operationId: 'totpActivate',
    summary: 'Confirm the authenticator code to turn 2FA on',
  })
  async totpActivate(@Body() body: unknown, @Req() req: Request) {
    const { storeId, staffId } = requireSession(req);
    const input = totpActivateSchema.parse(body);
    await this.identity.totpActivate(storeId, staffId, input.code);
  }
}
