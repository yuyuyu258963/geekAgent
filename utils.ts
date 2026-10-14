

export function truncate(text: string, maxLen: number): string {
  if(text.length <= maxLen) return text;
  return `${text.slice(0, maxLen)}\n ...(输出已截断，原共 ${text.length} 字符)`;
};