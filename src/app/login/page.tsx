import { LoginForm } from "./login-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[] }>;
}) {
  const { error } = await searchParams;
  // Rendered as plain text by React, so a crafted link can't inject HTML.
  const signInError = typeof error === "string" ? error.slice(0, 200) : undefined;
  return <LoginForm signInError={signInError} />;
}
