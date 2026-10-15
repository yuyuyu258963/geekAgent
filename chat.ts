
import OpenAI from "openai";
import { toOpenAITools, execTool } from "./tools.js";
import { COMPRESS_SYSTEM, KEEP_RECENT, MAX_HISTORY_CHARS} from "./config";

const MAX_TOOL_TURNS = 20;

export class Chat {
  private client: OpenAI;
  private model: string;
  private history: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];
  
  constructor(baseURL: string, apiKey: string, model: string) {
    this.client = new OpenAI({ baseURL, apiKey });
    this.model = model;
  }

  

  reset(): void {
    this.history = [];
  }

  async *streamReply(userInput: string): AsyncGenerator<string> {
    this.history.push({role: 'user', content: userInput});
    try {
      if (this.historySize() > MAX_HISTORY_CHARS) {
        try {
          const dropped = await this.compactOldMessages();
          yield  dropped > 0
            ? `\n[历史压缩：${dropped} 条旧消息合并未 1 条摘要]\n`
            : `\n[历史压缩：模型未产出摘要，保留原历史]\n`
            ;
        } catch (err) {
          yield `\n[历史压缩失败：保留原历史]\n`;
        }
      } 
      
      for (let turn = 0; turn < MAX_TOOL_TURNS; turn ++) {
        const stream = await this.client.chat.completions.create({
          model: this.model,
          messages: this.history,
          tools: toOpenAITools(),   // 这部分在上下文中注入工具
          stream: true,
        });

        // 流式边攒内容边聚拢工具调用（delta 按 index 碎片下发）
        let answer = "";
        const calls = new Map<number, {id: string, name: string, args: string}>();
        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta ?? {};
          if(delta.content) {
            answer += delta.content;
            yield delta.content;
          }

          for (const tc of delta?.tool_calls ?? []) {
            // 注意带 delta 的 chunks 中可能包含部分信息的增量块
            let call = calls.get(tc.index);
            if (!call) {
              call = { id: '', name: '', args: '' };
              calls.set(tc.index, call);
            }

            if(tc.id) call.id = tc.id;
            if(tc.function?.name) call.name += tc.function.name;
            if(tc.function?.arguments) call.args += tc.function.arguments;
          }
        }
        
        // 汇总需要 toolCalls 的集合，调用工具获取结果，传入上下文
        const toolCalls = [...calls.values()];
        if (toolCalls.length > 0 && toolCalls.every((c) => c.name)) {
          toolCalls.forEach((c, i) => {
            if(!c.id) c.id = `call_${i}`;
          });

          this.history.push({
            role: 'assistant',
            content: answer || null,
            tool_calls: toolCalls.map((c) => ({
              id: c.id,
              type: 'function' as const,
              function: { name: c.name, arguments: c.args},
            }))
          });
          
          for (const c of toolCalls) {
            const result = await execTool(c.name, c.args);
            yield `\n[调用工具 ${c.name} -> ${result}]`;
            this.history.push({
              role: 'tool',
              tool_call_id: c.id,
              content: result,
            });
          }

          continue;
        }

        // 没有工具调用，就是最终回答
        this.history.push({ role: 'assistant', content:answer });
        return;
      }
      yield `\n[工具调用轮次过多，已经停止]`;
      this.history.push({ role: 'assistant', content: '[工具调用轮次过多，已停止]'});
    } catch (err) {
      this.history.pop();
      throw err;
    }
  }

  private historySize(): number {
    return this.history.reduce((n, m) => n + JSON.stringify(m).length, 0);
  }

  /**
   * 历史压缩：把除最近 KEEP_RECENT 条以外的旧消息交给模型摘要
   * 用一条 system 摘要消息替换它们，让上下文变薄
   * 返回被合并掉的旧消息条数：模型没产出摘要时返回 0，本次不做替换 
   */
  private async compactOldMessages(): Promise<number> {
    const split = this.history.length - KEEP_RECENT;
    if (split <= 0) return 0;

    const old = this.history.slice(0, split);
    const recent = this.history.slice(split);
    const res = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        { role: 'system', content: COMPRESS_SYSTEM },
        { role: 'user', content: JSON.stringify(old, null, 2)},
      ]
    });
    const text = res.choices[0]?.message?.content?.trim();
    if (!text)  return 0;
    this.history = [
      { role: 'system', content: `【此前对话摘要】 \n${text}`, ...recent},
    ];
    return old.length;
  }

  async compact(): Promise<string> {
    if (this.history.length <= KEEP_RECENT) 
      return `历史压缩：没有可压缩的旧消息`;
    try {
      const dropped = await this.compactOldMessages();
      return dropped > 0
            ? `历史压缩: ${dropped} 条旧消息合并为 1 条摘要`
            : `历史压缩：模型未产出摘要，保留历史`;
    } catch {
      return `历史压缩失败：保留原历史`;
    }
  }

  exportHistory(): OpenAI.Chat.Completions.ChatCompletionMessageParam[]  {
    return this.history;
  }

  importHistory(messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[]) {
    this.history = messages;
  }
}