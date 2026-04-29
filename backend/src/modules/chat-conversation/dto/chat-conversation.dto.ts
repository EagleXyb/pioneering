import { IsString, IsOptional, IsInt, IsNotEmpty, IsIn, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateConversationDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsString()
  @IsNotEmpty()
  model: string;
}

export class UpdateConversationDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  title?: string;
}

export class CreateMessageDto {
  @IsIn(['user', 'assistant', 'system'])
  role: string;

  @IsString()
  content: string;

  @IsOptional()
  @IsString()
  thinkingContent?: string;

  @IsOptional()
  @IsString()
  answerContent?: string;

  @IsIn(['loading', 'success', 'error'])
  status: string;

  @IsOptional()
  @IsString()
  error?: string;
}

export class UpdateMessageDto {
  @IsOptional()
  @IsString()
  content?: string;

  @IsOptional()
  @IsString()
  thinkingContent?: string;

  @IsOptional()
  @IsString()
  answerContent?: string;

  @IsOptional()
  @IsIn(['loading', 'success', 'error'])
  status?: string;

  @IsOptional()
  @IsString()
  error?: string;
}
