import { createInterface } from 'node:readline';
import { loadConfig } from './config';
import { Chat } from './chat.js';
import { err, out, paint, colorMap } from './color.js';
import { installCliConfirm } from './tools/util';
// file.ts 在加载时调用 registerTool；不导入它就不会进入工具注册表。
import './tools/file.js';
import { Sessions } from './sessions';
import { loadSessions, saveSessions } from './storage';

const config = loadConfig();
const sessions = new Sessions();
const chat = new Chat( config.baseURL, config.apiKey, config.model);

const rl = createInterface({ input: process.stdin, output: process.stdout, });

rl.setPrompt(paint('user', 'You > '));
installCliConfirm(rl);

let busy = false;

function printHelp(): void {
  out(
    'sys', `可用命令：
    /help - 显示帮助信息
    /reset - 重置对话历史
    /exit - 退出程序
    /compact - 立即压缩旧对话摘要（不等自动触发）
    
    已接入工具：已接入工具：get_current_time（当前时间）、run_shell（执行 shell 命令，执行前需确认）、ls（列目录）、read（读文件）、glob（通配符查文件）——三者只读、免确认，模型需要时会自动调用。
    输入任意内容即可与模型对话
    `, true);
}

async function saveAll(): Promise<{ count: number; file: string }> {
  const data = sessions.dump(chat.exportHistory());
  const file = await saveSessions(data);
  return { count: Object.keys(data.sessions).length, file };
}


rl.on('line', async (raw) => {
  if(busy) return;    // 上一轮还在流式输出，忽略连发输入
  busy = true;

  const line = raw.trim();
  if (line) {
    if(line.startsWith('/')) {
      const [command, id] = line.split(/\s+/, 2);
      switch(command) {
        case '/help':
          printHelp();
          break;
        case '/reset':
          chat.reset();
          out('sys', '对话历史已重置', true);
          break;
        case '/compact':
          out('sys', '\n');
          out('tool', `${await chat.compact()}`, true);
          break;
        case '/create':
        case '/new':
          if(!id) {
            err('sys', `用法: /new <id>`);
            break;
          }

          try {
            chat.importHistory(
                sessions.create(id, chat.exportHistory()));
            out('sys', `（已新建并切换到会话：${id}）`, true);
          } catch (e) {
            err('sys', `新建失败：${(e as Error).message}`);
          }
          break;
        case '/sessions':
          const list = sessions.list(chat.exportHistory());
          const lines = list.map((item) => `${item.current ? '*' : ''}
        ${item.id} （${item.count} 条消息）`);
          out('sys', `会话：\n${lines.join('\n')}`, true);
          break;
        case '/open':
          if (!id) {
            err('sys', `用法：/open <id>`);
            break;
          }

          try {
            const messages = sessions.open(id, chat.exportHistory());
            chat.importHistory(messages);
            out('sys', `
              （已切换到会话 ${id}, ${messages.length} 条消息）`, true);
          } catch (e) {
            err('sys', `打开失败：${(e as Error).message}`);
          }
          break;
        case '/save':
          try {
            const { count, file } = await saveAll();
            out('sys', `（已保存 ${count} 个会话到 ${file}）`, true);
          } catch (e) {
            err('sys', `保存失败：${(e as Error).message}`);
          }
          break;
        case '/load':
          try {
            const { data, file } = await loadSessions();
            const messages = sessions.restore(data);
            chat.importHistory(messages);
            out('sys', `（已从 ${file} 恢复 ${sessions.list(messages).length} 
              个会话，当前 ${sessions.currentId()}）`, true)
          } catch (e) {
            err('sys', `读取失败：${(e as Error).message}`);
          }
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
        // 持续捕获输出，异步的方式达到流式输出的效果
        for await (const delta of chat.streamReply(line)) {
          
          // 渲染循环中，将进度行（工具调用用 / 历史压缩）用黄色，真正的回复用绿色
          const isProgress = delta.startsWith('\n[调用工具') ||
                          delta.startsWith('\n[历史压缩');

          out(isProgress ? 'tool' : 'model', delta);
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

rl.on('close', async () => {
  try {
    const generateId = sessions.nameDefault(chat.exportHistory());
    const { count, file } = await saveAll();
    out('sys', `（退出已保存 ${count} 个会话到 ${file}）`, true);
    if (generateId) {
      out(`sys`, `（会话 ID：${generateId}），
          重启后可用 /load 再用 /open ${generateId} 打开`, true);
    }
  } catch (e) {
    err('sys', `退出前保存失败：${(e as Error).message}`);
  }
  
  out('sys', 'Bye!\n');
  process.exit(0);
})

rl.prompt();
