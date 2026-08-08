import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service.js';

const CODE_TTL_MS = 5 * 60 * 1000;
const ACCESS_TOKEN_TTL = '15m';
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type AuthorizeParams = {
  clientId: string;
  redirectUri: string;
  responseType: string;
  state: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  scope?: string;
  nonce?: string;
};

@Injectable()
export class OauthService {
  private readonly issuer: string;
  private readonly ssoFrontendUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {
    this.issuer = this.config.get<string>(
      'OAUTH_ISSUER',
      'http://localhost:3001',
    );
    this.ssoFrontendUrl = this.config.get<string>(
      'SSO_FRONTEND_URL',
      'http://localhost:3000',
    );
  }

  getDiscoveryDocument() {
    return {
      issuer: this.issuer,
      authorization_endpoint: `${this.issuer}/oauth/authorize`,
      token_endpoint: `${this.issuer}/oauth/token`,
      userinfo_endpoint: `${this.issuer}/oauth/userinfo`,
      revocation_endpoint: `${this.issuer}/oauth/revoke`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      subject_types_supported: ['public'],
      id_token_signing_alg_values_supported: ['HS256'],
      scopes_supported: ['openid', 'profile', 'email'],
      token_endpoint_auth_methods_supported: ['client_secret_post'],
      claims_supported: [
        'sub',
        'email',
        'name',
        'customerId',
        'slug',
        'iss',
        'aud',
        'exp',
        'iat',
        'nonce',
      ],
    };
  }

  async buildAuthorizeRedirect(params: AuthorizeParams): Promise<string> {
    await this.assertAuthorizeParamsAsync(params);
    const url = new URL('/sso/login', this.ssoFrontendUrl);
    url.searchParams.set('client_id', params.clientId);
    url.searchParams.set('redirect_uri', params.redirectUri);
    url.searchParams.set('response_type', params.responseType);
    url.searchParams.set('state', params.state);
    url.searchParams.set('code_challenge', params.codeChallenge);
    url.searchParams.set(
      'code_challenge_method',
      params.codeChallengeMethod || 'S256',
    );
    if (params.scope) url.searchParams.set('scope', params.scope);
    if (params.nonce) url.searchParams.set('nonce', params.nonce);
    return url.toString();
  }

  async loginAndIssueCode(
    email: string,
    password: string,
    params: AuthorizeParams,
  ) {
    await this.assertAuthorizeParamsAsync(params);

    const customer = await this.prisma.customer.findUnique({
      where: { email: email.toLowerCase().trim() },
    });

    if (!customer) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const valid = await bcrypt.compare(password, customer.passwordHash);
    if (!valid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const rawCode = randomBytes(32).toString('base64url');
    const codeHash = this.hashToken(rawCode);

    await this.prisma.authorizationCode.create({
      data: {
        codeHash,
        clientId: params.clientId,
        customerId: customer.id,
        redirectUri: params.redirectUri,
        codeChallenge: params.codeChallenge,
        codeChallengeMethod: params.codeChallengeMethod || 'S256',
        nonce: params.nonce,
        scope: params.scope || 'openid profile email',
        expiresAt: new Date(Date.now() + CODE_TTL_MS),
      },
    });

    const redirect = new URL(params.redirectUri);
    redirect.searchParams.set('code', rawCode);
    redirect.searchParams.set('state', params.state);

    return {
      redirectTo: redirect.toString(),
      customer: {
        id: customer.id,
        email: customer.email,
        name: customer.name,
        slug: customer.slug,
      },
    };
  }

  async exchangeToken(body: {
    grant_type: string;
    code?: string;
    redirect_uri?: string;
    client_id: string;
    client_secret: string;
    code_verifier?: string;
    refresh_token?: string;
  }) {
    const client = await this.authenticateClient(
      body.client_id,
      body.client_secret,
    );

    if (body.grant_type === 'authorization_code') {
      return this.exchangeAuthorizationCode(client.clientId, body);
    }

    if (body.grant_type === 'refresh_token') {
      return this.rotateRefreshToken(client.clientId, body.refresh_token);
    }

    throw new BadRequestException('Unsupported grant_type');
  }

  async getUserInfo(authorizationHeader?: string) {
    const token = this.extractBearer(authorizationHeader);
    let payload: {
      sub: string;
      email?: string;
      name?: string;
      customerId?: number;
      slug?: string;
      typ?: string;
    };

    try {
      payload = await this.jwtService.verifyAsync(token, {
        secret: this.tokenSecret(),
      });
    } catch {
      throw new UnauthorizedException('Invalid access token');
    }

    if (payload.typ && payload.typ !== 'access') {
      throw new UnauthorizedException('Invalid access token');
    }

    const customerId = payload.customerId ?? this.parseCustomerId(payload.sub);
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
    });

    if (!customer) {
      throw new UnauthorizedException('User not found');
    }

