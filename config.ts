import 'dotenv/config';

export interface Config {
  baseURL: string;
  apiKey: string;
  model: string;
};

// 加载模型配置
export function loadConfig(): Config {
  // process 属于 Node.js 的全局变量。虽然 @types/node 已安装
  // 但项目原先没有 tsconfig.json 来明确指定 Node 类型环境，导致
  // TypeScript 语言服务并未加载它
  const baseURL = process.env.OPENAI_BASE_URL
                || 'https://api.deepseek.com';
  const apiKey = process.env.OPENAI_API_KEY || '';
  const model = process.env.OPENAI_MODEL
                || 'deepseek-v4-flash';

  if(!apiKey) {
    console.error('Error: OPENAI_API_KEY environment variable is not set.');
    process.exit(1);
  }

  return { baseURL, apiKey, model };
}

export const MAX_DIFF_LINES = 1000;
export const SHELL_TIMEOUT_MS = 10_000;  // 单条命令最长运行时间，超时杀死进程
export const MAX_OUTPUT_CHARS = 2000;  // 输出超此字符数阶段，避免撑爆上下文
export const MAX_GLOB_RESULTS = 200;  // glob 最多返回的条数，防止一次性撑爆上下文
export const MAX_HISTORY_CHARS = Number(process.env.GEEKAGENT_MAX_HISTORY) || 4000;
export const KEEP_RECENT = 6; // 压缩时保留最近几条完整消息，只摘要更早的
export const COMPRESS_SYSTEM = `
你是对话压缩器。把用户贴出的历史对话压缩成简洁的中文要点，尽量保留以下信息：
- 用户的目标、需求、做过的决定与偏好；
- 出现过的文件路径、shell 命令、工具调用与关键结论；
- 尚未完成、仍在推进中的事项。
只输出压缩后的要点，不要解释、不要寒暄、不要保留逐字对话。
`