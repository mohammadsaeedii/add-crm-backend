import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule, JwtModuleOptions } from '@nestjs/jwt';
import type { StringValue } from 'ms';
import { OauthController } from './oauth.controller.js';
import { OauthService } from './oauth.service.js';

@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService): JwtModuleOptions => ({
        secret: config.get<string>(
          'OAUTH_TOKEN_SECRET',
          config.getOrThrow<string>('JWT_SECRET'),
        ),
        signOptions: {
          expiresIn: '15m' as StringValue,
        },
      }),
    }),
  ],
  controllers: [OauthController],
  providers: [OauthService],
  exports: [OauthService],
})
export class OauthModule {}
