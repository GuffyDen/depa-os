import type { Metadata } from "next";
import { DepaOS } from "./depa-os";

export const metadata: Metadata = {
  title: "DEPA OS — управление компанией",
  description: "Внутренняя операционная система DEPA Строй",
};

export default function Home() {
  return <DepaOS />;
}