    return this.buildIdentity(customer);
  }

  async revoke(body: {
    token: string;
    client_id: string;
    client_secret: string;
  }) {
    await this.authenticateClient(body.client_id, body.client_secret);
    const tokenHash = this.hashToken(body.token);
    await this.prisma.oAuthRefreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { revoked: true };
  }

  private async exchangeAuthorizationCode(
    clientId: string,
    body: {
      code?: string;
      redirect_uri?: string;
      code_verifier?: string;
    },
  ) {
    if (!body.code || !body.redirect_uri || !body.code_verifier) {
      throw new BadRequestException(
        'code, redirect_uri, and code_verifier are required',
      );
    }

    const codeHash = this.hashToken(body.code);
    const record = await this.prisma.authorizationCode.findUnique({
      where: { codeHash },
      include: { customer: true },
    });

    if (!record || record.clientId !== clientId) {
      throw new UnauthorizedException('Invalid authorization code');
    }

    if (record.usedAt) {
      // Potential replay — revoke outstanding refresh tokens for this customer/client
      await this.prisma.oAuthRefreshToken.updateMany({
        where: {
          clientId,
          customerId: record.customerId,
          revokedAt: null,
        },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException('Authorization code already used');
    }

    if (record.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException('Authorization code expired');
    }

    if (record.redirectUri !== body.redirect_uri) {
      throw new BadRequestException('redirect_uri mismatch');
    }

    if (record.codeChallengeMethod !== 'S256') {
      throw new BadRequestException('Only S256 PKCE is supported');
    }

    const expectedChallenge = createHash('sha256')
      .update(body.code_verifier)
      .digest('base64url');

    if (expectedChallenge !== record.codeChallenge) {
      throw new UnauthorizedException('Invalid PKCE code_verifier');
    }

    await this.prisma.authorizationCode.update({
      where: { id: record.id },
      data: { usedAt: new Date() },
    });

    return this.issueTokens(record.customer, clientId, record.nonce);
  }

  private async rotateRefreshToken(clientId: string, refreshToken?: string) {
    if (!refreshToken) {
      throw new BadRequestException('refresh_token is required');
    }

    const tokenHash = this.hashToken(refreshToken);
    const existing = await this.prisma.oAuthRefreshToken.findUnique({
      where: { tokenHash },
      include: { customer: true },
    });

    if (
      !existing ||
      existing.clientId !== clientId ||
      existing.revokedAt ||
      existing.expiresAt.getTime() < Date.now()
    ) {
      if (existing) {
        await this.prisma.oAuthRefreshToken.updateMany({
          where: {
            clientId,
            customerId: existing.customerId,
            revokedAt: null,
          },
          data: { revokedAt: new Date() },
        });
      }
      throw new UnauthorizedException('Invalid refresh token');
    }

    const tokens = await this.issueTokens(existing.customer, clientId);
    await this.prisma.oAuthRefreshToken.update({
      where: { id: existing.id },
      data: {
        revokedAt: new Date(),
        replacedBy: this.hashToken(tokens.refresh_token),
      },
    });

    return tokens;
  }

  private async issueTokens(
    customer: {
      id: number;
      email: string;
      name: string;
      slug: string;
    },
    clientId: string,
    nonce?: string | null,
  ) {
    const identity = this.buildIdentity(customer);
    const secret = this.tokenSecret();

    const accessToken = await this.jwtService.signAsync(
      {
        ...identity,
        typ: 'access',
        iss: this.issuer,
        aud: clientId,
      },
      { secret, expiresIn: ACCESS_TOKEN_TTL },
    );

    const idToken = await this.jwtService.signAsync(
      {
        ...identity,
        typ: 'id',
        iss: this.issuer,
        aud: clientId,
        ...(nonce ? { nonce } : {}),
      },
      { secret, expiresIn: ACCESS_TOKEN_TTL },
    );

    const rawRefresh = randomBytes(48).toString('base64url');
    await this.prisma.oAuthRefreshToken.create({
      data: {
        tokenHash: this.hashToken(rawRefresh),
        clientId,
        customerId: customer.id,
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
      },
    });

    return {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: 15 * 60,
      refresh_token: rawRefresh,
      id_token: idToken,
      scope: 'openid profile email',
    };
  }

  buildIdentity(customer: {
    id: number;
    email: string;
    name: string;
    slug: string;
  }) {
    return {
      sub: `customer_${customer.id}`,
      email: customer.email,
      name: customer.name,
      customerId: customer.id,
      slug: customer.slug,
    };
  }

  private assertAuthorizeParams(params: AuthorizeParams) {
    if (params.responseType !== 'code') {
      throw new BadRequestException('response_type must be code');
    }
    if (!params.clientId || !params.redirectUri || !params.state) {
      throw new BadRequestException(
        'client_id, redirect_uri, and state are required',
      );
    }
    if (!params.codeChallenge) {
      throw new BadRequestException('code_challenge is required (PKCE)');
    }
    const method = params.codeChallengeMethod || 'S256';
    if (method !== 'S256') {
      throw new BadRequestException('code_challenge_method must be S256');
    }
  }

  private async assertAuthorizeParamsAsync(params: AuthorizeParams) {
    this.assertAuthorizeParams(params);
    const client = await this.prisma.oAuthClient.findUnique({
      where: { clientId: params.clientId },
    });
    if (!client) {
      throw new BadRequestException('Unknown client_id');
    }
    if (!client.redirectUris.includes(params.redirectUri)) {
      throw new BadRequestException('redirect_uri is not allowed for client');
    }
  }

  private async authenticateClient(clientId: string, clientSecret: string) {
    const client = await this.prisma.oAuthClient.findUnique({
      where: { clientId },
    });
    if (!client) {
      throw new UnauthorizedException('Invalid client credentials');
    }
    const valid = await bcrypt.compare(clientSecret, client.clientSecretHash);
    if (!valid) {
      throw new UnauthorizedException('Invalid client credentials');
    }
    return client;
  }

  private hashToken(value: string) {
    return createHash('sha256').update(value).digest('hex');
  }

  private tokenSecret() {
    return this.config.get<string>(
      'OAUTH_TOKEN_SECRET',
      this.config.getOrThrow<string>('JWT_SECRET'),
    );
  }

  private extractBearer(header?: string) {
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer token');
    }
    return header.slice('Bearer '.length).trim();
  }

  private parseCustomerId(sub: string) {
    const match = /^customer_(\d+)$/.exec(sub);
    if (!match) {
      throw new UnauthorizedException('Invalid subject');
    }
    return Number(match[1]);
  }
}
