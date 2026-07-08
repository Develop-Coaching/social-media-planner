// Proactive token health — surface Meta/LinkedIn access-token expiry BEFORE a
// scheduled post fails on a dead credential. Run daily from a cron; alert to
// Slack when a token is invalid or inside the warning window.
//
// Meta:     GET /debug_token gives is_valid + expires_at (0 = long-lived/never).
// LinkedIn: POST /oauth/v2/introspectToken gives active + expires_at when the
//           app's client_id/secret are available; otherwise we fall back to a
//           binary /v2/userinfo ping (valid vs expired, no lead time).

const GRAPH = "https://graph.facebook.com/v21.0";

// Alert once a token is this close to expiry, so there is time to reconnect.
export const WARN_DAYS = 7;

export type TokenSeverity = "ok" | "warn" | "expired" | "unknown";

export interface TokenStatus {
  label: string; // human name, e.g. "Meta (Instagram + user)"
  configured: boolean; // env vars present at all
  valid: boolean | null; // null when we can't determine
  expiresAt: number | null; // unix seconds; 0/null = non-expiring or unknown
  daysLeft: number | null; // null when non-expiring or unknown
  severity: TokenSeverity;
  detail: string;
}

// Pure classifier — keeps the alerting decision unit-testable without a network.
export function classifyExpiry(
  valid: boolean | null,
  expiresAt: number | null,
  nowSeconds: number
): { severity: TokenSeverity; daysLeft: number | null } {
  if (valid === false) return { severity: "expired", daysLeft: 0 };
  if (valid === null) return { severity: "unknown", daysLeft: null };
  // Valid token. 0 / null means a long-lived (page) token that does not expire.
  if (!expiresAt || expiresAt <= 0) return { severity: "ok", daysLeft: null };
  const daysLeft = Math.floor((expiresAt - nowSeconds) / 86400);
  if (daysLeft <= 0) return { severity: "expired", daysLeft: 0 };
  if (daysLeft <= WARN_DAYS) return { severity: "warn", daysLeft };
  return { severity: "ok", daysLeft };
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

async function checkMetaToken(label: string, token: string): Promise<TokenStatus> {
  try {
    const res = await fetch(
      `${GRAPH}/debug_token?input_token=${encodeURIComponent(token)}&access_token=${encodeURIComponent(token)}`
    );
    const json = (await res.json()) as {
      data?: { is_valid?: boolean; expires_at?: number; scopes?: string[] };
      error?: { message?: string };
    };
    if (!res.ok || !json.data) {
      const msg = json.error?.message || `debug_token ${res.status}`;
      return {
        label, configured: true, valid: false, expiresAt: null, daysLeft: 0,
        severity: "expired", detail: msg.slice(0, 300),
      };
    }
    const valid = json.data.is_valid ?? null;
    const expiresAt = json.data.expires_at ?? null;
    const { severity, daysLeft } = classifyExpiry(valid, expiresAt, nowSeconds());
    return {
      label, configured: true, valid, expiresAt, daysLeft, severity,
      detail:
        severity === "ok" && daysLeft === null
          ? "long-lived (no expiry)"
          : severity === "ok"
          ? `valid, ${daysLeft} days left`
          : severity === "warn"
          ? `expires in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`
          : "token invalid / expired",
    };
  } catch (e) {
    return {
      label, configured: true, valid: null, expiresAt: null, daysLeft: null,
      severity: "unknown", detail: e instanceof Error ? e.message : String(e),
    };
  }
}

async function checkLinkedInToken(): Promise<TokenStatus> {
  const label = "LinkedIn";
  const token = process.env.LINKEDIN_ACCESS_TOKEN;
  if (!token) {
    return { label, configured: false, valid: null, expiresAt: null, daysLeft: null, severity: "unknown", detail: "not configured" };
  }

  const clientId = process.env.LINKEDIN_CLIENT_ID;
  const clientSecret = process.env.LINKEDIN_CLIENT_SECRET;

  // Preferred: introspection gives a real expiry so we can warn ahead of time.
  if (clientId && clientSecret) {
    try {
      const res = await fetch("https://www.linkedin.com/oauth/v2/introspectToken", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, token }),
      });
      const json = (await res.json()) as { active?: boolean; expires_at?: number; status?: string };
      if (res.ok && typeof json.active === "boolean") {
        const valid = json.active && json.status !== "revoked";
        const expiresAt = json.expires_at ?? null;
        const { severity, daysLeft } = classifyExpiry(valid, expiresAt, nowSeconds());
        return {
          label, configured: true, valid, expiresAt, daysLeft, severity,
          detail: valid
            ? daysLeft === null ? "active" : `active, ${daysLeft} days left`
            : `inactive (${json.status || "expired"})`,
        };
      }
      // fall through to ping on an unexpected shape
    } catch {
      // fall through to ping
    }
  }

  // Fallback: binary validity ping (no expiry lead time).
  try {
    const res = await fetch("https://api.linkedin.com/v2/userinfo", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const valid = res.ok;
    return {
      label, configured: true, valid, expiresAt: null,
      daysLeft: valid ? null : 0,
      severity: valid ? "ok" : "expired",
      detail: valid
        ? "valid (no expiry data — set LINKEDIN_CLIENT_ID/SECRET for lead time)"
        : `token rejected (${res.status})`,
    };
  } catch (e) {
    return { label, configured: true, valid: null, expiresAt: null, daysLeft: null, severity: "unknown", detail: e instanceof Error ? e.message : String(e) };
  }
}

// Runs every configured token check. Skips checks whose env vars are absent so
// the report only covers credentials this deployment actually uses.
export async function checkAllTokens(): Promise<TokenStatus[]> {
  const checks: Promise<TokenStatus>[] = [];

  if (process.env.META_ACCESS_TOKEN) {
    checks.push(checkMetaToken("Meta (Instagram + user)", process.env.META_ACCESS_TOKEN));
  }
  // Only check the page token separately if it is a distinct value.
  const pageToken = process.env.META_PAGE_ACCESS_TOKEN;
  if (pageToken && pageToken !== process.env.META_ACCESS_TOKEN) {
    checks.push(checkMetaToken("Meta (Facebook page)", pageToken));
  }
  checks.push(checkLinkedInToken());

  return Promise.all(checks);
}

const SEVERITY_EMOJI: Record<TokenSeverity, string> = {
  ok: ":large_green_circle:",
  warn: ":large_yellow_circle:",
  expired: ":red_circle:",
  unknown: ":white_circle:",
};

// Build a Slack message from statuses. Returns null when nothing needs
// attention (all ok/unknown-but-configured) so the daily run stays quiet.
export function buildTokenAlert(statuses: TokenStatus[]): string | null {
  const configured = statuses.filter((s) => s.configured);
  const actionable = configured.filter((s) => s.severity === "warn" || s.severity === "expired");
  if (actionable.length === 0) return null;

  const lines = configured.map(
    (s) => `${SEVERITY_EMOJI[s.severity]} *${s.label}*: ${s.detail}`
  );
  const expired = actionable.filter((s) => s.severity === "expired").length;
  const header =
    expired > 0
      ? `:rotating_light: *Publishing token needs reconnecting* — scheduled posts will fail until fixed`
      : `:warning: *Publishing token expiring soon* — reconnect within ${WARN_DAYS} days to avoid failed posts`;

  return `${header}\n${lines.join("\n")}\n_Refresh the token in Vercel env, then redeploy._`;
}
