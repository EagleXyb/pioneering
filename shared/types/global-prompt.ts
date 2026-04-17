export interface GlobalPrompt {
  id: number;
  name: string;
  promptKey?: string;
  description?: string;
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

export interface CreatePromptFormData {
  promptKey: string;
  name: string;
  description: string;
}

export interface UpdatePromptData {
  name?: string;
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

export type PromptStatus = 'online' | 'offline';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected';
