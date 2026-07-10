// ID 生成工具 —— 对应 Python app/models/user.py 的 gen_id / app/api/v1/chat.py 的 _gen_id
import { randomUUID } from 'crypto'

export function genId(prefix = ''): string {
  // 对应 Python: uuid.uuid4().hex[:24]
  const uid = randomUUID().replace(/-/g, '').slice(0, 24)
  return prefix ? `${prefix}${uid}` : uid
}
