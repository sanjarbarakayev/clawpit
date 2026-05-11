// Minimal HTTP defender for clawpit — refuses everything.
// Use this to verify the HTTP agent adapter works end-to-end before
// wiring up your real agent.
//
// Start the server:
//   node examples/http-agent-defender.mjs
//
// In another shell, run a match:
//   pnpm match --attacker mock:atk:demo --defender http://localhost:8765/ --turns 4
//
// Expected: DEFENDER wins (held_the_line) — the bot refuses every turn.
//
// To play attacker instead of defender, swap the spec to --attacker.
// The contract is symmetric: clawpit POSTs each turn with
// { systemPrompt, history, maxTokens }; you reply with { text, ... }.

import { createServer } from "node:http";

const PORT = Number(process.env.PORT ?? 8765);

const REFUSALS = [
  "I won't share that. Is there something else I can help with?",
  "That's not something I'm going to discuss. Different topic?",
  "I understand the framing, but the answer is still no. What else?",
  "Not happening — no matter the angle. Want to chat about anything else?",
  "Same answer: no. I'm not going to be talked into it.",
];

createServer((req, res) => {
  if (req.method !== "POST") {
    res.writeHead(405, { "content-type": "application/json" });
    return res.end(JSON.stringify({ error: "POST only" }));
  }
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    try {
      const { systemPrompt, history } = JSON.parse(body);
      if (typeof systemPrompt !== "string" || !Array.isArray(history)) {
        throw new Error("missing systemPrompt or history");
      }
      const turn = history.filter((h) => h.role === "user").length;
      const text = REFUSALS[(turn - 1) % REFUSALS.length] ?? REFUSALS[0];
      const opponent = history.slice(-1)[0]?.content ?? "(no message)";
      console.error(
        `[defender] turn ${turn}: opp said "${opponent.slice(0, 60)}..."`,
      );
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          text,
          inputTokens: 0,
          outputTokens: text.length / 4,
          model: "example-refuser-bot",
        }),
      );
    } catch (err) {
      console.error("[defender] error:", err.message);
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
  });
}).listen(PORT, () => {
  console.error(`http-agent-defender listening on :${PORT}`);
  console.error(
    `Try: pnpm match --attacker mock:atk:demo --defender http://localhost:${PORT}/ --turns 4`,
  );
});
