import { Controller, Post, Body } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginRequestDto, WechatMiniProgramLoginRequestDto, WechatWebLoginRequestDto, RefreshTokenRequestDto } from './dto/auth.dto';
import { Public } from '../common/decorators/public.decorator';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  login(@Body() dto: LoginRequestDto) {
    return this.authService.login(dto.username, dto.password);
  }

  @Public()
  @Post('wechat/miniprogram')
  wechatMiniProgramLogin(@Body() dto: WechatMiniProgramLoginRequestDto) {
    return this.authService.wechatMiniProgramLogin(dto.code);
  }

  @Public()
  @Post('wechat/web')
  wechatWebLogin(@Body() dto: WechatWebLoginRequestDto) {
    return this.authService.wechatWebLogin(dto.code);
  }

  @Public()
  @Post('refresh')
  refreshToken(@Body() dto: RefreshTokenRequestDto) {
    return this.authService.refreshToken(dto.refreshToken);
  }
}