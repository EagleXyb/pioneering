// T5.3：场景包启动装配。
//
// 读取 RuntimeConfig `scenario.packs`（场景包名列表），经全局
// ScenarioLoader 逐个 activate；单个包失败不阻断其余包与服务启动。
// 默认列表为空 → 无激活、行为与此前完全一致。
//
// 配置归属说明：`scenario.packs` 是**宿主层启动策略**，消费方仅在宿主
// （本文件），故不放入 modu-agent 的 DEFAULT_CONFIG（框架审计要求「框架声明键
// 必须在框架内消费」）。它经 modu-agent YAML 加载的「新增键放行」机制
// （validateAgainstBase 对 base 中不存在的键原样保留）进入运行时配置，
// 由宿主在 config.yaml 的 scenario.packs 中声明。
import {
  getConfig,
  getScenarioLoader,
} from '@pioneering/modu-agent'

/**
 * 激活配置中的全部场景包。
 *
 * @returns 成功激活的包名列表（失败项仅记录错误并跳过）
 */
export async function activateConfiguredPacks(): Promise<string[]> {
  const config = getConfig()
  const packs = (config.get('scenario.packs', []) ?? []) as string[]
  if (!Array.isArray(packs) || packs.length === 0) {
    return []
  }

  const loader = getScenarioLoader()
  const activated: string[] = []

  for (const name of packs.map(String)) {
    if (loader.isActive(name)) {
      activated.push(name)
      continue
    }
    try {
      await loader.activate(name)
      activated.push(name)
    } catch (e) {
      console.error(
        `[scenario-boot] failed to activate scenario pack '${name}': ` +
          (e instanceof Error ? e.message : String(e)),
      )
    }
  }

  if (activated.length > 0) {
    console.info(
      `[scenario-boot] scenario packs active: ${activated.join(', ')}`,
    )
  }
  return activated
}
