export function stripThinkTags(content: string): string {
  return content
    .replace(/<think[^>]*>/gi, '')
    .replace(/<\/think\s*>/gi, '');
}
