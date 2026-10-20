// 示例技能：math（P0 · 0.6「造一个可达技能」）
//
// SkillLoader 的发现约定：<auto_discover_dirs>/<skill>/skill.{js,ts}
// 该文件从编译产物引入 MathSkill，因此使用前需先构建：
//   cd packages/modu-agent && npm run build
//
// 启用方式（config.yaml，默认不开启，保持「默认等价」纪律）：
//   skills:
//     enabled: true
//     auto_discover_dirs:
//       - ./skills
//     active:
//       - math
import { MathSkill } from '../../dist/skills/index.js'

export const skill = new MathSkill()
