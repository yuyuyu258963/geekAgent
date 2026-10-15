import type { ChatCompletionTool } from "openai/resources/chat/completions";
import { exec } from 'node:child_process';
import { promisify } from "node:util";
import { truncate } from "./utils";
import { readdir, readFile, glob } from "node:fs/promises";
import { confirm } from "./tools/util"
import { Tool } from "./tools/types"
import {
  SHELL_TIMEOUT_MS,
  MAX_OUTPUT_CHARS,
  MAX_GLOB_RESULTS
} from './config';
import { FileTools } from "./tools/file";

const execAsync = promisify(exec);


const registry: Tool[] = [];

export function registerTool(tool: Tool): void {
  // 提前预防工具的重复注册
  if (registry.some((t) => t.name === tool.name)) throw new Error(`
    ${tool.name} 已注册`)
    registry.push(tool);
}


export const BUILTIN_TOOLS: Tool[] = [
  {
    name: 'get_current_time',
    description: '获取当前时间（Asia/shanghai）',
    parameters: { type: 'object', properties: {}, additionalProperties: false},
    run: () => new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
  },
  {
    name: 'run_shell',
    description: `在本地执行一条 shell 命令（bash -c）,返回合并后的标准输出/错误。执行前会向用户确认。
      纯查看文件请优先用 ls / read / glob （只读、免确认）。
    `,
    parameters: {
      type: 'object',
      properties: { command: { type: 'string', description: '要执行的 shell 命令'}},
      required: ['command'],
      additionalProperties: false,
    },
    run: async (args) => {
      const command = String(args.command ?? '').trim();
      if(!command) return '缺少参数 command';

      if(!(await confirm(`即将执行命令:${command}`))) {
        return '已取消执行';
      }

      try {
        const { stdout, stderr } = await execAsync(command, {
          timeout: SHELL_TIMEOUT_MS,
          maxBuffer: MAX_OUTPUT_CHARS * 4,
        });

        return truncate([stdout, stderr].filter(Boolean).join('\n') || '(无输出)', MAX_OUTPUT_CHARS);
      } catch (err) {
        const e = err as { message: string; stdout?: string; stderr?: string };
        const partial = [e.stdout, e.stderr].filter(Boolean).join("\n");
        return truncate(`命令执行失败（${e.message}）\n ${partial}`, MAX_OUTPUT_CHARS);
      }
    },
  },
];

BUILTIN_TOOLS.forEach(registerTool);
FileTools.forEach(registerTool);

/**
 * 把内部 Tool 转成 OpenAI Chat Completion 的 tools 参数格式 
 */
export function toOpenAITools(): ChatCompletionTool[] {
  return registry.map((tool) => ({
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
  const tool = registry.find((t) => t.name === name);
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



