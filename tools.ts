import type { ChatCompletionTool } from "openai/resources/chat/completions";

export interface Tool {
  name: string,
  description: string,
  /** 
   * OpenAI function 的 parameters 层（如： { type: 'object', properties, additionalProperties }）
  */
  parameters: Record<string, unknown>,
  run(args: Record<string, unknown>): Promise<string> | string;
}

export const TOOLS: Tool[] = [
  {
    name: 'get_current_time',
    description: '获取当前时间（Asia/shanghai）',
    parameters: { type: 'object', properties: {}, additionalProperties: false},
    run: () => new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
  }
];

/**
 * 把内部 Tool 转成 OpenAI Chat Completion 的 tools 参数格式 
 */
export function toOpenAITools(): ChatCompletionTool[] {
  return TOOLS.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    }
  }));
};

/**
 * 按名字执行工具。参数是模型生成的 JSON 字符串
 * 任何报错都作为【结果文本】返回给模型 —— 让模型自己读错误
 */
export async function execTool(name: string, argsJson: string): Promise<string> {
  const tool = TOOLS.find((t) => t.name === name);
  if(!tool) return `未知工具：${name}`;

  let args: Record<string, unknown> = {};
  try {
    args = argsJson ? JSON.parse(argsJson) : {};
  } catch(e) {
    return `工具 ${name} 的参数 JSON 解析失败: ${(e as Error).message}`;
  }

  try {
    return await tool.run(args);
  } catch(e) {
    return `工具 ${name} 执行失败: ${(e as Error).message}`;
  }
};
