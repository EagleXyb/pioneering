// Upload 路由 —— 对应 Python app/api/v1/upload.py
import { FastifyPluginAsync } from 'fastify'
import { randomUUID } from 'crypto'
import path from 'path'
import fs from 'fs/promises'
import { authGuard } from '../plugins/auth.js'
import { BadRequestError, NotFoundError } from '../plugins/error-handler.js'
import { env } from '../config/env.js'
import { genId } from '../utils/id.js'

// 对应 Python: ALLOWED_TYPES
const ALLOWED_TYPES: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'application/pdf': '.pdf',
  'text/plain': '.txt',
}

export const uploadRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.register(async (app) => {
    app.addHook('preHandler', authGuard)

    // 对应 Python: @router.post("")
    app.post('/upload', { schema: { tags: ['upload'], summary: '上传文件', security: [{ BearerAuth: [] }] } }, async (req, reply) => {
      const data = await req.file()
      if (!data) {
        throw new BadRequestError('未提供文件')
      }

      const contentType = data.mimetype
      if (!(contentType in ALLOWED_TYPES)) {
        throw new BadRequestError('不支持的文件类型')
      }

      const ext = ALLOWED_TYPES[contentType]
      const filename = `${randomUUID().replace(/-/g, '')}${ext}`
      const uploadDir = path.resolve(env.UPLOAD_DIR, 'avatars')
      await fs.mkdir(uploadDir, { recursive: true })
      const filePath = path.join(uploadDir, filename)

      // 读取文件内容
      const chunks: Buffer[] = []
      for await (const chunk of data.file) {
        chunks.push(chunk as Buffer)
      }
      const content = Buffer.concat(chunks)

      if (content.length > env.MAX_UPLOAD_SIZE) {
        throw new BadRequestError('文件大小超过限制')
      }

      await fs.writeFile(filePath, content)

      const dbFile = await fastify.prisma.file.create({
        data: {
          id: genId('file_'),
          userId: req.user.id,
          originalName: data.filename || filename,
          fileType: contentType,
          fileSize: BigInt(content.length),
          filePath: filePath,
          url: `/uploads/avatars/${filename}`,
        },
      })

      // 对应 Python 返回的字段
      return {
        id: dbFile.id,
        url: dbFile.url,
        original_name: dbFile.originalName,
        file_type: dbFile.fileType,
        file_size: Number(dbFile.fileSize),
      }
    })

    // 对应 Python: @router.delete("/{file_id}")
    app.delete('/upload/:fileId', { schema: { tags: ['upload'], summary: '删除文件', security: [{ BearerAuth: [] }] } }, async (req, reply) => {
      const { fileId } = req.params as { fileId: string }

      const dbFile = await fastify.prisma.file.findFirst({
        where: { id: fileId, userId: req.user.id },
      })

      if (!dbFile) {
        throw new NotFoundError('文件不存在')
      }

      if (dbFile.filePath) {
        try {
          await fs.unlink(dbFile.filePath)
        } catch {
          // 文件不存在则忽略
        }
      }

      await fastify.prisma.file.delete({ where: { id: fileId } })

      return { message: '文件已删除' }
    })
  })
}
