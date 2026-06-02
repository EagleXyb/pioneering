import React, { useState } from 'react'
import { Drawer, Slider, Textarea, Switch, Select, Button } from 'tdesign-react'

export interface AgentParams {
  temperature: number
  maxTokens: number
  topP: number
  systemPrompt: string
  enableMemory: boolean
  enableReflection: boolean
}

const DEFAULT_PARAMS: AgentParams = {
  temperature: 0.7,
  maxTokens: 2048,
  topP: 0.9,
  systemPrompt: '',
  enableMemory: true,
  enableReflection: false,
}

const PRESET_SYSTEM_PROMPTS = [
  { label: '默认', value: '' },
  { label: '专业助手', value: '你是一名专业的技术助手,回答准确、简洁、有条理。' },
  { label: '代码专家', value: '你是一名资深的软件工程师,擅长多种编程语言和架构设计。' },
  { label: '研究员', value: '你是一名严谨的研究员,回答需要引用来源,并保持客观中立。' },
]

interface ParamPanelProps {
  visible: boolean
  onClose: () => void
  params: AgentParams
  onChange: (params: AgentParams) => void
}

export const ParamPanel: React.FC<ParamPanelProps> = ({ visible, onClose, params, onChange }) => {
  const [localParams, setLocalParams] = useState<AgentParams>({ ...params })

  const handleApply = () => {
    onChange(localParams)
    onClose()
  }

  const handleReset = () => {
    setLocalParams({ ...DEFAULT_PARAMS })
  }

  return (
    <Drawer
      header="Agent 参数配置"
      visible={visible}
      onClose={onClose}
      size="400px"
      footer={
        <div className="param-panel-footer">
          <Button theme="default" variant="outline" onClick={handleReset}>
            恢复默认
          </Button>
          <Button theme="default" variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button theme="primary" onClick={handleApply}>
            应用
          </Button>
        </div>
      }
    >
      <div className="param-panel-content">
        <div className="param-item">
          <label className="param-label">Temperature: {localParams.temperature.toFixed(2)}</label>
          <Slider
            value={localParams.temperature}
            min={0}
            max={2}
            step={0.05}
            onChange={(v) => setLocalParams({ ...localParams, temperature: v as number })}
            marks={{ 0: '精确', 1: '平衡', 2: '创意' }}
          />
        </div>

        <div className="param-item">
          <label className="param-label">最大 Token 数: {localParams.maxTokens}</label>
          <Slider
            value={localParams.maxTokens}
            min={256}
            max={8192}
            step={256}
            onChange={(v) => setLocalParams({ ...localParams, maxTokens: v as number })}
          />
        </div>

        <div className="param-item">
          <label className="param-label">Top P: {localParams.topP.toFixed(2)}</label>
          <Slider
            value={localParams.topP}
            min={0}
            max={1}
            step={0.05}
            onChange={(v) => setLocalParams({ ...localParams, topP: v as number })}
          />
        </div>

        <div className="param-item">
          <label className="param-label">系统提示词</label>
          <Select
            value={localParams.systemPrompt}
            options={PRESET_SYSTEM_PROMPTS}
            placeholder="选择预设或自定义"
            onChange={(v) => setLocalParams({ ...localParams, systemPrompt: v as string })}
            clearable
          />
          <Textarea
            value={localParams.systemPrompt}
            autosize={{ minRows: 3, maxRows: 6 }}
            placeholder="自定义系统提示词..."
            onChange={(v) => setLocalParams({ ...localParams, systemPrompt: v as string })}
            style={{ marginTop: 8 }}
          />
        </div>

        <div className="param-item">
          <div className="param-switch-row">
            <span className="param-label">启用长期记忆</span>
            <Switch
              value={localParams.enableMemory}
              onChange={(v) => setLocalParams({ ...localParams, enableMemory: v })}
            />
          </div>
        </div>

        <div className="param-item">
          <div className="param-switch-row">
            <span className="param-label">启用反思机制</span>
            <Switch
              value={localParams.enableReflection}
              onChange={(v) => setLocalParams({ ...localParams, enableReflection: v })}
            />
          </div>
        </div>
      </div>
    </Drawer>
  )
}

export const useAgentParams = () => {
  const [params, setParams] = useState<AgentParams>(DEFAULT_PARAMS)
  return { params, setParams }
}
