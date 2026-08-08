import {
  Body,
  Controller,
  Get,
  Headers,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { OauthLoginDto } from './dto/oauth-login.dto.js';
import { RevokeDto } from './dto/revoke.dto.js';
import { TokenDto } from './dto/token.dto.js';
import { OauthService } from './oauth.service.js';

@Controller()
export class OauthController {
  constructor(private readonly oauthService: OauthService) {}

  @Get('.well-known/openid-configuration')
  discovery() {
    return this.oauthService.getDiscoveryDocument();
  }

  @Get('oauth/authorize')
  async authorize(
    @Query('client_id') clientId: string,
    @Query('redirect_uri') redirectUri: string,
    @Query('response_type') responseType: string,
    @Query('state') state: string,
    @Query('code_challenge') codeChallenge: string,
    @Query('code_challenge_method') codeChallengeMethod: string,
    @Query('scope') scope: string | undefined,
    @Query('nonce') nonce: string | undefined,
    @Res() res: Response,
  ) {
    const redirectTo = await this.oauthService.buildAuthorizeRedirect({
      clientId,
      redirectUri,
      responseType,
      state,
      codeChallenge,
      codeChallengeMethod: codeChallengeMethod || 'S256',
      scope,
      nonce,
    });
    return res.redirect(302, redirectTo);
  }

  @Post('oauth/login')
  async login(@Body() dto: OauthLoginDto) {
    return this.oauthService.loginAndIssueCode(dto.email, dto.password, {
      clientId: dto.client_id,
      redirectUri: dto.redirect_uri,
      responseType: dto.response_type,
      state: dto.state,
      codeChallenge: dto.code_challenge,
      codeChallengeMethod: dto.code_challenge_method || 'S256',
      scope: dto.scope,
      nonce: dto.nonce,
    });
  }

  @Post('oauth/token')
  token(@Body() dto: TokenDto) {
    return this.oauthService.exchangeToken(dto);
  }

  @Get('oauth/userinfo')
  userinfo(@Headers('authorization') authorization?: string) {
    return this.oauthService.getUserInfo(authorization);
  }

  @Post('oauth/revoke')
  revoke(@Body() dto: RevokeDto) {
    return this.oauthService.revoke(dto);
  }
}
