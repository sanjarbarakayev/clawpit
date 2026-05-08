import Anthropic from "@anthropic-ai/sdk";
import type { Agent, AgentCallOpts } from "../types.ts";

const _client = new Map<string, Anthropic>();
function client(): Anthropic {
  let c = _client.get("default");
  if (!c) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error(
        "ANTHROPIC_API_KEY not set — use a `mock:*` agent or export the key.",
      );
    }
    c = new Anthropic({ apiKey });
    _client.set("default", c);
  }
  return c;
}

export function anthropicAgent(modelId: string, label?: string): Agent {
  return {
    id: `anthropic:${modelId}`,
    label: label ?? modelId,
    async call({ systemPrompt, history, maxTokens, temperature }: AgentCallOpts) {
      const res = await client().messages.create({
        model: modelId,
        system: systemPrompt,
        messages: history.map((m) => ({ role: m.role, content: m.content })),
        max_tokens: maxTokens ?? 512,
        temperature: temperature ?? 0.8,
      });
      const text = res.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      return text || "(no response)";
    },
  };
}
