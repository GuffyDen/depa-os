import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { DepaOS } from "../depa-os";
import { getCurrentUser } from "../../lib/auth";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Обзор — DEPA OS",
  description: "Внутренняя операционная система DEPA Stroy",
};

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return <DepaOS currentUser={user} />;
}
