export type PromptStatus = 'online' | 'offline';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

export interface GlobalPrompt {
  id: number;
  name: string;
  promptKey?: string;
  description?: string;
  templateContent: string;
  version: number;
  status: PromptStatus;
  approvalStatus: ApprovalStatus;
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

export interface CreatePromptFormData {
  promptKey: string;
  name: string;
  description: string;
}

export interface UpdatePromptData {
  name?: string;
  templateContent?: string;
  status?: PromptStatus;
  approvalStatus?: ApprovalStatus;
  createdBy?: string;
}

export interface UpdateStatusData {
  status: PromptStatus;
}

export interface UpdateApprovalData {
  approvalStatus: ApprovalStatus;
}

export interface PromptListProps {
  onEdit: (prompt: GlobalPrompt) => void;
  onView: (prompt: GlobalPrompt) => void;
  onOnline: (id: number) => void;
  onOffline: (id: number) => void;
  onDelete: (id: number) => void;
  onCreate: () => void;
}

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
  handleUpdateStatus: (id: number, status: PromptStatus) => Promise<GlobalPrompt | null>;
  handleUpdateApproval: (id: number, approvalStatus: ApprovalStatus) => Promise<GlobalPrompt | null>;
  currentEditingPrompt: GlobalPrompt | null;
  isEditing: boolean;
  enterEditMode: (prompt: GlobalPrompt) => void;
  exitEditMode: () => void;
}
