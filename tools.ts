import type { ChatCompletionTool } from "openai/resources/chat/completions";
import { exec } from 'node:child_process';
import { promisify } from "node:util";
import type { Interface as ReadLine } from "node:readline";
import { truncate } from "./utils.js";
import { out } from "./color";

const execAsync = promisify(exec);
const SHELL_TIMEOUT_MS = 10_000;  // 单条命令最长运行时间，超时杀死进程
const MAX_OUTPUT_CHARS = 2000;  // 输出超此字符数阶段，避免撑爆上下文

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
  },
  {
    name: 'run_shell',
    description: '在本地执行一条 shell 命令（bash -c）,返回合并后的标准输出/错误。执行前会向用户确认',
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

type ConfirmFn = (prompt: string) => Promise<boolean>;
let confirm: ConfirmFn = async () => false;   // 未注入时一律拒绝，命令不会再无人确认下执行

/**
 * 注入交互式确认逻辑（后续权限模型可在此替换）
*/
export function setConfirmFn(fn: ConfirmFn): void {
  confirm = fn;
}

function buildCliConfirm(rl: ReadLine): ConfirmFn {
  return (prompt) =>
      new Promise<boolean>((resolve) => {
        const onLine = (raw: string) => {
          rl.removeListener('line', onLine);
          const ans = raw.trim().toLowerCase();
          resolve(ans === 'y' || ans === 'yes');
        }

        rl.on('line', onLine);
        rl.resume();
        out('tool', `${prompt} [y/N]`);   // 确认提示染黄，一眼确认是危险操作
      });
}

/**
 * 用住 REPL 的 readline 接口安装 CLI 确认
 * */ 
export function installCliConfirm(rl: ReadLine): void {
  setConfirmFn(buildCliConfirm(rl));
}

