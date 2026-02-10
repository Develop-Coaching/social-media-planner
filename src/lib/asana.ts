export interface AsanaResult {
  ok: boolean;
  taskUrl?: string;
  error?: string;
}

export async function createAsanaTask(options: {
  name: string;
  notes: string;
  projectId?: string;
  assignee?: string;
}): Promise<AsanaResult> {
  const token = process.env.ASANA_ACCESS_TOKEN;
  if (!token) {
    return { ok: false, error: "Asana is not configured" };
  }

  const projectId = options.projectId || process.env.ASANA_PROJECT_ID;
  const assignee = options.assignee || process.env.ASANA_EDITOR_USER_ID;

  try {
    const body: Record<string, unknown> = {
      name: options.name,
      notes: options.notes,
    };
    if (projectId) body.projects = [projectId];
    if (assignee) body.assignee = assignee;

    const res = await fetch("https://app.asana.com/api/1.0/tasks", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ data: body }),
    });

    if (!res.ok) {
      const text = await res.text();
      return { ok: false, error: `Asana API error: ${res.status} ${text}` };
    }

    const json = await res.json();
    const gid = json.data?.gid;
    const taskUrl = projectId
      ? `https://app.asana.com/0/${projectId}/${gid}`
      : `https://app.asana.com/0/0/${gid}`;

    return { ok: true, taskUrl };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Unknown error creating Asana task",
    };
  }
}
