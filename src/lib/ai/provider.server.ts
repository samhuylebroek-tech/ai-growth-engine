// AI provider abstraction. Lovable AI Gateway is the first implementation; new providers
// implement AIProvider and are selected in getProvider().
import { generateResponse, GatewayError, PaymentRequiredError, RateLimitError } from "@lovable.dev/ai-gateway";
import { AINotStartedError, AIOutcomeUnknownError } from "@/lib/ai-accounting";

export interface AIInputPart { type: "input_text"; text: string }
export interface AIFilePart { type: "input_file"; filename: string; file_data: string }
export interface AIMessage { role: "user" | "assistant"; content: string | (AIInputPart | AIFilePart)[] }
export interface AIResult { text: string; inputTokens: number; outputTokens: number; model: string; provider: string; providerRequestId: string | null }
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
        input: input.map(message => message.role === "assistant"
          ? { role: "assistant" as const, content: typeof message.content === "string" ? message.content : message.content.filter(part => part.type === "input_text").map(part => part.text).join("\n") }
          : { role: "user" as const, content: message.content }),
        max_output_tokens: maxOutputTokens ?? 2000,
      });
      let text = "";
      for (const item of (r.output ?? []) as Array<{ type: string; content?: Array<{ type: string; text?: string }> }>) {
        if (item.type === "message") for (const c of item.content ?? []) if (c.type === "output_text" && c.text) text += c.text;
      }
      if (!r.usage || r.usage.input_tokens == null || r.usage.output_tokens == null) throw new AIOutcomeUnknownError({ providerRequestId: r.id });
      return { text, inputTokens: r.usage.input_tokens, outputTokens: r.usage.output_tokens, model: DEFAULT_MODEL, provider: "lovable-gateway", providerRequestId: r.id };
    } catch (e) {
      if (e instanceof GatewayError && e.outcome === "not_started") {
        throw new AINotStartedError(e instanceof PaymentRequiredError ? "The AI service is out of credits." : e instanceof RateLimitError ? "The AI service is busy. Please try again later." : "The AI request was rejected before execution.");
      }
      if (e instanceof AIOutcomeUnknownError) throw e;
      throw new AIOutcomeUnknownError(e instanceof GatewayError ? e.ids ?? {} : {});
    }
  },
};

export function getProvider(): AIProvider { return lovableGateway; }
