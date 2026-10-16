import { readFile, mkdir, writeFile, readdir, glob } from 'node:fs/promises';
import { confirm } from "./util";
import { Tool } from "./types";
import { dirname } from 'node:path';
import { truncate } from "../utils";
import { err } from '../color';
import {
  MAX_DIFF_LINES,
  SHELL_TIMEOUT_MS,
  MAX_OUTPUT_CHARS,
  MAX_GLOB_RESULTS
} from '../config';
import { authorize } from '../permission';
import { backup } from '../undo';


// 按行拆分文本：忽略结尾换行带来的空串：空文本返回空数组
const splitLines = (s: string): string[] => (s === '' ? [] : 
          s.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n'));

/**
 * 最小 diff：砍掉公共前缀与公共后缀 ,剩下的部分就是变更部分，前后各留 3 行上下文
 * 只覆盖【单处整体修改】这一最常见场景（新建/覆盖/局部小改），够用且零依赖
 */ 
function simpleDiff(oldText: string, newText: string): string {
  const a = splitLines(oldText), b = splitLines(newText);
  let p = 0;
  while(p < a.length && p < b.length && a[p] === b[p])  p++;
  let q = 0;
  while(q < a.length - p && q < b.length - p && a[a.length - 1 - q] === b[b.length - 1 - q])
    q ++;

  const ctx = 3, out: string[] = [];
  for (let i = Math.max(0, p - ctx); i < p; i++)
    out.push(' ' + a[i]);
  for (let i = p; i < a.length - q; i++) out.push('-' + a[i]);
  for (let i = p; i < b.length - q; i++) out.push('+' + b[i]);
  for (let i = Math.max(0, b.length - q); i < Math.min(b.length, b.length - q + ctx); i++)
    out.push(' ' + b[i]);

  if(out.length > MAX_DIFF_LINES) {
    out.length = MAX_DIFF_LINES;
    out.push(`...(diff 太长，仅展示前 ${MAX_DIFF_LINES} 行)`);
  }

  return out.join("\n");
}

async function commitWrite(tool: 'write' | 'patch', file: string, next: string): Promise<boolean> {
  let oldtxt: string | null = null;
  try {
    oldtxt = await readFile(file, 'utf8');
  } catch (err) {
    // 新文件：旧内容为空
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT')
      throw err;
  }

  if (oldtxt === next) return true;
  if (!(await authorize(tool, `\n${simpleDiff(oldtxt ?? '', next)}\n确认写入${file}?`)))
    return false;
  await backup(file, oldtxt);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, next);
  return true;
}

/**
 * patch 的单个修改片段：把文件中唯一出现的 odl 替换为 new 
 */
interface PathHunk {
  old: string;
  new: string;
}

