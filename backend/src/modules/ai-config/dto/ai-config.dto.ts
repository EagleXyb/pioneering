import { IsString, IsOptional, IsDateString } from 'class-validator';

export class CreateAiConfigDto {
  @IsString()
  apiKey: string;

  @IsString()
  provider: string;

  @IsString()
  model: string;

  @IsString()
  prompt: string;

  @IsOptional()
  @IsString()
  lastTestInput?: string;

  @IsOptional()
  @IsString()
  lastTestResult?: string;

  @IsOptional()
  @IsDateString()
  lastTestTime?: string;
}

export class UpdateAiConfigDto {
  @IsOptional()
  @IsString()
  apiKey?: string;

  @IsOptional()
  @IsString()
  provider?: string;

  @IsOptional()
  @IsString()
  model?: string;

  @IsOptional()
  @IsString()
  prompt?: string;

  @IsOptional()
  @IsString()
  lastTestInput?: string;

  @IsOptional()
  @IsString()
  lastTestResult?: string;

  @IsOptional()
  @IsDateString()
  lastTestTime?: string;
}

export class TestConnectionDto {
  @IsString()
  apiKey: string;

  @IsString()
  provider: string;

  @IsString()
  model: string;
}

export class TestConnectionResultDto {
  success: boolean;
  message: string;
  responseTime?: number;
  error?: string;
}