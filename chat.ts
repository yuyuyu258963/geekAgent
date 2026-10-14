
import OpenAI from "openai";
import { toOpenAITools, execTool } from "./tools.js";

const MAX_TOOL_TURNS = 5;

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
            yield `\n[调用工具 ${c.name} -> ${result}] \n`;
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
}