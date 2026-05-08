/**
 * In-memory pub/sub for in-flight matches. Server-started matches publish
 * turn events here; SSE handlers subscribe. CLI matches do not publish —
 * they're offline and write to JSON storage when done.
 *
 * Buffering: every event is appended to a per-match buffer before being
 * fanned out to current subscribers. New subscribers receive the buffer
 * before the live tail, so a viewer that loads halfway through a match
 * sees the turns they missed.
 *
 * The buffer is bounded (capped at 200 events). Match completion drops the
 * channel from the registry after a short grace window so late subscribers
 * still see "match finished" without leaking memory.
 */

import type { TranscriptEntry, MatchResult } from "./types.ts";

export type LiveEvent =
  | { type: "started"; matchId: string; topic: string; attacker: string; defender: string; maxTurns: number }
  | { type: "turn"; matchId: string; entry: TranscriptEntry }
  | { type: "finished"; matchId: string; result: MatchResult }
  | { type: "error"; matchId: string; message: string };

export interface LiveSubscriber {
  (event: LiveEvent): void;
}

interface Channel {
  buffer: LiveEvent[];
  subscribers: Set<LiveSubscriber>;
  finishedAt?: number;
}

const channels = new Map<string, Channel>();
const BUFFER_CAP = 200;
const GRACE_MS = 60_000; // keep finished channels around for late subscribers

function chan(matchId: string): Channel {
  let c = channels.get(matchId);
  if (!c) {
    c = { buffer: [], subscribers: new Set() };
    channels.set(matchId, c);
  }
  return c;
}

export function publish(event: LiveEvent): void {
  const c = chan(event.matchId);
  c.buffer.push(event);
  if (c.buffer.length > BUFFER_CAP) c.buffer.splice(0, c.buffer.length - BUFFER_CAP);
  for (const sub of c.subscribers) {
    try {
      sub(event);
    } catch {
      // a thrown subscriber must not break sibling subscribers
    }
  }
  if (event.type === "finished" || event.type === "error") {
    c.finishedAt = Date.now();
    setTimeout(() => {
      const cur = channels.get(event.matchId);
      if (cur && cur.finishedAt && Date.now() - cur.finishedAt >= GRACE_MS) {
        channels.delete(event.matchId);
      }
    }, GRACE_MS + 1000);
  }
}

export function subscribe(
  matchId: string,
  sub: LiveSubscriber,
): { unsubscribe: () => void; replay: LiveEvent[] } {
  const c = chan(matchId);
  c.subscribers.add(sub);
  return {
    unsubscribe: () => c.subscribers.delete(sub),
    replay: [...c.buffer],
  };
}

export function listLive(): Array<{ matchId: string; finished: boolean; turns: number }> {
  const out: Array<{ matchId: string; finished: boolean; turns: number }> = [];
  for (const [matchId, c] of channels) {
    const turns = c.buffer.filter((e) => e.type === "turn").length;
    out.push({ matchId, finished: !!c.finishedAt, turns });
  }
  return out;
}
