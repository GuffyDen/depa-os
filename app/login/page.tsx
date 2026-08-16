import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "../../lib/auth";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Вход — DEPA OS",
  description: "Защищённый вход во внутреннюю систему DEPA Stroy",
};

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) redirect("/dashboard");
  return <main className="login-page">
    <section className="login-brand" aria-label="DEPA Stroy">
      <div className="login-grid" aria-hidden="true" />
      <div className="login-brand-top"><span>DEPA STROY</span><span>VLADIVOSTOK · 2026</span></div>
      <div className="login-brand-copy"><div className="login-logo"><span>ДЕПА</span><b>СТРОЙ</b></div><p>Внутренняя операционная система</p><h1>DEPA<br/><em>OS</em></h1></div>
      <div className="login-brand-bottom"><span>ОБЪЕКТЫ</span><span>ФИНАНСЫ</span><span>КОМАНДА</span></div>
    </section>
    <section className="login-panel">
      <div className="login-mobile-logo"><b>ДЕПА</b><span>СТРОЙ</span><em>OS</em></div>
      <LoginForm />
      <footer><span>DEPA OS · защищённый контур</span><span>v0.2</span></footer>
    </section>
  </main>;
}
