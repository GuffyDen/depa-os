import type { Metadata } from "next";
import { Manrope, Unbounded } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";
import "./dark-theme.css";
import "./residential-complexes.css";

const manrope = Manrope({ variable: "--font-manrope", subsets: ["latin", "cyrillic"] });
const unbounded = Unbounded({ variable: "--font-unbounded", subsets: ["latin", "cyrillic"] });

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const imageUrl = `${protocol}://${host}/og.png`;
  return {
    title: "DEPA OS — внутренняя система DEPA Строй",
    description: "Объекты, финансы и команда — в едином контуре управления.",
    openGraph: { title: "DEPA OS", description: "Единый контур управления DEPA Строй", images: [{ url: imageUrl, width: 1200, height: 630 }] },
    twitter: { card: "summary_large_image", title: "DEPA OS", description: "Объекты. Финансы. Команда.", images: [imageUrl] },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ru"><body className={`${manrope.variable} ${unbounded.variable}`}>{children}</body></html>;
}
