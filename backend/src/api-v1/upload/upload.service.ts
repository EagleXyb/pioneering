import { Injectable, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { v4 as uuidv4 } from 'uuid';
import { extname, join } from 'path';
import { writeFileSync, mkdirSync, existsSync, unlinkSync } from 'fs';

@Injectable()
export class UploadService {
  constructor(private prisma: PrismaService) {}

  async uploadFile(userId: string, file: Express.Multer.File, type: string = 'image') {
    if (!file) {
      throw new BadRequestException('请选择文件');
    }

    const UPLOAD_DIR = join(process.cwd(), '..', 'uploads', type);
    if (!existsSync(UPLOAD_DIR)) {
      mkdirSync(UPLOAD_DIR, { recursive: true });
    }

    const fileId = `file_${uuidv4().replace(/-/g, '').slice(0, 24)}`;
    const ext = extname(file.originalname);
    const fileName = `${fileId}${ext}`;
    const filePath = join(UPLOAD_DIR, fileName);

    writeFileSync(filePath, file.buffer);

    const url = `/uploads/${type}/${fileName}`;

    await this.prisma.file.create({
      data: {
        id: fileId,
        userId,
        originalName: file.originalname,
        fileType: file.mimetype,
        fileSize: BigInt(file.size),
        filePath,
        url,
      },
    });

    return {
      fileId,
      fileName: file.originalname,
      fileSize: file.size,
      fileType: file.mimetype,
      url,
    };
  }

  async deleteFile(userId: string, fileId: string) {
    const file = await this.prisma.file.findUnique({ where: { id: fileId } });
    if (!file) throw new NotFoundException('文件不存在');
    if (file.userId !== userId) throw new ForbiddenException('无权限删除该文件');

    // 删除物理文件
    if (file.filePath && existsSync(file.filePath)) {
      try {
        unlinkSync(file.filePath);
      } catch {}
    }

    await this.prisma.file.delete({ where: { id: fileId } });
  }
}