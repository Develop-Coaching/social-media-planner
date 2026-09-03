export type IdentityHealthState = "ok" | "misconfigured" | "unhealthy" | "unknown";

export interface PublisherIdentityHealth {
  platform: "instagram" | "facebook" | "linkedin";
  configured: boolean;
  state: IdentityHealthState;
  identity: string | null;
  missingPermissions: string[];
  detail: string;
}

type Environment = Record<string, string | undefined>;
type Fetcher = typeof fetch;

const IG_PERMISSIONS = ["instagram_basic", "instagram_content_publish", "pages_read_engagement"];
const FB_PERMISSIONS = ["pages_manage_posts"];

function metaGraphBase(env: Environment): string {
  const version = env.META_GRAPH_VERSION || "v24.0";
  if (!/^v\d+\.\d+$/.test(version)) throw new Error("META_GRAPH_VERSION must look like v24.0");
  return `https://graph.facebook.com/${version}`;
}

function linkedInHeaders(env: Environment): Record<string, string> {
  const version = env.LINKEDIN_API_VERSION || "202606";
  if (!/^\d{6}$/.test(version)) throw new Error("LINKEDIN_API_VERSION must be YYYYMM");
  return {
    Authorization: `Bearer ${env.LINKEDIN_ACCESS_TOKEN}`,
    "LinkedIn-Version": version,
    "X-Restli-Protocol-Version": "2.0.0",
  };
}

async function grantedMetaPermissions(fetcher: Fetcher, graph: string, token: string): Promise<Set<string> | null> {
  const response = await fetcher(`${graph}/me/permissions?access_token=${encodeURIComponent(token)}`, { cache: "no-store" });
  if (!response.ok) return null;
  const body = (await response.json()) as { data?: Array<{ permission?: string; status?: string }> };
  return new Set((body.data ?? []).filter((item) => item.status === "granted").map((item) => item.permission).filter(Boolean) as string[]);
}

async function checkMetaIdentity(input: {
  platform: "instagram" | "facebook";
  id: string | undefined;
  token: string | undefined;
  permissionToken: string | undefined;
  requiredPermissions: string[];
  fields: string;
  env: Environment;
  fetcher: Fetcher;
}): Promise<PublisherIdentityHealth> {
  if (!input.id || !input.token || !input.permissionToken) {
    return {
      platform: input.platform, configured: false, state: "misconfigured", identity: null,
      missingPermissions: input.requiredPermissions,
      detail: "Required identity and token environment variables are not configured",
    };
  }
  try {
    const graph = metaGraphBase(input.env);
    const [identityResponse, permissions] = await Promise.all([
      input.fetcher(`${graph}/${encodeURIComponent(input.id)}?fields=${input.fields}&access_token=${encodeURIComponent(input.token)}`, { cache: "no-store" }),
      grantedMetaPermissions(input.fetcher, graph, input.permissionToken),
    ]);
    if (!identityResponse.ok) {
      return { platform: input.platform, configured: true, state: "unhealthy", identity: null, missingPermissions: [], detail: `Identity read was rejected (${identityResponse.status})` };
    }
    const body = (await identityResponse.json()) as { id?: string; username?: string; name?: string };
    if (body.id !== input.id) {
      return { platform: input.platform, configured: true, state: "unhealthy", identity: body.id ?? null, missingPermissions: [], detail: "Provider identity does not match configured ID" };
    }
    const missing = permissions ? input.requiredPermissions.filter((permission) => !permissions.has(permission)) : [];
    return {
      platform: input.platform,
      configured: true,
      state: permissions === null ? "unknown" : missing.length ? "unhealthy" : "ok",
      identity: body.username || body.name || body.id,
      missingPermissions: missing,
      detail: permissions === null ? "Identity matched; permission read was unavailable" : missing.length ? "Identity matched but required permissions are missing" : "Identity and required permissions verified",
    };
  } catch {
    return { platform: input.platform, configured: true, state: "unknown", identity: null, missingPermissions: [], detail: "Read-only provider check failed" };
  }
}

async function checkLinkedInIdentity(env: Environment, fetcher: Fetcher): Promise<PublisherIdentityHealth> {
  const token = env.LINKEDIN_ACCESS_TOKEN;
  const author = env.LINKEDIN_AUTHOR_URN;
  if (!token || !author) {
    return { platform: "linkedin", configured: false, state: "misconfigured", identity: null, missingPermissions: [], detail: "LinkedIn token or author URN is not configured" };
  }
  try {
    if (author.startsWith("urn:li:person:")) {
      const response = await fetcher("https://api.linkedin.com/v2/userinfo", {
        cache: "no-store", headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) return { platform: "linkedin", configured: true, state: "unhealthy", identity: null, missingPermissions: [], detail: `Identity read was rejected (${response.status})` };
      const body = (await response.json()) as { sub?: string; name?: string };
      const actual = body.sub ? `urn:li:person:${body.sub}` : null;
      return actual === author
        ? { platform: "linkedin", configured: true, state: "ok", identity: body.name || actual, missingPermissions: [], detail: "Configured person identity verified" }
        : { platform: "linkedin", configured: true, state: "unhealthy", identity: actual, missingPermissions: [], detail: "Authenticated person does not match configured author URN" };
    }

    if (!author.startsWith("urn:li:organization:")) {
      return { platform: "linkedin", configured: true, state: "misconfigured", identity: null, missingPermissions: [], detail: "LinkedIn author URN has an unsupported shape" };
    }
    const response = await fetcher("https://api.linkedin.com/rest/organizationAcls?q=roleAssignee&state=APPROVED", {
      cache: "no-store", headers: linkedInHeaders(env),
    });
    if (!response.ok) return { platform: "linkedin", configured: true, state: "unhealthy", identity: author, missingPermissions: [], detail: `Organization authorization read was rejected (${response.status})` };
    const body = (await response.json()) as {
      elements?: Array<{ organization?: string; organizationTarget?: string; state?: string }>;
    };
    const authorized = (body.elements ?? []).some((element) =>
      (element.organization === author || element.organizationTarget === author) && element.state === "APPROVED"
    );
    return authorized
      ? { platform: "linkedin", configured: true, state: "ok", identity: author, missingPermissions: [], detail: "Organization authorization verified" }
      : { platform: "linkedin", configured: true, state: "unhealthy", identity: author, missingPermissions: [], detail: "No approved organization authorization was returned for the authenticated member" };
  } catch {
    return { platform: "linkedin", configured: true, state: "unknown", identity: null, missingPermissions: [], detail: "Read-only provider check failed" };
  }
}

export async function checkPublisherIdentities(
  env: Environment = process.env,
  fetcher: Fetcher = fetch,
): Promise<PublisherIdentityHealth[]> {
  const userToken = env.META_ACCESS_TOKEN;
  return Promise.all([
    checkMetaIdentity({
      platform: "instagram", id: env.META_IG_USER_ID, token: userToken, permissionToken: userToken,
      requiredPermissions: IG_PERMISSIONS, fields: "id,username", env, fetcher,
    }),
    checkMetaIdentity({
      platform: "facebook", id: env.META_FB_PAGE_ID, token: env.META_PAGE_ACCESS_TOKEN || userToken,
      permissionToken: userToken || env.META_PAGE_ACCESS_TOKEN, requiredPermissions: FB_PERMISSIONS, fields: "id,name", env, fetcher,
    }),
    checkLinkedInIdentity(env, fetcher),
  ]);
}
