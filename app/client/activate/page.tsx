import { Suspense } from "react";
import { ClientActivateForm } from "../client-auth-forms";
export default function ClientActivatePage(){return <main className="cp-auth"><section className="cp-auth-brand"><span>DEPA STROY</span><h1>СОЗДАНИЕ<br/>ДОСТУПА</h1><p>Придумайте пароль для защищённого личного кабинета.</p></section><Suspense fallback={<div className="cp-auth-card">Загрузка…</div>}><ClientActivateForm/></Suspense></main>}
