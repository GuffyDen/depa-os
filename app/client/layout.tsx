import type { Metadata } from "next";
import "./client-portal.css";
import "./client-portal-v2.css";
import "./client-additional-works.css";
import "./client-handover.css";
import "./client-passport.css";
export const metadata:Metadata={title:"Личный кабинет — DEPA STROY",robots:{index:false,follow:false}};
export default function ClientLayout({children}:{children:React.ReactNode}){return <div className="client-portal-root">{children}</div>}
