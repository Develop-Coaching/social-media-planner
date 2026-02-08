"use client";

import { useState, useEffect } from "react";
import { Company } from "@/types";
import ThemeToggle from "@/components/ThemeToggle";
import LogoutButton from "@/components/LogoutButton";

interface Props {
  onSelect: (company: Company) => void;
}

export default function CompanySelector({ onSelect }: Props) {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    loadCompanies();
  }, []);

  async function loadCompanies() {
    setLoading(true);
    try {
      const res = await fetch("/api/companies");
      const data = await res.json();
      if (res.ok && data.companies) {
        setCompanies(data.companies);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  async function handleAdd() {
    if (!newName.trim()) return;
    setAdding(true);
    try {
      const res = await fetch("/api/companies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim() }),
      });
      if (res.ok) {
        const company = await res.json();
        setCompanies((prev) => [...prev, company]);
        setNewName("");
      } else {
        const data = await res.json();
        alert(data.error || "Failed to add company");
      }
    } finally {
      setAdding(false);
    }
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-50 to-indigo-50 dark:from-slate-900 dark:to-indigo-950">
      <div className="absolute top-4 right-4 flex items-center gap-1">
        <ThemeToggle variant="page" />
        <LogoutButton variant="page" />
      </div>
      <div className="max-w-3xl mx-auto px-6 py-16">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent mb-3">
            Post Creator
          </h1>
          <p className="text-slate-600 dark:text-slate-400 text-lg">
            Select a company to get started
          </p>
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <svg className="animate-spin h-8 w-8 text-indigo-600" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
          </div>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2 mb-8">
              {companies.map((company) => (
                <button
                  key={company.id}
                  onClick={() => onSelect(company)}
                  className="group relative overflow-hidden rounded-2xl bg-white dark:bg-slate-800 p-8 shadow-lg hover:shadow-xl transition-all duration-300 border border-slate-200 dark:border-slate-700 hover:border-indigo-300 dark:hover:border-indigo-600"
                >
                  <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/5 to-purple-500/5 opacity-0 group-hover:opacity-100 transition-opacity" />
                  <div className="relative">
                    <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center mb-4 shadow-lg">
                      <span className="text-white font-bold text-xl">
                        {company.name.charAt(0)}
                      </span>
                    </div>
                    <h2 className="text-xl font-semibold text-slate-900 dark:text-white mb-1">
                      {company.name}
                    </h2>
                    <p className="text-sm text-slate-500 dark:text-slate-400">
                      Click to manage content
                    </p>
                  </div>
                </button>
              ))}
            </div>

            <div className="rounded-2xl bg-white dark:bg-slate-800 p-6 shadow-lg border border-slate-200 dark:border-slate-700">
              <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-200 mb-4">
                Add New Company
              </h3>
              <div className="flex gap-3">
                <input
                  type="text"
                  placeholder="Company name"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAdd()}
                  className="flex-1 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-4 py-3 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-shadow"
                />
                <button
                  onClick={handleAdd}
                  disabled={adding || !newName.trim()}
                  className="px-6 py-3 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 text-white font-medium hover:from-indigo-700 hover:to-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg hover:shadow-xl"
                >
                  {adding ? "Adding..." : "Add"}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
