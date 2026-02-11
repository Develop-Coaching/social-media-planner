"use client";

import { useState, useEffect } from "react";
import { Company } from "@/types";
import ThemeToggle from "@/components/ThemeToggle";
import LogoutButton from "@/components/LogoutButton";
import CompanySetupWizard from "@/components/CompanySetupWizard";

interface Props {
  onSelect: (company: Company) => void;
}

export default function CompanySelector({ onSelect }: Props) {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [showWizard, setShowWizard] = useState(false);

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

  function handleWizardComplete(company: Company) {
    setCompanies((prev) => [...prev, company]);
    setShowWizard(false);
    onSelect(company);
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-50 to-brand-primary-light dark:from-slate-900 dark:to-brand-primary-light">
      <div className="absolute top-4 right-4 flex items-center gap-1">
        <ThemeToggle variant="page" />
        <LogoutButton variant="page" />
      </div>
      <div className="max-w-3xl mx-auto px-6 py-16">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-brand-primary mb-3">
            Post Creator
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
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {companies.map((company) => (
              <button
                key={company.id}
                onClick={() => onSelect(company)}
                className="group relative overflow-hidden rounded-2xl bg-white dark:bg-slate-800 p-8 shadow-lg hover:shadow-xl transition-all duration-300 border border-slate-200 dark:border-slate-700 hover:border-brand-primary"
              >
                <div className="absolute inset-0 bg-brand-primary/5 opacity-0 group-hover:opacity-100 transition-opacity" />
                <div className="relative">
                  <div className="w-14 h-14 rounded-xl bg-brand-primary flex items-center justify-center mb-4 shadow-lg">
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

            {/* Add New Company card */}
            <button
              onClick={() => setShowWizard(true)}
              className="group rounded-2xl border-2 border-dashed border-slate-300 dark:border-slate-600 hover:border-brand-primary p-8 transition-all duration-300 hover:bg-brand-primary-light"
            >
              <div className="flex flex-col items-center justify-center text-center">
                <div className="w-14 h-14 rounded-xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center mb-4 group-hover:bg-brand-primary-light transition-colors">
                  <svg className="w-7 h-7 text-slate-400 dark:text-slate-500 group-hover:text-brand-primary transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                </div>
                <h2 className="text-lg font-semibold text-slate-600 dark:text-slate-400 group-hover:text-brand-primary transition-colors mb-1">
                  Add New Company
                </h2>
                <p className="text-sm text-slate-400 dark:text-slate-500">
                  Set up name, Slack & branding
                </p>
              </div>
            </button>
          </div>
        )}
      </div>

      {showWizard && (
        <CompanySetupWizard
          onComplete={handleWizardComplete}
          onCancel={() => setShowWizard(false)}
        />
      )}
    </main>
  );
}
