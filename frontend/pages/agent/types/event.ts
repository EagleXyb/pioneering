export interface StreamEvent {
  type:
    | 'status'
    | 'thinking_delta'
    | 'thinking_done'
    | 'tool_call_start'
    | 'tool_call_delta'
    | 'tool_call_end'
    | 'tool_result_start'
    | 'tool_result_delta'
    | 'tool_result_end'
    | 'answer_delta'
    | 'answer_done'
    | 'reasoning_iteration'
    | 'error'
  stepId?: string
  iterationIndex?: number
  maxIterations?: number
  status?: string
  content?: string
  error?: string
  errorCode?: string
  id?: string
  name?: string
  arguments?: string
  result?: string
  message?: string
  recoverable?: boolean
  suggestedAction?: string
}
