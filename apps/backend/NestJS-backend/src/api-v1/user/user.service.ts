import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class UserService {
  constructor(private prisma: PrismaService) {}

  async listUsers(query: {
    page?: number;
    pageSize?: number;
    search?: string;
  }) {
    const page = query.page || 1;
    const pageSize = query.pageSize || 20;
    const where: any = {};
    if (query.search) {
      where.OR = [
        { username: { contains: query.search } },
        { nickname: { contains: query.search } },
        { email: { contains: query.search } },
      ];
    }

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { userQuota: true },
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      list: users.map((u: any) => ({
        id: u.id,
        username: u.username,
        nickname: u.nickname,
        email: u.email,
        phone: u.phone,
        avatar: u.avatar,
        status: u.status,
        totalTokens: u.userQuota ? Number(u.userQuota.totalTokens) : 0,
        usedTokens: u.userQuota ? Number(u.userQuota.usedTokens) : 0,
        dailyLimit: u.userQuota ? Number(u.userQuota.dailyLimit) : 0,
        dailyUsed: u.userQuota ? Number(u.userQuota.dailyUsed) : 0,
        createdAt: u.createdAt,
        updatedAt: u.updatedAt,
      })),
      total,
      page,
      pageSize,
    };
  }

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('用户不存在');
    }
    return {
      id: user.id,
      username: user.username,
      nickname: user.nickname,
      avatar: user.avatar,
      email: user.email,
      phone: user.phone,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  async updateProfile(userId: string, data: { nickname?: string; avatar?: string }) {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data,
    });
    return {
      id: user.id,
      username: user.username,
      nickname: user.nickname,
      avatar: user.avatar,
      email: user.email,
      phone: user.phone,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  async getQuota(userId: string) {
    const quota = await this.prisma.userQuota.findUnique({ where: { userId } });
    if (!quota) {
      return {
        totalTokens: 1000000,
        usedTokens: 0,
        remainingTokens: 1000000,
        dailyLimit: 100000,
        dailyUsed: 0,
      };
    }
    const totalTokens = Number(quota.totalTokens);
    const usedTokens = Number(quota.usedTokens);
    return {
      totalTokens,
      usedTokens,
      remainingTokens: totalTokens - usedTokens,
      dailyLimit: Number(quota.dailyLimit),
      dailyUsed: Number(quota.dailyUsed),
    };
  }

  async getUsage(
    userId: string,
    query: {
      startDate?: string;
      endDate?: string;
      model?: string;
      sessionId?: string;
      page?: number;
      pageSize?: number;
    },
  ) {
    const page = query.page || 1;
    const pageSize = query.pageSize || 20;

    const where: any = { userId };
    if (query.startDate || query.endDate) {
      where.createdAt = {};
      if (query.startDate) where.createdAt.gte = new Date(query.startDate);
      if (query.endDate) where.createdAt.lte = new Date(query.endDate + 'T23:59:59.999Z');
    }
    if (query.model) where.model = query.model;
    if (query.sessionId) where.sessionId = query.sessionId;

    const [records, total] = await Promise.all([
      this.prisma.tokenUsage.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.tokenUsage.count({ where }),
    ]);

    const formattedRecords = records.map((r: any) => ({
      id: Number(r.id),
      sessionId: r.sessionId,
      model: r.model,
      promptTokens: r.promptTokens,
      completionTokens: r.completionTokens,
      totalTokens: r.totalTokens,
      cost: r.cost ? Number(r.cost) : 0,
      createdAt: r.createdAt,
    }));

    // 汇总
    const aggResult = await this.prisma.tokenUsage.aggregate({
      where,
      _sum: {
        totalTokens: true,
        cost: true,
      },
    });

    return {
      records: formattedRecords,
      total,
      page,
      pageSize,
      summary: {
        totalTokens: aggResult._sum.totalTokens || 0,
        totalCost: aggResult._sum.cost ? Number(aggResult._sum.cost) : 0,
      },
    };
  }
}