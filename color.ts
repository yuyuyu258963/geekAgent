export const userColor = process.stdout.isTTY;

export const colorMap: Record<string, string> = {
  USER: 'user',
  MODEL: 'model',
  TOOL: 'tool',
  SYS: 'sys',
}

export const C = {
  reset: '\x1b[0m',
  user: '\x1b[36m', // 青色
  model: '\x1b[32m', // 绿色
  tool: '\x1b[33m', // 黄色
  sys: '\x1b[90m', // 灰色
};

export function paint(color: keyof typeof C, s: string): string {
  return userColor ? `${C[color]}${s}${C.reset}` : s;
}

// 按颜色写一段 stdout，nl 为 true 时末尾补换行
export function out(color: keyof typeof C, s = '', nl = false): void {
  process.stdout.write(paint(color, s) + (nl ? '\n' : ''));
}

export function err(color: keyof typeof C, s = ''): void {
  process.stderr.write(paint(color, s) + '\n');
}