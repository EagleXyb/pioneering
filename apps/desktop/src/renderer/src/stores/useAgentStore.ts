// ============================================================
// Agent Store — Agent 执行状态管理 (Zustand)
// ============================================================

import { create } from 'zustand'
import type { AgentStep, AgentExecution } from '../types/agent'

interface AgentState {
  // 执行列表
  executions: AgentExecution[]
  currentExecutionId: string | null

  // 当前执行进度
  steps: AgentStep[]
  currentStepIndex: number
  status: 'idle' | 'running' | 'completed' | 'error'
  error: string | null

  // Actions
  startExecution: (instruction: string) => void
  addStep: (step: AgentStep) => void
  updateStep: (stepId: string, updates: Partial<AgentStep>) => void
  nextStep: () => void
  completeExecution: () => void
  failExecution: (error: string) => void
  reset: () => void
}

export const useAgentStore = create<AgentState>((set, get) => ({
  executions: [],
  currentExecutionId: null,
  steps: [],
  currentStepIndex: 0,
  status: 'idle',
  error: null,

  startExecution: (instruction) => {
    const execution: AgentExecution = {
      id: crypto.randomUUID(),
      instruction,
      steps: [],
      status: 'running',
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
    set((s) => ({
      executions: [execution, ...s.executions],
      currentExecutionId: execution.id,
      steps: [],
      currentStepIndex: 0,
      status: 'running',
      error: null
    }))
  },

  addStep: (step) => {
    set((s) => ({
      steps: [...s.steps, step]
    }))
  },

  updateStep: (stepId, updates) => {
    set((s) => ({
      steps: s.steps.map((step) =>
        step.id === stepId ? { ...step, ...updates } : step
      )
    }))
  },

  nextStep: () => {
    set((s) => ({
      currentStepIndex: s.currentStepIndex + 1
    }))
  },

  completeExecution: () => {
    const { currentExecutionId, executions } = get()
    set({
      status: 'completed',
      executions: executions.map((ex) =>
        ex.id === currentExecutionId
          ? { ...ex, status: 'completed', updatedAt: Date.now() }
          : ex
      )
    })
  },

  failExecution: (error) => {
    const { currentExecutionId, executions } = get()
    set({
      status: 'error',
      error,
      executions: executions.map((ex) =>
        ex.id === currentExecutionId
          ? { ...ex, status: 'error', error, updatedAt: Date.now() }
          : ex
      )
    })
  },

  reset: () => {
    set({
      steps: [],
      currentStepIndex: 0,
      status: 'idle',
      error: null
    })
  }
}))
