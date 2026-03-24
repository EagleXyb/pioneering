export class CreateGlobalPromptDto {
  name: string;
  templateContent: string;
  createdBy: string;
}

export class UpdateGlobalPromptDto {
  templateContent?: string;
  status?: 'online' | 'offline';
  approvalStatus?: 'pending' | 'approved' | 'rejected';
  createdBy?: string;
}

export class UpdateStatusDto {
  status: 'online' | 'offline';
}

export class UpdateApprovalDto {
  approvalStatus: 'pending' | 'approved' | 'rejected';
}
