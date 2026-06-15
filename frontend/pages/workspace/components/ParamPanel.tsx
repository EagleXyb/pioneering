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
  { label: 'Default', value: '' },
  { label: 'Professional Assistant', value: 'You are a professional technical assistant. Answer accurately, concisely, and logically.' },
  { label: 'Code Expert', value: 'You are a senior software engineer proficient in multiple programming languages and architecture design.' },
  { label: 'Researcher', value: 'You are a rigorous researcher. Answers need citations and must remain objective and neutral.' },
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
      header="Agent Parameters"
      visible={visible}
      onClose={onClose}
      size="400px"
      footer={
        <div className="param-panel-footer">
          <Button theme="default" variant="outline" onClick={handleReset}>
            Reset
          </Button>
          <Button theme="default" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button theme="primary" onClick={handleApply}>
            Apply
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
            marks={{ 0: 'Precise', 1: 'Balanced', 2: 'Creative' }}
          />
        </div>

        <div className="param-item">
          <label className="param-label">Max Tokens {localParams.maxTokens}</label>
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
          <label className="param-label">System Prompt</label>
          <Select
            value={localParams.systemPrompt}
            options={PRESET_SYSTEM_PROMPTS}
            placeholder="Select preset or custom"
            onChange={(v) => setLocalParams({ ...localParams, systemPrompt: v as string })}
            clearable
          />
          <Textarea
            value={localParams.systemPrompt}
            autosize={{ minRows: 3, maxRows: 6 }}
            placeholder="Custom system prompt..."
            onChange={(v) => setLocalParams({ ...localParams, systemPrompt: v as string })}
            style={{ marginTop: 8 }}
          />
        </div>

        <div className="param-item">
          <div className="param-switch-row">
            <span className="param-label">Enable Long-term Memory</span>
            <Switch
              value={localParams.enableMemory}
              onChange={(v) => setLocalParams({ ...localParams, enableMemory: v })}
            />
          </div>
        </div>

        <div className="param-item">
          <div className="param-switch-row">
            <span className="param-label">Enable Reflection</span>
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
