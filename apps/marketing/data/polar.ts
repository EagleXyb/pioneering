export interface Polar {
  flag: string
  pct: string
  label: string
  data: string
}

export const polars: Polar[] = [
  {
    flag: '🇺🇸 美国',
    pct: '38%',
    label: '全球 AI 投资占比',
    data: '私人投资 $1,091 亿 | 顶级模型数量领先 | 仅领先中国 2.7%',
  },
  {
    flag: '🇨🇳 中国',
    pct: '26%',
    label: '全球 AI 投资占比',
    data: '论文及引用量居首 | 专利总量领先 | 工业机器人安装量第一',
  },
  {
    flag: '🇪🇺 欧盟',
    pct: '18%',
    label: '全球 AI 投资占比',
    data: 'EU AI Act 率先生效 | 全球监管信任度最高 | 开源生态贡献增长迅速',
  },
]
