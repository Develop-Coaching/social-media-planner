// Connector to the greg-brain content RAG (Develop Coaching only).
// Gated by BRAIN_ENABLED_COMPANY_ID; fails open so generation never
// breaks if the brain endpoint is down or unconfigured.

export interface BrainChunk {
  text: string;
  source: string;
  metadata?: {
    source_table?: string;
    framework_tags?: string[];
    topic_tags?: string[];
    score?: number;
  };
}

export function isBrainEnabled(companyId: string): boolean {
  return (
    !!process.env.BRAIN_API_URL &&
    !!process.env.BRAIN_API_SECRET &&
    !!process.env.BRAIN_ENABLED_COMPANY_ID &&
    process.env.BRAIN_ENABLED_COMPANY_ID === companyId
  );
}

export async function retrieveBrainContext(
  query: string,
  k: number = 8
): Promise<BrainChunk[] | null> {
  const url = process.env.BRAIN_API_URL;
  const secret = process.env.BRAIN_API_SECRET;
  if (!url || !secret) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const res = await fetch(`${url.replace(/\/$/, "")}/api/retrieve`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-brain-secret": secret,
      },
      body: JSON.stringify({ query, k }),
      signal: controller.signal,
    });

    if (!res.ok) {
      console.warn(`brain-connector: retrieve failed with ${res.status}`);
      return null;
    }

    const data = (await res.json()) as { chunks?: BrainChunk[] };
    return Array.isArray(data.chunks) ? data.chunks : null;
  } catch (err) {
    console.warn("brain-connector: retrieve failed, continuing without brain context:", err);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// Builds a prompt section from retrieved chunks. Returns "" when there is
// nothing to inject so callers can append it unconditionally.
export function buildBrainPromptSection(chunks: BrainChunk[] | null): string {
  if (!chunks || chunks.length === 0) return "";

  const sources = chunks
    .map((c, i) => `[${i + 1}] (${c.source}) ${c.text.trim()}`)
    .join("\n\n");

  return `

GREG'S KNOWLEDGE BASE (real content from Greg Wilkes of Develop Coaching — his actual frameworks, stories, numbers, and opinions):
${sources}

VOICE & GROUNDING RULES: Write in Greg's authentic voice. Ground the content in the material above — reuse his real stories, specific numbers, and opinions where relevant. Do NOT invent facts, figures, or anecdotes that aren't supported by the material or the theme. If the material doesn't cover an angle, write from general principles without fabricating specifics.`;
}

// Convenience: gate + retrieve + format in one call.
export async function getBrainPromptSection(
  companyId: string,
  query: string,
  k: number = 8
): Promise<string> {
  if (!isBrainEnabled(companyId)) return "";
  const chunks = await retrieveBrainContext(query, k);
  return buildBrainPromptSection(chunks);
}
