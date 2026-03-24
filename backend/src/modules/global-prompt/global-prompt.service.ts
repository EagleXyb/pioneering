import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateGlobalPromptDto, UpdateGlobalPromptDto, UpdateStatusDto, UpdateApprovalDto } from './dto/global-prompt.dto';

@Injectable()
export class GlobalPromptService {
  constructor(private prisma: PrismaService) {}

  /**
   * 创建全局Prompt
   * - name 全局唯一
   * - 新建默认 status=offline, approvalStatus=pending
   */
  async create(dto: CreateGlobalPromptDto) {
    const existing = await this.prisma.globalPrompt.findUnique({
      where: { name: dto.name },
    });
    if (existing) {
      throw new ConflictException(`Prompt "${dto.name}" 已存在`);
    }

    return this.prisma.globalPrompt.create({
      data: {
        name: dto.name,
        templateContent: dto.templateContent,
        createdBy: dto.createdBy,
      },
    });
  }

  /**
   * 查询所有全局Prompt，支持按 status / approvalStatus 筛选
   */
  async findAll(filters?: { status?: string; approvalStatus?: string }) {
    return this.prisma.globalPrompt.findMany({
      where: {
        ...(filters?.status && { status: filters.status }),
        ...(filters?.approvalStatus && { approvalStatus: filters.approvalStatus }),
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  /**
   * 获取当前 online 的全局Prompt（业务调用入口）
   * 同一时刻最多仅有一个 online 状态的 Prompt
   */
  async findOnline() {
    return this.prisma.globalPrompt.findFirst({
      where: { status: 'online' },
    });
  }

  /**
   * 按ID查询
   */
  async findOne(id: number) {
    const prompt = await this.prisma.globalPrompt.findUnique({ where: { id } });
    if (!prompt) {
      throw new NotFoundException(`GlobalPrompt ID ${id} 不存在`);
    }
    return prompt;
  }

  /**
   * 按name查询
   */
  async findByName(name: string) {
    const prompt = await this.prisma.globalPrompt.findUnique({ where: { name } });
    if (!prompt) {
      throw new NotFoundException(`GlobalPrompt "${name}" 不存在`);
    }
    return prompt;
  }

  /**
   * 更新全局Prompt内容
   * - 修改 templateContent 时自动 version +1
   * - 仅允许 pending 或 rejected 状态下编辑内容
   */
  async update(id: number, dto: UpdateGlobalPromptDto) {
    const prompt = await this.findOne(id);

    // 如果修改了模板内容，需要校验当前状态
    if (dto.templateContent !== undefined) {
      if (prompt.status === 'online') {
        throw new BadRequestException('online 状态的 Prompt 不允许直接修改内容，请先下线');
      }
      // 版本号自增
      const newVersion = prompt.version + 1;
      return this.prisma.globalPrompt.update({
        where: { id },
        data: {
          templateContent: dto.templateContent,
          version: newVersion,
          // 修改内容后重置审批状态为 pending
          approvalStatus: 'pending',
          ...(dto.createdBy && { createdBy: dto.createdBy }),
        },
      });
    }

    // 仅修改状态字段
    return this.prisma.globalPrompt.update({
      where: { id },
      data: {
        ...(dto.status && { status: dto.status }),
        ...(dto.approvalStatus && { approvalStatus: dto.approvalStatus }),
        ...(dto.createdBy && { createdBy: dto.createdBy }),
      },
    });
  }

  /**
   * 上线/下线 Prompt
   * - 上线前必须已审批通过 (approved)
   * - 上线时自动将同 name 下其他版本下线
   */
  async updateStatus(id: number, dto: UpdateStatusDto) {
    const prompt = await this.findOne(id);

    if (dto.status === 'online') {
      // 上线前必须审批通过
      if (prompt.approvalStatus !== 'approved') {
        throw new BadRequestException('仅审批通过的 Prompt 才能上线');
      }
      // 将同 name 下其他记录设为 offline
      await this.prisma.globalPrompt.updateMany({
        where: {
          name: prompt.name,
          status: 'online',
          id: { not: id },
        },
        data: { status: 'offline' },
      });
    }

    return this.prisma.globalPrompt.update({
      where: { id },
      data: { status: dto.status },
    });
  }

  /**
   * 审批操作
   * - approved: 审批通过
   * - rejected: 审批驳回
   * - pending: 退回待审
   */
  async updateApproval(id: number, dto: UpdateApprovalDto) {
    await this.findOne(id);

    return this.prisma.globalPrompt.update({
      where: { id },
      data: { approvalStatus: dto.approvalStatus },
    });
  }

  /**
   * 删除全局Prompt
   * - online 状态不允许删除
   */
  async remove(id: number) {
    const prompt = await this.findOne(id);

    if (prompt.status === 'online') {
      throw new BadRequestException('online 状态的 Prompt 不允许删除，请先下线');
    }

    return this.prisma.globalPrompt.delete({
      where: { id },
    });
  }
}
