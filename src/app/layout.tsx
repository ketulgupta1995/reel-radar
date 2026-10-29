import "./globals.css";
import { LogoutButton } from "@/components/LogoutButton";
export const metadata={title:"My Apps",description:"Personal apps: Reel Radar and the Daily Planner"};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}<LogoutButton/></body></html>}
