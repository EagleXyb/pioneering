import { Controller, Get, Put, Body, Query } from '@nestjs/common';
import { UserService } from './user.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UpdateProfileDto } from './dto/user.dto';
import { QueryUsageDto } from './dto/usage.dto';

@Controller('user')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get('list')
  listUsers(@Query('page') page?: string, @Query('pageSize') pageSize?: string, @Query('search') search?: string) {
    return this.userService.listUsers({
      page: page ? parseInt(page, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
      search,
    });
  }

  @Get('profile')
  getProfile(@CurrentUser('sub') userId: string) {
    return this.userService.getProfile(userId);
  }

  @Put('profile')
  updateProfile(
    @CurrentUser('sub') userId: string,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.userService.updateProfile(userId, dto);
  }

  @Get('quota')
  getQuota(@CurrentUser('sub') userId: string) {
    return this.userService.getQuota(userId);
  }

  @Get('quota/usage')
  getUsage(
    @CurrentUser('sub') userId: string,
    @Query() query: QueryUsageDto,
  ) {
    return this.userService.getUsage(userId, query);
  }
}