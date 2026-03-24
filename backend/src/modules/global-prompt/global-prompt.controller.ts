import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  ParseIntPipe,
} from '@nestjs/common';
import { GlobalPromptService } from './global-prompt.service';
import {
  CreateGlobalPromptDto,
  UpdateGlobalPromptDto,
  UpdateStatusDto,
  UpdateApprovalDto,
} from './dto/global-prompt.dto';

@Controller('api/global-prompt')
export class GlobalPromptController {
  constructor(private readonly globalPromptService: GlobalPromptService) {}

  /** 创建全局Prompt */
  @Post()
  create(@Body() dto: CreateGlobalPromptDto) {
    return this.globalPromptService.create(dto);
  }

  /** 查询列表，支持 status / approvalStatus 筛选 */
  @Get()
  findAll(
    @Query('status') status?: string,
    @Query('approvalStatus') approvalStatus?: string,
  ) {
    return this.globalPromptService.findAll({ status, approvalStatus });
  }

  /** 获取当前 online 的 Prompt（业务调用入口） */
  @Get('online')
  findOnline() {
    return this.globalPromptService.findOnline();
  }

  /** 按 name 查询 */
  @Get('name/:name')
  findByName(@Param('name') name: string) {
    return this.globalPromptService.findByName(name);
  }

  /** 按 ID 查询 */
  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.globalPromptService.findOne(id);
  }

  /** 更新 Prompt 内容（自动 version +1，重置审批状态） */
  @Put(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateGlobalPromptDto,
  ) {
    return this.globalPromptService.update(id, dto);
  }

  /** 上线 / 下线 */
  @Patch(':id/status')
  updateStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateStatusDto,
  ) {
    return this.globalPromptService.updateStatus(id, dto);
  }

  /** 审批操作 */
  @Patch(':id/approval')
  updateApproval(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateApprovalDto,
  ) {
    return this.globalPromptService.updateApproval(id, dto);
  }

  /** 删除 Prompt */
  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.globalPromptService.remove(id);
  }
}
