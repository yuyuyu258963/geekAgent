import { createInterface } from 'node:readline';
import { loadConfig } from './config';
import { Chat } from './chat.js';
import { err, out, paint, colorMap } from './color.js';

const config = loadConfig();
const chat = new Chat( config.baseURL, config.apiKey, config.model);

const rl = createInterface({ input: process.stdin, output: process.stdout, });

rl.setPrompt(paint('user', 'You > '));


let busy = false;

function printHelp(): void {
  out(
    'sys', `可用命令：
    /help - 显示帮助信息
    /reset - 重置对话历史
    /exit - 退出程序
    输入任意内容即可与模型对话
    `, true);
}


rl.on('line', async (raw) => {
  if(busy) return;    // 上一轮还在流式输出，忽略连发输入
  busy = true;

  const line = raw.trim();
  if (line) {
    if(line.startsWith('/')) {
      switch(line) {
        case '/help':
          printHelp();
          break;
        case '/reset':
          chat.reset();
          out('sys', '对话历史已重置', true);
          break;
        case '/exit':
          rl.close();
          return;
        default:
          out('sys', `未知命令: ${line} (输入 /help 查看帮助)`, true);
      }
    } else {
      try {
        out('sys', `\n`);
        // 实现持续的流式输出
        for await (const delta of chat.streamReply(line)) {
          out('model', delta);
        }
        out('sys', `\n`);
      } catch(e) {
        err('sys', `\n 请求失败: ${(e as Error).message}\n`);
      }
    }
  } 

  busy = false;
  rl.prompt();
});

rl.on('close', () => {
  out('sys', 'Bye!\n');
  process.exit(0);
})

rl.prompt();