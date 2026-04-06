import { 
  Controller, 
  Get, 
  Post, 
  Put, 
  Patch, 
  Delete, 
  Body, 
  Param, 
  ParseIntPipe,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { v4 as uuidv4 } from 'uuid';
import { ProfileService } from './profile.service';
import { CreateProfileDto, UpdateProfileDto } from './dto/profile.dto';

const avatarStorage = diskStorage({
  destination: './uploads/avatars',
  filename: (req, file, callback) => {
    const uniqueName = `${uuidv4()}${extname(file.originalname)}`;
    callback(null, uniqueName);
  },
});

const imageFileFilter = (req: any, file: any, callback: any) => {
  if (!file.mimetype.match(/\/(jpg|jpeg|png|gif|webp)$/)) {
    return callback(new BadRequestException('只支持图片文件 (jpg, jpeg, png, gif, webp)'), false);
  }
  callback(null, true);
};

@Controller('api/profile')
export class ProfileController {
  constructor(private readonly profileService: ProfileService) {}

  @Post()
  create(@Body() createProfileDto: CreateProfileDto) {
    return this.profileService.create(createProfileDto);
  }

  @Get()
  findAll() {
    return this.profileService.findAll();
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.profileService.findOne(id);
  }

  @Get('email/:email')
  async findByEmail(@Param('email') email: string) {
    const profile = await this.profileService.findByEmail(email);
    if (profile) {
      if (profile.avatar && profile.avatar.trim() !== '') {
        profile.avatar = `http://localhost:3000${profile.avatar}`;
      } else {
        profile.avatar = null;
      }
    }
    return profile;
  }

  @Put(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateProfileDto: UpdateProfileDto,
  ) {
    return this.profileService.update(id, updateProfileDto);
  }

  @Post('avatar/:email')
  @UseInterceptors(FileInterceptor('avatar', {
    storage: avatarStorage,
    fileFilter: imageFileFilter,
    limits: { fileSize: 10 * 1024 * 1024 },
  }))
  async uploadAvatar(
    @Param('email') email: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('请选择图片文件');
    }
    
    const avatarPath = `/uploads/avatars/${file.filename}`;
    const result = await this.profileService.updateAvatar(email, avatarPath);
    
    return {
      ...result,
      avatar: `http://localhost:3000${avatarPath}`,
    };
  }

  @Post('upsert')
  upsert(@Body() createProfileDto: CreateProfileDto) {
    if (!createProfileDto.email) {
      throw new BadRequestException('Email不能为空');
    }
    return this.profileService.upsert(createProfileDto.email, createProfileDto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.profileService.remove(id);
  }
}
