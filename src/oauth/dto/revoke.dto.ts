import { IsOptional, IsString } from 'class-validator';

export class RevokeDto {
  @IsString()
  token!: string;

  @IsString()
  client_id!: string;

  @IsString()
  client_secret!: string;

  @IsString()
  @IsOptional()
  token_type_hint?: string;
}
