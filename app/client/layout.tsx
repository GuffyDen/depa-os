import type { Metadata } from "next";
import "./client-portal.css";
export const metadata:Metadata={title:"Личный кабинет — DEPA STROY",robots:{index:false,follow:false}};
export default function ClientLayout({children}:{children:React.ReactNode}){return <div className="client-portal-root">{children}</div>}
