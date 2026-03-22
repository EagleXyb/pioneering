export class CreateAiConfigDto {
  apiKey: string;
  provider: string;
  model: string;
  prompt: string;
  lastTestInput?: string;
  lastTestResult?: string;
  lastTestTime?: Date;
}

export class UpdateAiConfigDto {
  apiKey?: string;
  provider?: string;
  model?: string;
  prompt?: string;
  lastTestInput?: string;
  lastTestResult?: string;
  lastTestTime?: Date;
}

export class TestConnectionDto {
  apiKey: string;
  provider: string;
  model: string;
}

export class TestConnectionResultDto {
  success: boolean;
  message: string;
  responseTime?: number;
  error?: string;
}