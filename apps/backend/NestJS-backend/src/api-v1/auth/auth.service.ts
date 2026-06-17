import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  async login(username: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { username } });
    if (!user) {
      throw new UnauthorizedException('用户名或密码错误');
    }
    if (!user.passwordHash) {
      throw new UnauthorizedException('该账号未设置密码，请使用微信登录');
    }

    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    if (!isPasswordValid) {
      throw new UnauthorizedException('用户名或密码错误');
    }

    return this.generateAuthResponse(user);
  }

  async wechatMiniProgramLogin(code: string) {
    if (!code) {
      throw new BadRequestException('code 不能为空');
    }
    // TODO: 调用微信小程序 code2session 接口校验 code
    // 这里先用 mock 实现，实际需要配置 AppId/AppSecret
    const mockOpenid = `wx_mini_${code.slice(0, 16)}`;

    const user = await this.prisma.user.upsert({
      where: { username: mockOpenid },
      update: { wechatOpenid: mockOpenid },
      create: {
        id: `user_${uuidv4().replace(/-/g, '').slice(0, 24)}`,
        username: mockOpenid,
        wechatOpenid: mockOpenid,
        nickname: '微信用户',
      },
    });

    return this.generateAuthResponse(user);
  }

  async wechatWebLogin(code: string) {
    if (!code) {
      throw new BadRequestException('code 不能为空');
    }
    // TODO: 调用微信网页 OAuth 接口校验 code
    const mockOpenid = `wx_web_${code.slice(0, 16)}`;

    const user = await this.prisma.user.upsert({
      where: { username: mockOpenid },
      update: { wechatUnionid: mockOpenid },
      create: {
        id: `user_${uuidv4().replace(/-/g, '').slice(0, 24)}`,
        username: mockOpenid,
        wechatUnionid: mockOpenid,
        nickname: '微信用户',
      },
    });

    return this.generateAuthResponse(user);
  }

  async refreshToken(refreshToken: string) {
    if (!refreshToken) {
      throw new BadRequestException('refreshToken 不能为空');
    }

    const tokenRecord = await this.prisma.refreshToken.findUnique({
      where: { token: refreshToken },
      include: { user: true },
    });

    if (!tokenRecord || tokenRecord.revoked || tokenRecord.expiresAt < new Date()) {
      throw new UnauthorizedException('刷新令牌无效或已过期');
    }

    // 撤销旧 token
    await this.prisma.refreshToken.update({
      where: { id: tokenRecord.id },
      data: { revoked: true },
    });

    return this.generateAuthResponse(tokenRecord.user);
  }

  private async generateAuthResponse(user: any) {
    const payload = { sub: user.id, username: user.username };
    const token = await this.jwtService.signAsync(payload);
    const refreshToken = `rt_${uuidv4().replace(/-/g, '')}`;

    // 保存 refresh token
    await this.prisma.refreshToken.create({
      data: {
        id: `rtid_${uuidv4().replace(/-/g, '').slice(0, 24)}`,
        userId: user.id,
        token: refreshToken,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30天
      },
    });

    return {
      token,
      refreshToken,
      user: {
        id: user.id,
        username: user.username,
        nickname: user.nickname,
        avatar: user.avatar,
        email: user.email,
        phone: user.phone,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
      expiresIn: 7200,
    };
  }
}