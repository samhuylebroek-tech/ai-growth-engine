// AI provider abstraction. Lovable AI Gateway is the first implementation; new providers
// implement AIProvider and are selected in getProvider().
import { generateResponse, GatewayError, PaymentRequiredError, RateLimitError } from "@lovable.dev/ai-gateway";

export interface AIInputPart { type: "input_text"; text: string }
export interface AIFilePart { type: "input_file"; filename: string; file_data: string }
export interface AIMessage { role: "user" | "assistant"; content: string | (AIInputPart | AIFilePart)[] }
export interface AIResult { text: string; inputTokens: number; outputTokens: number; model: string; provider: string }
export interface AIProvider { name: string; generate(opts: { instructions: string; input: AIMessage[]; maxOutputTokens?: number }): Promise<AIResult> }

export class AIUnavailableError extends Error {}

const DEFAULT_MODEL = "openai/gpt-6-astra" as const;

const lovableGateway: AIProvider = {
  name: "lovable-gateway",
  async generate({ instructions, input, maxOutputTokens }) {
    try {
      const r = await generateResponse({
        model: DEFAULT_MODEL,
        instructions,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        input: input as any,
        max_output_tokens: maxOutputTokens ?? 2000,
      });
      let text = "";
      for (const item of (r.output ?? []) as Array<{ type: string; content?: Array<{ type: string; text?: string }> }>) {
        if (item.type === "message") for (const c of item.content ?? []) if (c.type === "output_text" && c.text) text += c.text;
      }
      return { text, inputTokens: r.usage?.input_tokens ?? 0, outputTokens: r.usage?.output_tokens ?? 0, model: DEFAULT_MODEL, provider: "lovable-gateway" };
    } catch (e) {
      if (e instanceof PaymentRequiredError) throw new AIUnavailableError("The AI service is out of credits. The platform owner needs to top up.");
      if (e instanceof RateLimitError) throw new AIUnavailableError("The AI service is busy. Please try again in a minute.");
      if (e instanceof GatewayError) { console.error("[ai] gateway error", e.code, e.ids); throw new AIUnavailableError("The AI service could not answer right now."); }
      throw e;
    }
  },
};

export function getProvider(): AIProvider { return lovableGateway; }
