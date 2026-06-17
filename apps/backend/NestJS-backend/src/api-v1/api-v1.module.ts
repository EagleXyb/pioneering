import { Module } from '@nestjs/common';
import { CommonModule } from './common/common.module';
import { AuthModule } from './auth/auth.module';
import { ChatModule } from './chat/chat.module';
import { UserModule } from './user/user.module';
import { UploadModule } from './upload/upload.module';
import { SystemModule } from './system/system.module';

@Module({
  imports: [CommonModule, AuthModule, ChatModule, UserModule, UploadModule, SystemModule],
})
export class ApiV1Module {}