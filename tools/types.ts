
export interface Tool {
  name: string,
  description: string,
  /** 
   * OpenAI function 的 parameters 层（如： { type: 'object', properties, additionalProperties }）
  */
  parameters: Record<string, unknown>,
  run(args: Record<string, unknown>): Promise<string> | string;
}