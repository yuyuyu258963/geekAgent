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