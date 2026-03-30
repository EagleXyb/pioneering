import { Injectable, NotFoundException, ConflictException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateGlobalPromptDto, UpdateGlobalPromptDto, UpdateStatusDto, UpdateApprovalDto } from './dto/global-prompt.dto';

@Injectable()
export class GlobalPromptService {
  private readonly logger = new Logger(GlobalPromptService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * 创建全局Prompt
   * - name 全局唯一
   * - 新建默认 status=offline, approvalStatus=pending
   */
  async create(dto: CreateGlobalPromptDto) {
    this.logger.log(`创建全局Prompt: ${dto.name}`);

    if (!dto.name || !dto.createdBy) {
      throw new BadRequestException('name和createdBy为必填字段');
    }

    const templateContent = dto.templateContent || '';

    // 检查名称是否已存在
    const existing = await this.prisma.globalPrompt.findUnique({
      where: { name: dto.name },
    });
    if (existing) {
      this.logger.warn(`Prompt "${dto.name}" 已存在`);
      throw new ConflictException(`Prompt "${dto.name}" 已存在`);
    }

    try {
      const prompt = await this.prisma.globalPrompt.create({
        data: {
          name: dto.name,
          templateContent: templateContent,
          createdBy: dto.createdBy,
        },
      });
      this.logger.log(`全局Prompt创建成功: ${prompt.id}`);
      return prompt;
    } catch (error) {
      this.logger.error(`创建全局Prompt失败: ${error.message}`);
      throw error;
    }
  }

  /**
   * 查询所有全局Prompt，支持按 status / approvalStatus 筛选
   */
  async findAll(filters?: { status?: string; approvalStatus?: string }) {
    this.logger.log(`查询全局Prompt列表，筛选条件: ${JSON.stringify(filters)}`);
    
    try {
      const prompts = await this.prisma.globalPrompt.findMany({
        where: {
          ...(filters?.status && { status: filters.status }),
          ...(filters?.approvalStatus && { approvalStatus: filters.approvalStatus }),
        },
        orderBy: { updatedAt: 'desc' },
      });
      this.logger.log(`查询到 ${prompts.length} 个全局Prompt`);
      return prompts;
    } catch (error) {
      this.logger.error(`查询全局Prompt列表失败: ${error.message}`);
      throw error;
    }
  }

  /**
   * 获取当前 online 的全局Prompt（业务调用入口）
   * 同一时刻最多仅有一个 online 状态的 Prompt
   */
  async findOnline() {
    this.logger.log('获取当前在线的全局Prompt');
    
    try {
      const prompt = await this.prisma.globalPrompt.findFirst({
        where: { status: 'online' },
        orderBy: { updatedAt: 'desc' },
      });
      if (prompt) {
        this.logger.log(`当前在线Prompt: ${prompt.name} (ID: ${prompt.id})`);
      } else {
        this.logger.warn('当前没有在线的全局Prompt');
      }
      return prompt;
    } catch (error) {
      this.logger.error(`获取在线Prompt失败: ${error.message}`);
      throw error;
    }
  }

  /**
   * 按ID查询
   */
  async findOne(id: number) {
    this.logger.log(`按ID查询全局Prompt: ${id}`);
    
    const prompt = await this.prisma.globalPrompt.findUnique({ where: { id } });
    if (!prompt) {
      this.logger.warn(`GlobalPrompt ID ${id} 不存在`);
      throw new NotFoundException(`GlobalPrompt ID ${id} 不存在`);
    }
    return prompt;
  }

  /**
   * 按name查询
   */
  async findByName(name: string) {
    this.logger.log(`按名称查询全局Prompt: ${name}`);
    
    const prompt = await this.prisma.globalPrompt.findUnique({ where: { name } });
    if (!prompt) {
      this.logger.warn(`GlobalPrompt "${name}" 不存在`);
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
    this.logger.log(`更新全局Prompt: ${id}, 数据: ${JSON.stringify(dto)}`);
    
    const prompt = await this.findOne(id);

    // 如果修改了名称，直接更新，不限制状态
    if (dto.name !== undefined) {
      try {
        const updatedPrompt = await this.prisma.globalPrompt.update({
          where: { id },
          data: {
            name: dto.name,
            ...(dto.createdBy && { createdBy: dto.createdBy }),
          },
        });
        this.logger.log(`全局Prompt名称更新成功: ${id}`);
        return updatedPrompt;
      } catch (error) {
        this.logger.error(`更新全局Prompt名称失败: ${error.message}`);
        throw error;
      }
    }

    // 如果修改了模板内容，需要校验当前状态
    if (dto.templateContent !== undefined) {
      if (prompt.status === 'online') {
        this.logger.warn(`尝试修改在线状态的Prompt内容: ${id}`);
        throw new BadRequestException('online 状态的 Prompt 不允许直接修改内容，请先下线');
      }
      
      if (prompt.approvalStatus === 'approved') {
        this.logger.warn(`尝试修改已审批通过的Prompt内容: ${id}`);
        throw new BadRequestException('已审批通过的 Prompt 不允许修改内容');
      }
      
      // 版本号自增
      const newVersion = prompt.version + 1;
      
      try {
        const updatedPrompt = await this.prisma.globalPrompt.update({
          where: { id },
          data: {
            templateContent: dto.templateContent,
            version: newVersion,
            approvalStatus: 'pending',
            ...(dto.createdBy && { createdBy: dto.createdBy }),
          },
        });
        this.logger.log(`全局Prompt更新成功: ${id}, 版本: ${newVersion}`);
        return updatedPrompt;
      } catch (error) {
        this.logger.error(`更新全局Prompt失败: ${error.message}`);
        throw error;
      }
    }

    // 仅修改状态字段
    try {
      const updatedPrompt = await this.prisma.globalPrompt.update({
        where: { id },
        data: {
          ...(dto.status && { status: dto.status }),
          ...(dto.approvalStatus && { approvalStatus: dto.approvalStatus }),
          ...(dto.createdBy && { createdBy: dto.createdBy }),
        },
      });
      this.logger.log(`全局Prompt状态更新成功: ${id}`);
      return updatedPrompt;
    } catch (error) {
      this.logger.error(`更新全局Prompt状态失败: ${error.message}`);
      throw error;
    }
  }

  /**
   * 上线/下线 Prompt
   * - 上线前必须已审批通过 (approved)
   * - 上线时自动将所有其他Prompt下线（确保系统中只有一个在线）
   */
  async updateStatus(id: number, dto: UpdateStatusDto) {
    this.logger.log(`更新Prompt状态: ${id}, 状态: ${dto.status}`);
    
    const prompt = await this.findOne(id);

    if (dto.status === 'online') {
      // 上线前必须审批通过
      if (prompt.approvalStatus !== 'approved') {
        this.logger.warn(`尝试上线未审批通过的Prompt: ${id}, 状态: ${prompt.approvalStatus}`);
        throw new BadRequestException('仅审批通过的 Prompt 才能上线');
      }
      
      try {
        // 使用事务确保数据一致性
        const updatedPrompt = await this.prisma.$transaction(async (prisma) => {
          // 将所有其他Prompt设为 offline
          await prisma.globalPrompt.updateMany({
            where: {
              status: 'online',
              id: { not: id },
            },
            data: { status: 'offline' },
          });
          
          // 将当前Prompt设为 online
          return prisma.globalPrompt.update({
            where: { id },
            data: { status: dto.status },
          });
        });
        
        this.logger.log(`Prompt上线成功: ${id}, 名称: ${prompt.name}`);
        return updatedPrompt;
      } catch (error) {
        this.logger.error(`Prompt上线失败: ${error.message}`);
        throw error;
      }
    } else {
      // 下线操作
      try {
        const updatedPrompt = await this.prisma.globalPrompt.update({
          where: { id },
          data: { status: dto.status },
        });
        this.logger.log(`Prompt下线成功: ${id}`);
        return updatedPrompt;
      } catch (error) {
        this.logger.error(`Prompt下线失败: ${error.message}`);
        throw error;
      }
    }
  }

  /**
   * 审批操作
   * - approved: 审批通过
   * - rejected: 审批驳回
   * - pending: 退回待审
   */
  async updateApproval(id: number, dto: UpdateApprovalDto) {
    this.logger.log(`审批Prompt: ${id}, 状态: ${dto.approvalStatus}`);
    
    const prompt = await this.findOne(id);
    
    // 检查审批状态变更的合理性
    if (dto.approvalStatus === 'approved') {
      this.logger.log(`Prompt审批通过: ${id}`);
    } else if (dto.approvalStatus === 'rejected') {
      this.logger.log(`Prompt审批驳回: ${id}`);
    } else if (dto.approvalStatus === 'pending') {
      this.logger.log(`Prompt退回待审: ${id}`);
    }
    
    try {
      const updatedPrompt = await this.prisma.globalPrompt.update({
        where: { id },
        data: { approvalStatus: dto.approvalStatus },
      });
      this.logger.log(`Prompt审批状态更新成功: ${id}`);
      return updatedPrompt;
    } catch (error) {
      this.logger.error(`更新审批状态失败: ${error.message}`);
      throw error;
    }
  }

  /**
   * 删除全局Prompt
   * - online 状态不允许删除
   */
  async remove(id: number) {
    this.logger.log(`删除全局Prompt: ${id}`);
    
    const prompt = await this.findOne(id);

    if (prompt.status === 'online') {
      this.logger.warn(`尝试删除在线状态的Prompt: ${id}`);
      throw new BadRequestException('online 状态的 Prompt 不允许删除，请先下线');
    }

    try {
      const deletedPrompt = await this.prisma.globalPrompt.delete({
        where: { id },
      });
      this.logger.log(`全局Prompt删除成功: ${id}`);
      return deletedPrompt;
    } catch (error) {
      this.logger.error(`删除全局Prompt失败: ${error.message}`);
      throw error;
    }
  }
}
