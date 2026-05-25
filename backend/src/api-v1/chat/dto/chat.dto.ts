import { IsString, IsOptional, IsInt, Min, IsEnum, IsBoolean, IsNumber, MinLength, MaxLength, IsArray, IsNotEmpty } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateSessionDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  model?: string;

  @IsOptional()
  @IsString()
  systemPrompt?: string;

  @IsOptional()
  @IsString()
  initialMessage?: string;
}

export class UpdateSessionDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  model?: string;

  @IsOptional()
  @Type(() => Object)
  modelConfig?: {
    temperature?: number;
    maxTokens?: number;
  };
}

export class ChatCompletionDto {
  @IsOptional()
  @IsString()
  sessionId?: string;

  @IsString()
  @IsNotEmpty()
  message: string;

  @IsOptional()
  @IsString()
  model?: string;

  @IsOptional()
  @IsString()
  systemPrompt?: string;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  temperature?: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  maxTokens?: number;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  stream?: boolean;

  @IsOptional()
  @IsString()
  parentMessageId?: string;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  deepThink?: boolean;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  netSearch?: boolean;

  @IsOptional()
  @IsString()
  messageId?: string;
}

export class StopGenerationDto {
  @IsString()
  @IsNotEmpty()
  sessionId: string;

  @IsOptional()
  @IsString()
  messageId?: string;
}

export class FeedbackDto {
  @IsString()
  @IsNotEmpty()
  messageId: string;

  @IsEnum(['like', 'dislike', 'none'])
  feedback: 'like' | 'dislike' | 'none';
}

export class EditMessageDto {
  @IsString()
  @IsNotEmpty()
  content: string;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  regenerate?: boolean;
}

export class RegenerateDto {
  @IsOptional()
  @IsString()
  model?: string;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  temperature?: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  maxTokens?: number;
}

export class QueryMessagesDto {
  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  limit?: number;

  @IsOptional()
  @IsEnum(['before', 'after'])
  direction?: 'before' | 'after';
}

export class QuerySessionsDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  page?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  pageSize?: number;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  archived?: boolean;
}

export class DeleteSessionDto {
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  archive?: boolean;
}