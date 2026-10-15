import { createInterface } from 'node:readline';
import { loadConfig, CONTEXT_WINDOW } from './config';
import { Chat } from './chat.js';
import { err, out, paint, colorMap } from './color.js';
import { installCliConfirm, setConfirmFn } from './tools/util';
// file.ts 在加载时调用 registerTool；不导入它就不会进入工具注册表。
import './tools/file.js';
import { Sessions } from './sessions';
import { loadSessions, saveSessions } from './storage';
import { estimateTokens, TUI } from './tui';

const config = loadConfig();
const sessions = new Sessions();
const chat = new Chat( config.baseURL, config.apiKey, config.model);

let busy = false;
const usage = { cum: 0, round: 0, live: 0};
const tui = new TUI(onLine, onExit);
setConfirmFn((prompt) => tui.confirm(prompt));
chat.setUsageListener((u) => {
  usage.live = 0;
  usage.cum += u.total;
  usage.round += u.total;
  updatePanel();
});

function printHelp(): void {
  tui.append(
    `可用命令：
    /help - 显示帮助信息
    /reset - 重置对话历史
    /exit - 退出程序
    /compact - 立即压缩旧对话摘要（不等自动触发）
    
    已接入工具：已接入工具：get_current_time（当前时间）、run_shell（执行 shell 命令，执行前需确认）、ls（列目录）、read（读文件）、glob（通配符查文件）——三者只读、免确认，模型需要时会自动调用。
    输入任意内容即可与模型对话
    `, 'sys');
}

async function saveAll(): Promise<{ count: number; file: string }> {
  const data = sessions.dump(chat.exportHistory());
  const file = await saveSessions(data);
  return { count: Object.keys(data.sessions).length, file };
}

async function handleCommand(line: string): Promise<void> {
  const [command, id] = line.split(/\s+/, 2);
    switch(command) {
      case '/help':
        printHelp();
        break;
      case '/reset':
        chat.reset();
        tui.append('对话历史已重置', 'sys');
        break;
      case '/compact':
        tui.append('\n', 'sys');
        tui.append(`${await chat.compact()}`, 'tool');
        break;
      case '/create':
      case '/new':
        if(!id) {
          tui.append(`用法: /new <id>`, 'sys');
          break;
        }

        try {
          chat.importHistory(
              sessions.create(id, chat.exportHistory()));
          tui.append(`（已新建并切换到会话：${id}）`, 'sys')
        } catch (e) {
          tui.append(`新建失败：${(e as Error).message}`, 'sys');
        }
        break;
      case '/sessions':
        const list = sessions.list(chat.exportHistory());
        const lines = list.map((item) => `${item.current ? '*' : ''}
      ${item.id} （${item.count} 条消息）`);
        tui.append(`会话：\n${lines.join('\n')}`, 'sys');
        break;
      case '/open':
        if (!id) {
          tui.append(`用法：/open <id>`, 'sys');
          break;
        }

        try {
          const messages = sessions.open(id, chat.exportHistory());
          chat.importHistory(messages);
          tui.append(`
            （已切换到会话 ${id}, ${messages.length} 条消息）`, 'sys');
        } catch (e) {
          tui.append(`打开失败：${(e as Error).message}`, 'sys');
        }
        break;
      case '/save':
        try {
          const { count, file } = await saveAll();
          tui.append(`（已保存 ${count} 个会话到 ${file}）`, 'sys');
        } catch (e) {
          tui.append(`保存失败：${(e as Error).message}`, 'sys');
        }
        break;
      case '/load':
        try {
          const { data, file } = await loadSessions();
          const messages = sessions.restore(data);
          chat.importHistory(messages);
          tui.append(`（已从 ${file} 恢复 ${sessions.list(messages).length} 
            个会话，当前 ${sessions.currentId()}）`, 'sys');
        } catch (e) {
          tui.append(`读取失败：${(e as Error).message}`, 'sys');
        }
        break;
      case '/exit':
        onExit();
        return;
      default:
        tui.append(`未知命令: ${line} (输入 /help 查看帮助)`, 'sys');
    }
}

function buildPanel(): string[] {
  const window = CONTEXT_WINDOW;
  const ctx = estimateTokens(JSON.stringify(chat.exportHistory()));
  return [
    `模型 ${config.model}`,
    `会话 ${sessions.currentId()}`,
    `----- 上下文 -----`,
    `${ctx} / ${window} tokens`,
    `${Math.ceil((ctx / window) * 100)} % used`,
    `----- 本轮 -----`,
    `${usage.round + usage.live} tokens`,
    `----- 累计 -----`,
    `${usage.cum} tokens`,
  ];
}

function updatePanel(): void {
  tui.setPanel(buildPanel());
}

async function reply(line: string): Promise<void> {
  usage.round = 0;
  try {
    tui.append('', 'sys');
    for await (const delta of chat.streamReply(line)) {
      if (
        delta.startsWith('\n[调用工具') ||
        delta.startsWith('\n[历史压缩')
      ) {
        usage.live = 0;
        tui.append(delta, 'tool');
      } else {
        tui.appendInline(delta, 'model');
        usage.live = estimateTokens(delta);
      }

      updatePanel();
    }

    usage.live = 0;
    tui.append('', 'sys');
  } catch (e) {
    tui.append(`请求失败：${(e as Error).message}`, 'sys');
  }

  updatePanel();
} 

async function onLine(line: string): Promise<void> {
  if (busy) return ;
  busy = true;
  tui.setBusy(busy);
  if (line.startsWith('/')) {
    await handleCommand(line);
  } else {
    await reply(line);
  }
  busy = false;
  tui.setBusy(false);
  tui.ready();
}

async function onExit(): Promise<void> {
  tui.stop();
  try {
    const { count, file } = await saveAll();
    console.error(`推出前已经保存：${count} 个会话到 ${file}`);
  } catch (e) {
    console.error(`退出前保存失败：${(e as Error).message}`);
  }

  console.log('bye');
  process.exit(0);
}

tui.start();
updatePanel();
tui.append('输入 /help 查看命; 右侧面板实时显示用量', 'sys');