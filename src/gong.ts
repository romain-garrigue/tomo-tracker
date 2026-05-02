import { config } from "./config.ts";

const auth = Buffer.from(
  `${config.gong.accessKey}:${config.gong.accessKeySecret}`,
).toString("base64");

const headers = {
  Authorization: `Basic ${auth}`,
  "Content-Type": "application/json",
  Accept: "application/json",
};

class GongHttpError extends Error {
  constructor(
    public status: number,
    public body: string,
    message: string,
  ) {
    super(message);
  }
}

async function gongFetch(path: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(`${config.gong.baseUrl}${path}`, {
    ...init,
    headers: { ...headers, ...(init.headers ?? {}) },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new GongHttpError(
      res.status,
      text,
      `Gong ${init.method ?? "GET"} ${path} → ${res.status}: ${text}`,
    );
  }
  return res.json();
}

function isNoCallsFound(err: unknown): boolean {
  return (
    err instanceof GongHttpError &&
    err.status === 404 &&
    /No calls found/i.test(err.body)
  );
}

export interface GongCall {
  id: string;
  title: string;
  started: string;
  duration: number;
  url: string;
  scope?: string;
  parties?: Array<{
    id?: string;
    name?: string;
    affiliation?: "Internal" | "External" | "Unknown";
    title?: string;
  }>;
}

export async function listCalls(
  fromDateTime: string,
  toDateTime: string,
): Promise<GongCall[]> {
  const calls: GongCall[] = [];
  let cursor: string | undefined;
  do {
    const body: any = {
      filter: {
        fromDateTime,
        toDateTime,
        workspaceId: config.gong.workspaceId,
      },
    };
    if (cursor) body.cursor = cursor;
    let json: any;
    try {
      json = await gongFetch("/v2/calls/extensive", {
        method: "POST",
        body: JSON.stringify(body),
      });
    } catch (err) {
      if (isNoCallsFound(err)) return calls;
      throw err;
    }
    for (const c of json.calls ?? []) {
      const m = c.metaData ?? {};
      calls.push({
        id: m.id,
        title: m.title,
        started: m.started,
        duration: m.duration,
        url: m.url,
        scope: m.scope,
        parties: c.parties,
      });
    }
    cursor = json.records?.cursor;
  } while (cursor);
  return calls;
}

export interface TranscriptSentence {
  start: number;
  end: number;
  text: string;
}

export interface TranscriptMonologue {
  speakerId: string;
  speakerName?: string;
  topic?: string;
  sentences: TranscriptSentence[];
}

export async function getTranscript(
  callId: string,
): Promise<{ monologues: TranscriptMonologue[]; speakerNames: Record<string, string> }> {
  const json = await gongFetch("/v2/calls/transcript", {
    method: "POST",
    body: JSON.stringify({ filter: { callIds: [callId] } }),
  });
  const callTranscript = json.callTranscripts?.[0];
  if (!callTranscript) return { monologues: [], speakerNames: {} };

  const speakerNames: Record<string, string> = {};
  let parties: any[] = [];
  try {
    const ext = await gongFetch("/v2/calls/extensive", {
      method: "POST",
      body: JSON.stringify({
        filter: { callIds: [callId] },
        contentSelector: { exposedFields: { parties: true } },
      }),
    });
    parties = ext.calls?.[0]?.parties ?? [];
    for (const p of parties) {
      if (p.speakerId && p.name) speakerNames[p.speakerId] = p.name;
    }
  } catch {
    // best-effort speaker name resolution
  }

  const monologues: TranscriptMonologue[] = (callTranscript.transcript ?? []).map(
    (m: any) => ({
      speakerId: m.speakerId,
      speakerName: speakerNames[m.speakerId],
      topic: m.topic,
      sentences: (m.sentences ?? []).map((s: any) => ({
        start: s.start,
        end: s.end,
        text: s.text,
      })),
    }),
  );
  return { monologues, speakerNames };
}

export interface CallSummary {
  brief?: string;
  outline?: Array<{ section: string; startTime?: number; items?: string[] }>;
  keyPoints?: string[];
  topics?: Array<{ name: string; duration?: number }>;
}

export async function getCallSummary(callId: string): Promise<CallSummary | null> {
  try {
    const json = await gongFetch("/v2/calls/extensive", {
      method: "POST",
      body: JSON.stringify({
        filter: { callIds: [callId] },
        contentSelector: {
          exposedFields: {
            content: {
              brief: true,
              outline: true,
              keyPoints: true,
              topics: true,
            },
          },
        },
      }),
    });
    const c = json.calls?.[0]?.content;
    if (!c) return null;
    return {
      brief: c.brief,
      outline: c.outline,
      keyPoints: (c.keyPoints ?? []).map((kp: any) => kp.text ?? kp),
      topics: c.topics,
    };
  } catch {
    return null;
  }
}

export function formatTimestamp(seconds: number): string {
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function flattenTranscript(monologues: TranscriptMonologue[]): string {
  return monologues
    .map((m) => {
      const speaker = m.speakerName ?? m.speakerId;
      const text = m.sentences.map((s) => s.text).join(" ");
      const ts = m.sentences[0] ? formatTimestamp(m.sentences[0].start) : "";
      return `[${ts}] ${speaker}: ${text}`;
    })
    .join("\n\n");
}
