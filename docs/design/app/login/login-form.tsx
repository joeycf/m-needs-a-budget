"use client";

import { useActionState } from "react";

import { login, type LoginState } from "@/app/actions/auth";

export function LoginForm({ from }: { from?: string }) {
  const [state, formAction, pending] = useActionState<LoginState, FormData>(
    login,
    null,
  );

  return (
    <form action={formAction} className="mt-6 space-y-4">
      {from ? <input type="hidden" name="from" value={from} /> : null}
      <div>
        <label htmlFor="password" className="block text-sm font-medium">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          autoFocus
          autoComplete="current-password"
          className="mt-1 w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-sm shadow-sm outline-none focus:border-neutral-500 focus:ring-2 focus:ring-neutral-300 dark:border-neutral-700 dark:focus:border-neutral-400 dark:focus:ring-neutral-700"
        />
      </div>
      {state?.error ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {state.error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-neutral-700 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
      >
        {pending ? "Checking…" : "Unlock"}
      </button>
    </form>
  );
}
