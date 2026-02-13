"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Company } from "@/types";
import ThemeToggle from "@/components/ThemeToggle";
import LogoutButton from "@/components/LogoutButton";

interface Props {
  onSelect: (company: Company) => void;
}

export default function CompanySelector({ onSelect }: Props) {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    loadCompanies();
    fetch("/api/auth/me")
      .then((res) => res.ok ? res.json() : null)
      .then((data) => { if (data?.role === "admin") setIsAdmin(true); })
      .catch(() => {});
  }, []);

  async function loadCompanies() {
    setLoading(true);
    try {
      const res = await fetch("/api/companies");
      const data = await res.json();
      if (res.ok && data.companies) {
        // Auto-select if user has exactly 1 company
        if (data.companies.length === 1) {
          onSelect(data.companies[0]);
          return;
        }
        setCompanies(data.companies);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-slate-900">
      <div className="absolute top-4 right-4 flex items-center gap-1">
        {isAdmin && (
          <Link
            href="/admin"
            className="p-2 rounded-lg text-slate-500 dark:text-slate-400 hover:text-brand-primary hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            title="User management"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
            </svg>
          </Link>
        )}
        <ThemeToggle variant="page" />
        <LogoutButton variant="page" />
      </div>
      <div className="max-w-3xl mx-auto px-6 py-16">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-brand-primary mb-3">
            PostPilot
          </h1>
          <p className="text-slate-600 dark:text-slate-400 text-lg">
            Select a company to get started
          </p>
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <svg className="animate-spin h-8 w-8 text-brand-primary" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
          </div>
        ) : companies.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-slate-500 dark:text-slate-400">No companies found. Please complete onboarding first.</p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {companies.map((company) => (
              <button
                key={company.id}
                onClick={() => onSelect(company)}
                className="group relative overflow-hidden rounded-2xl bg-white dark:bg-slate-800 p-8 shadow-sm hover:shadow-md transition-all duration-300 border border-slate-100 dark:border-slate-700 hover:border-brand-primary"
              >
                <div className="absolute inset-0 bg-brand-primary/5 opacity-0 group-hover:opacity-100 transition-opacity" />
                <div className="relative">
                  <div className="w-14 h-14 rounded-xl bg-brand-primary flex items-center justify-center mb-4 shadow-sm">
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
        )}
      </div>
    </main>
  );
}
