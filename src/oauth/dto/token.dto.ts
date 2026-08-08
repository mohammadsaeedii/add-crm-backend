import { IsOptional, IsString } from 'class-validator';

export class TokenDto {
  @IsString()
  grant_type!: string;

  @IsString()
  client_id!: string;

  @IsString()
  client_secret!: string;

  @IsString()
  @IsOptional()
  code?: string;

  @IsString()
  @IsOptional()
  redirect_uri?: string;

  @IsString()
  @IsOptional()
  code_verifier?: string;

  @IsString()
  @IsOptional()
  refresh_token?: string;
}
