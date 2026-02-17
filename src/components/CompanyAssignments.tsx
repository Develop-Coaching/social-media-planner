"use client";

import { useState, useEffect, useCallback } from "react";

interface AgentUser {
  id: string;
  username: string;
  displayName: string;
}

interface Assignment {
  id: string;
  agentUserId: string;
  agentDisplayName: string;
  assignedAt: string;
}

interface Props {
  companyId: string;
  isAssigned?: boolean;
}

export default function CompanyAssignments({ companyId, isAssigned }: Props) {
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [agents, setAgents] = useState<AgentUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [assigning, setAssigning] = useState(false);
  const [error, setError] = useState("");

  const loadAssignments = useCallback(async () => {
    try {
      const res = await fetch(`/api/assignments?companyId=${companyId}`);
      if (res.ok) {
        const data = await res.json();
        setAssignments(data.assignments || []);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  const loadAgents = useCallback(async () => {
    try {
      const res = await fetch("/api/agents");
      if (res.ok) {
        const data = await res.json();
        setAgents(data.agents || []);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    loadAssignments();
    loadAgents();
  }, [loadAssignments, loadAgents]);

  async function handleAssign() {
    if (!selectedAgentId) return;
    setAssigning(true);
    setError("");
    try {
      const res = await fetch("/api/assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, agentUserId: selectedAgentId }),
      });
      if (res.ok) {
        setSelectedAgentId("");
        await loadAssignments();
      } else {
        const data = await res.json();
        setError(data.error || "Failed to assign agent");
      }
    } catch {
      setError("Failed to assign agent");
    } finally {
      setAssigning(false);
    }
  }

  async function handleRemove(assignmentId: string) {
    try {
      const res = await fetch(`/api/assignments?id=${assignmentId}`, { method: "DELETE" });
      if (res.ok) {
        setAssignments((prev) => prev.filter((a) => a.id !== assignmentId));
      }
    } catch {
      // ignore
    }
  }

  // Don't render for assigned agents (they can't manage assignments for companies they don't own)
  if (isAssigned) return null;

  const assignedIds = new Set(assignments.map((a) => a.agentUserId));
  const availableAgents = agents.filter((a) => !assignedIds.has(a.id));

  return (
    <div className="mt-6 pt-6 border-t border-slate-200 dark:border-slate-700">
      <h4 className="font-medium text-slate-700 dark:text-slate-300 mb-3">Assigned Agents</h4>

      {loading ? (
        <p className="text-sm text-slate-400">Loading...</p>
      ) : (
        <>
          {assignments.length > 0 ? (
            <div className="space-y-2 mb-4">
              {assignments.map((a) => (
                <div
                  key={a.id}
                  className="flex items-center justify-between py-2 px-3 rounded-lg bg-slate-50 dark:bg-slate-900/50"
                >
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-full bg-blue-500 flex items-center justify-center text-white text-xs font-semibold">
                      {a.agentDisplayName.charAt(0).toUpperCase()}
                    </div>
                    <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                      {a.agentDisplayName}
                    </span>
                  </div>
                  <button
                    onClick={() => handleRemove(a.id)}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors"
                    title="Remove assignment"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-400 dark:text-slate-500 mb-4">No agents assigned to this company.</p>
          )}

          {availableAgents.length > 0 && (
            <div className="flex items-center gap-2">
              <select
                value={selectedAgentId}
                onChange={(e) => setSelectedAgentId(e.target.value)}
                className="flex-1 rounded-full border-0 bg-indigo-50/60 dark:bg-slate-800/80 px-4 py-2 text-sm text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-brand-primary focus:outline-none"
              >
                <option value="">Select an agent...</option>
                {availableAgents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.displayName} (@{a.username})
                  </option>
                ))}
              </select>
              <button
                onClick={handleAssign}
                disabled={!selectedAgentId || assigning}
                className="px-4 py-2 rounded-full bg-brand-primary text-white text-sm font-medium hover:bg-brand-primary-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {assigning ? "Assigning..." : "Assign"}
              </button>
            </div>
          )}

          {error && (
            <p className="text-sm text-red-500 mt-2">{error}</p>
          )}
        </>
      )}
    </div>
  );
}
