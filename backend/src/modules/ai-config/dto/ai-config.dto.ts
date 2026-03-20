export class CreateAiConfigDto {
  apiKey: string;
  provider: string;
  model: string;
  prompt: string;
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