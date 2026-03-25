// 全局Prompt类型定义

export interface GlobalPrompt {
  id: number;
  name: string;
  templateContent: string;
  version: number;
  status: 'online' | 'offline';
  approvalStatus: 'pending' | 'approved' | 'rejected';
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePromptData {
  name: string;
  templateContent: string;
  createdBy: string;
  promptKey?: string;
  description?: string;
}

// 新建Prompt表单数据
export interface CreatePromptFormData {
  promptKey: string;
  name: string;
  description: string;
}

export interface UpdatePromptData {
  templateContent?: string;
  status?: 'online' | 'offline';
  approvalStatus?: 'pending' | 'approved' | 'rejected';
  createdBy?: string;
}

export interface UpdateStatusData {
  status: 'online' | 'offline';
}

export interface UpdateApprovalData {
  approvalStatus: 'pending' | 'approved' | 'rejected';
}

export interface PromptListProps {
  onEdit: (prompt: GlobalPrompt) => void;
  onView: (prompt: GlobalPrompt) => void;
  onOnline: (id: number) => void;
  onOffline: (id: number) => void;
  onDelete: (id: number) => void;
  onCreate: () => void;
}

export type PromptStatus = 'online' | 'offline';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

// useGlobalPrompt Hook返回类型
export interface UseGlobalPromptReturn {
  prompts: GlobalPrompt[];
  loading: boolean;
  error: string | null;
  fetchPrompts: () => Promise<void>;
  handleOnline: (id: number) => Promise<GlobalPrompt | null>;
  handleOffline: (id: number) => Promise<GlobalPrompt | null>;
  handleDelete: (id: number) => Promise<void>;
  handleCreate: (data: CreatePromptData) => Promise<GlobalPrompt | null>;
  handleUpdate: (id: number, data: UpdatePromptData) => Promise<GlobalPrompt | null>;
  handleUpdateStatus: (id: number, status: 'online' | 'offline') => Promise<GlobalPrompt | null>;
  handleUpdateApproval: (id: number, approvalStatus: 'pending' | 'approved' | 'rejected') => Promise<GlobalPrompt | null>;
}