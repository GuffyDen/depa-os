"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export function LoginForm() {
  const router = useRouter();
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);
    const data = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: data.get("username"), password: data.get("password") }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) { setError(result.error ?? "Не удалось войти."); setLoading(false); return; }
      router.push("/dashboard");
    } catch {
      setError("Нет связи с системой. Проверьте подключение и повторите.");
      setLoading(false);
    }
  }

  return <div className="login-form-wrap">
    <div className="login-heading"><span>АВТОРИЗАЦИЯ</span><h2>Вход в систему</h2><p>Используйте выданный вам логин DEPA OS.</p></div>
    <form className="login-form" onSubmit={submit} noValidate>
      <label><span>Логин</span><input name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} required placeholder="Введите логин" aria-invalid={Boolean(error)} /></label>
      <label><span>Пароль</span><div className="password-control"><input name="password" type={showPassword ? "text" : "password"} autoComplete="current-password" required placeholder="Введите пароль" aria-invalid={Boolean(error)} /><button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Скрыть пароль" : "Показать пароль"}>{showPassword ? "Скрыть" : "Показать"}</button></div></label>
      {error && <div className="auth-error" role="alert"><i>!</i><span>{error}</span></div>}
      <button className="login-submit" type="submit" disabled={loading}>{loading ? <><i className="spinner" />Проверяем…</> : <>Войти <span>→</span></>}</button>
    </form>
    <div className="login-help"><span>Проблемы со входом?</span><p>Обратитесь к одному из владельцев DEPA Stroy.</p></div>
  </div>;
}
