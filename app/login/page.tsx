import type { Metadata } from "next";

import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Sign in — M Needs a Budget",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const { from } = await searchParams;

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold tracking-tight">
          M Needs a Budget
        </h1>
        <p className="mt-1 text-sm text-neutral-500">
          Enter the password to open the budget.
        </p>
        <LoginForm from={from} />
      </div>
    </main>
  );
}
