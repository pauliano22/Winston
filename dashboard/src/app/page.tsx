"use client";

import { useAuth } from "@clerk/nextjs";
import { useEffect, useState, useCallback } from "react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://3.144.134.48:8000";
const API_KEY = process.env.NEXT_PUBLIC_WINSTON_API_KEY || "change-me-before-production";

type Project = {
  project_id: string;
  balance: number;
};

function StatusBadge({ balance }: { balance: number }) {
  if (balance <= 0)
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-700">
        <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
        Exhausted
      </span>
    );
  if (balance < 5)
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-yellow-100 px-2.5 py-0.5 text-xs font-medium text-yellow-700">
        <span className="h-1.5 w-1.5 rounded-full bg-yellow-500" />
        Low
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-700">
      <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
      Active
    </span>
  );
}

export default function Home() {
  console.log("Using API Key:", process.env.NEXT_PUBLIC_WINSTON_API_KEY);
  const { isLoaded, userId } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const [projectId, setProjectId] = useState("");
  const [amount, setAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitStatus, setSubmitStatus] = useState<{
    ok: boolean;
    msg: string;
  } | null>(null);

  const fetchBudgets = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const res = await fetch(`${API}/v1/admin/budgets`, {
        headers: { "X-Winston-API-Key": API_KEY },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: Project[] = await res.json();
      setProjects(data.sort((a, b) => a.project_id.localeCompare(b.project_id)));
    } catch (err) {
      setFetchError(
        err instanceof Error ? err.message : "Could not reach proxy"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBudgets();
  }, [fetchBudgets]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = parseFloat(amount);
    if (!projectId.trim() || isNaN(parsed) || parsed < 0) {
      setSubmitStatus({ ok: false, msg: "Enter a valid project ID and amount." });
      return;
    }
    setSubmitting(true);
    setSubmitStatus(null);
    try {
      const res = await fetch(`${API}/v1/admin/budgets`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Winston-API-Key": API_KEY },
        body: JSON.stringify({ project_id: projectId.trim(), amount: parsed }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.detail ?? `HTTP ${res.status}`);
      }
      const data: Project = await res.json();
      setSubmitStatus({
        ok: true,
        msg: `Budget for "${data.project_id}" set to $${data.balance.toFixed(2)}.`,
      });
      setProjectId("");
      setAmount("");
      await fetchBudgets();
    } catch (err) {
      setSubmitStatus({
        ok: false,
        msg: err instanceof Error ? err.message : "Request failed.",
      });
    } finally {
      setSubmitting(false);
    }
  }

  if (!isLoaded) return null;

  if (!userId) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950 text-zinc-400 text-sm">
        Please sign in to manage your AI project budgets.
      </div>
    );
  }

  return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans">
      {/* Header */}
      <header className="border-b border-zinc-800 bg-zinc-900">
        <div className="mx-auto max-w-5xl px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-white font-bold text-sm">
              W
            </div>
            <div>
              <h1 className="text-sm font-semibold text-zinc-100 leading-none">
                Winston
              </h1>
              <p className="text-xs text-zinc-400 mt-0.5">Command Center</p>
            </div>
          </div>
          <button
            onClick={fetchBudgets}
            disabled={loading}
            className="flex items-center gap-2 rounded-md border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-300 transition hover:bg-zinc-700 disabled:opacity-50"
          >
            <svg
              className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`}
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <path d="M13.5 8A5.5 5.5 0 1 1 8 2.5" strokeLinecap="round" />
              <path d="M13.5 2.5v3h-3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Refresh
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8 space-y-8">
        {/* Budget table */}
        <section>
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-zinc-100">
                Active Projects
              </h2>
              <p className="text-xs text-zinc-500 mt-0.5">
                Live budget balances pulled from Redis.
              </p>
            </div>
            {!loading && !fetchError && (
              <span className="text-xs text-zinc-500">
                {projects.length} project{projects.length !== 1 ? "s" : ""}
              </span>
            )}
          </div>

          {fetchError ? (
            <div className="rounded-lg border border-red-900 bg-red-950/40 px-4 py-3 text-sm text-red-400">
              Failed to load budgets: {fetchError}. Is the proxy running at{" "}
              <code className="font-mono text-xs">{API}</code>?
            </div>
          ) : loading ? (
            <div className="rounded-lg border border-zinc-800 bg-zinc-900">
              {[...Array(3)].map((_, i) => (
                <div
                  key={i}
                  className="flex items-center gap-4 border-b border-zinc-800 last:border-0 px-4 py-3.5"
                >
                  <div className="h-3 w-32 rounded bg-zinc-800 animate-pulse" />
                  <div className="ml-auto h-3 w-16 rounded bg-zinc-800 animate-pulse" />
                  <div className="h-5 w-14 rounded-full bg-zinc-800 animate-pulse" />
                </div>
              ))}
            </div>
          ) : projects.length === 0 ? (
            <div className="rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-10 text-center text-sm text-zinc-500">
              No projects found. Use the form below to add one.
            </div>
          ) : (
            <div className="rounded-lg border border-zinc-800 bg-zinc-900 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-800 text-left text-xs text-zinc-500 uppercase tracking-wider">
                    <th className="px-4 py-3 font-medium">Project ID</th>
                    <th className="px-4 py-3 font-medium text-right">Balance</th>
                    <th className="px-4 py-3 font-medium text-right">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {projects.map((p) => (
                    <tr
                      key={p.project_id}
                      className="border-b border-zinc-800/60 last:border-0 hover:bg-zinc-800/40 transition-colors"
                    >
                      <td className="px-4 py-3.5 font-mono text-zinc-200">
                        {p.project_id}
                      </td>
                      <td className="px-4 py-3.5 text-right tabular-nums text-zinc-300">
                        ${p.balance.toFixed(4)}
                      </td>
                      <td className="px-4 py-3.5 text-right">
                        <StatusBadge balance={p.balance} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Set budget form */}
        <section>
          <div className="mb-4">
            <h2 className="text-base font-semibold text-zinc-100">
              Set Budget
            </h2>
            <p className="text-xs text-zinc-500 mt-0.5">
              Creates or overwrites the budget for a project in Redis.
            </p>
          </div>

          <div className="rounded-lg border border-zinc-800 bg-zinc-900 px-6 py-5">
            <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-3">
              <div className="flex-1">
                <label className="block text-xs font-medium text-zinc-400 mb-1.5">
                  Project ID
                </label>
                <input
                  type="text"
                  placeholder="e.g. project_alpha"
                  value={projectId}
                  onChange={(e) => setProjectId(e.target.value)}
                  className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 font-mono transition"
                />
              </div>
              <div className="w-full sm:w-36">
                <label className="block text-xs font-medium text-zinc-400 mb-1.5">
                  Amount (USD)
                </label>
                <input
                  type="number"
                  placeholder="50.00"
                  min="0"
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 tabular-nums transition"
                />
              </div>
              <div className="flex items-end">
                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full sm:w-auto rounded-md bg-indigo-600 px-5 py-2 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {submitting ? "Saving…" : "Save Budget"}
                </button>
              </div>
            </form>

            {submitStatus && (
              <p
                className={`mt-3 text-xs ${
                  submitStatus.ok ? "text-green-400" : "text-red-400"
                }`}
              >
                {submitStatus.ok ? "✓" : "✗"} {submitStatus.msg}
              </p>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
