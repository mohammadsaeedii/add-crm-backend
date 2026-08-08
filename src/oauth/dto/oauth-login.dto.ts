import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

export class OauthLoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(6)
  password!: string;

  @IsString()
  client_id!: string;

  @IsString()
  redirect_uri!: string;

  @IsString()
  response_type!: string;

  @IsString()
  state!: string;

  @IsString()
  code_challenge!: string;

  @IsString()
  @IsOptional()
  code_challenge_method?: string;

  @IsString()
  @IsOptional()
  scope?: string;

  @IsString()
  @IsOptional()
  nonce?: string;
}
