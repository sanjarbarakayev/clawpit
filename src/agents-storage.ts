/**
 * Registered agent storage. Separate from ratings.json because ratings are
 * keyed by agent.id (e.g. http://my-bot/respond, cc:claude-opus-4-7); this
 * file holds the registry of external agents — who owns them, how to reach
 * them, when they registered, an opaque API key the owner uses to challenge
 * matches.
 *
 * Stored at data/agents.json. Persists across restarts in dev; on the free
 * Render tier the dyno is ephemeral but the seed-on-empty branch in
 * src/cli/index.ts cmdServe preserves continuity for the maintainer's
 * dataset. External-agent registrations on the public deployment will reset
 * on every restart until persistent storage lands (v0.3.1+ — SQLite/Turso).
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, randomUUID } from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "..", "data");
const AGENTS_FILE = path.join(DATA_DIR, "agents.json");

export interface RegisteredAgent {
  /** Stable id used as the agent spec (http://... or https://...). Matches
   *  the `endpointUrl` so the existing http-agent adapter resolves it. */
  id: string;
  /** Display name. 3-32 chars, used as Rating.label. */
  name: string;
  /** Free-form description shown on the agent's profile. */
  description: string;
  /** HTTP/HTTPS POST endpoint the match loop hits each turn. */
  endpointUrl: string;
  /** Owner-supplied X/Twitter handle (without @). Optional but encouraged
   *  — moltbook-style identity. */
  ownerHandle?: string;
  /** Opaque key the owner uses to challenge or delete the agent. Never
   *  exposed via list endpoints; only returned to the registrant once. */
  apiKey: string;
  createdAt: string;
  /** Set when the registration's first probe hit the endpoint successfully.
   *  Used by the dashboard to badge "verified live" vs "registered, untested". */
  firstPingAt?: string;
}

async function ensureDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

export async function loadAgents(): Promise<RegisteredAgent[]> {
  try {
    const text = await fs.readFile(AGENTS_FILE, "utf8");
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) return [];
    return parsed as RegisteredAgent[];
  } catch (err: any) {
    if (err?.code === "ENOENT") return [];
    throw err;
  }
}

async function saveAgents(agents: RegisteredAgent[]) {
  await ensureDir();
  const tmp = AGENTS_FILE + ".tmp";
  await fs.writeFile(tmp, JSON.stringify(agents, null, 2));
  await fs.rename(tmp, AGENTS_FILE);
}

export interface RegisterInput {
  name: string;
  description: string;
  endpointUrl: string;
  ownerHandle?: string;
}

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{2,31}$/;

export function validateRegisterInput(input: RegisterInput): string[] {
  const errors: string[] = [];
  if (typeof input.name !== "string" || !NAME_RE.test(input.name)) {
    errors.push(
      "name must be 3-32 chars, alphanumeric plus . _ -, starting with a letter or digit",
    );
  }
  if (typeof input.description !== "string" || input.description.length < 10 || input.description.length > 280) {
    errors.push("description must be 10-280 chars");
  }
  if (typeof input.endpointUrl !== "string") {
    errors.push("endpointUrl required");
  } else {
    try {
      const u = new URL(input.endpointUrl);
      if (u.protocol !== "http:" && u.protocol !== "https:") {
        errors.push("endpointUrl must use http:// or https://");
      }
    } catch {
      errors.push("endpointUrl is not a valid URL");
    }
  }
  if (input.ownerHandle != null) {
    if (typeof input.ownerHandle !== "string") {
      errors.push("ownerHandle must be a string");
    } else if (input.ownerHandle.length > 32 || !/^[A-Za-z0-9_]+$/.test(input.ownerHandle)) {
      errors.push("ownerHandle: alphanumeric and underscore, max 32 chars");
    }
  }
  return errors;
}

export async function registerAgent(input: RegisterInput): Promise<RegisteredAgent> {
  const agents = await loadAgents();
  if (agents.some((a) => a.name.toLowerCase() === input.name.toLowerCase())) {
    throw new Error(`agent name "${input.name}" already taken`);
  }
  if (agents.some((a) => a.endpointUrl === input.endpointUrl)) {
    throw new Error("endpointUrl already registered");
  }
  const agent: RegisteredAgent = {
    id: input.endpointUrl, // spec === url; resolves through http-agent adapter
    name: input.name,
    description: input.description,
    endpointUrl: input.endpointUrl,
    ownerHandle: input.ownerHandle,
    apiKey: randomBytes(24).toString("hex"),
    createdAt: new Date().toISOString(),
  };
  agents.push(agent);
  await saveAgents(agents);
  return agent;
}

/** Find by id (which is the endpointUrl for registered agents). */
export async function findAgentById(id: string): Promise<RegisteredAgent | undefined> {
  const agents = await loadAgents();
  return agents.find((a) => a.id === id);
}

/** Find by API key (constant-time-ish equality). */
export async function findAgentByApiKey(apiKey: string): Promise<RegisteredAgent | undefined> {
  if (!apiKey || apiKey.length < 16) return undefined;
  const agents = await loadAgents();
  return agents.find((a) => safeEqual(a.apiKey, apiKey));
}

export async function markFirstPing(id: string): Promise<void> {
  const agents = await loadAgents();
  const idx = agents.findIndex((a) => a.id === id);
  if (idx < 0) return;
  if (agents[idx]!.firstPingAt) return;
  agents[idx] = { ...agents[idx]!, firstPingAt: new Date().toISOString() };
  await saveAgents(agents);
}

/** Public-safe view: strips the API key. */
export function publicView(a: RegisteredAgent): Omit<RegisteredAgent, "apiKey"> {
  const { apiKey: _omit, ...rest } = a;
  return rest;
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}
