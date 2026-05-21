import { IsString, IsNotEmpty, MaxLength, IsOptional, IsEnum } from 'class-validator';
// 如果 class-validator 模块未安装，请运行: npm install class-validator class-transformer

export class CreateGlobalPromptDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @IsString()
  @IsOptional()
  templateContent?: string;

  @IsString()
  @IsNotEmpty()
  createdBy: string;
}

export class UpdateGlobalPromptDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  templateContent?: string;

  @IsEnum(['online', 'offline'])
  @IsOptional()
  status?: 'online' | 'offline';

  @IsEnum(['pending', 'approved', 'rejected'])
  @IsOptional()
  approvalStatus?: 'pending' | 'approved' | 'rejected';

  @IsString()
  @IsOptional()
  createdBy?: string;
}

export class UpdateStatusDto {
  @IsEnum(['online', 'offline'])
  @IsNotEmpty()
  status: 'online' | 'offline';
}

export class UpdateApprovalDto {
  @IsEnum(['pending', 'approved', 'rejected'])
  @IsNotEmpty()
  approvalStatus: 'pending' | 'approved' | 'rejected';
}