export const FileTools: Tool[] = [
  {
    name: 'write',
    description: `先写入或整体覆盖一个文本文件。展示新旧内容的 diff 并请求确认
        ；自动创建缺失的父目录；适合新建文件或整体重写；小幅修改请优先用 patch。`,
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: `要写入的文件路径`},
        content: { type: 'string', description: `文件的新完整内容（原内容将被整体替换）` },
      },
      required: ['path', 'content'],
      additionalProperties: false,
    },
    authorizes: true,
    run: async (args) => {
      const file = String(args.path ?? '').trim();
      if(!file) return `缺少参数 path`;
      const wrote = await commitWrite('write', file, String(args.content ?? ''));
      return wrote ? `已写入 ${file}` : `已取消写入`;
    },
  },
  {
    name: 'patch',
    description: `对已有文件文本做布局修改：hunks里每个 { old, new } 把文件中唯一出现的 old 片段
      替换为 new。应用前展示 diff 并请求确认；old 徐在文件中唯一匹配，否则该片段失败。`,
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '要修改的文件路径'},
        hunks: {
          type: 'array',
          description: `修改片段列表：每个片段把文件中唯一匹配的 old 替换为 new。`,
          items: {
            type: 'object',
            properties: {
              old: { type: 'string', description: '要从文本中替换的原文片段，须唯一匹配（建议带上足够上下文）。'},
              bew: { type: 'string', description: '替换后的新文本' },
            },
            required: ['old', 'new'],
            additionalProperties: false,
          }
        },

      },
      required: ['path', 'hunks'],
      additionalProperties: false,
    },
    authorizes: true,
    run: async (args) => {
      const file = String(args.path ?? '').trim()
      if (!file)  return '缺少参数 path';
      const hunks = (Array.isArray(args.hunks) ? args.hunks : []) as PathHunk[];
      if (hunks.length === 0) return 'hunks 为空，未做任何修改';
      let original: string;
      try {
        original = await readFile(file, 'utf8');
      } catch (err) {
        return `读取文件失败：${(err as Error).message}`;
      }

      let patched = original;
      for (const h of hunks) {
        if (!h.old) return 'hunks 中存在空的 old 片段';
        const i = patched.indexOf(h.old);
        if (i < 0)  return `未找到匹配片段：${truncate(h.old, MAX_OUTPUT_CHARS)}`;
        if (patched.indexOf(h.old, i + 1) >= 0) 
            return `片段匹配到多出，请加长 old 使其唯一：${truncate(h.old, MAX_OUTPUT_CHARS)}`;
        patched = patched.slice(0, i) + h.new + patched.slice(i + h.old.length);
      }

      if (patched === original) return `替换后内容与原文件一致，未做任何修改`;
      const wrote = await commitWrite('patch', file, patched);
      return wrote ? `已应用 ${hunks.length} 处修改到 ${file}` : '已取消修改';
    }
  },
  {
    name: 'ls',
    description: '列出目录下的条目（只读）。默认当前目录，目录元素带 / 后缀，目录在前。',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: '要列出的目录路径，默认当前目录。'}},
      additionalProperties: false,
    },
    authorizes: true,
    run: async (args) => {
      const dir = String(args.path ?? '.').trim() || '.';
      try {
        const entires = await readdir(dir, { withFileTypes: true});
        if(entires.length === 0)  return '(空目录)';
        const lines = entires
                    .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || 
                        a.name.localeCompare(b.name))
                    .map((e) => (e.isDirectory() ? `${e.name}/` : e.name));
        return `共 ${lines.length} 项: \n ${lines.join('\n')}`;
        
      } catch (err) {
        return `打开目录失败：${(err as NodeJS.ErrnoException).message}`;
      }
    },
  },
  {
    name: 'read',
    description: '读取文本文件内容（只读）。文件过大自动截断，可用 offset 从指定字符偏移除分段续读',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '要读取的文件路径。' },
        offset: { type: 'number', description: '从第 offset 个字符开始读，默认 0：用于分段读大文件'},
      },
      required: ['path'],
      additionalProperties: false,
    },
    authorizes: true,
    run: async (args) => {
      const file = String(args.path ?? '').trim();
      if(!file) return '缺少参数 path';
      const offset = Math.max(0, Number(args.offset) || 0);

      try {
        const text = await readFile(file, 'utf-8');
        if(offset >= text.length) return 'offset 已越过文件末尾';
        const slice = text.slice(offset, offset + MAX_OUTPUT_CHARS);
        const truncated = offset + slice.length < text.length;
        const meta = `(文件共 ${text.length} 字符，已读第 ${offset}-${offset + slice.length} 段)\n`;
        const hint = truncated ? 
          `\n ...(已截断，续读可用 offset=${offset + slice.length})` : '';
        return meta + slice + hint;
      } catch (err) {
        return `读取文件失败：${(err as NodeJS.ErrnoException).message}`;
      }
    }
  },
  {
    name: 'glob',
    description: `按通配符查找文件路径（只读，不含内容）。* 匹配单层内任意串、? 匹配单个字符、**
      匹配任意多层目录：默认从当前目录找，跳过node_modules 与隐藏路径
    `,
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: `glob 模式，如 "day4/*.ts" 或 "**/tools.ts"。`},
      },
      required: ['pattern'],
      additionalProperties: false,
    },
    authorizes: true,
    run: async (args) => {
      const pattern = String(args.pattern ?? '').trim();
      if(!pattern) return '缺少参数 pattern';
      try {
        const files: string[] = [];
        for await (const p of glob(pattern, {
          cwd: process.cwd(),
          exclude: (dir) => dir.includes('node_modules'),
        })) {
          files.push(p.replaceAll('\\', '/'));
          if (files.length >= MAX_GLOB_RESULTS) break;
        }

        if (files.length == 0)  return '(没有匹配到任何文件)';
        const list = files.join('\n');
        const hint = files.length >= MAX_GLOB_RESULTS ? `\n...(已达上限 ${MAX_GLOB_RESULTS} 条，可换更精确的 pattern)` : '';

        return `匹配到 ${files.length} 个: \n${list}${hint}`;
      } catch (err) {
        return `glob 失败：${(err as Error).message}`;
      }
    },
  },
];