import "./globals.css";
import { LogoutButton } from "@/components/LogoutButton";
export const metadata={title:"My Apps",description:"Personal apps: Reel Radar and the Daily Planner",manifest:"/manifest.webmanifest",icons:{icon:"/icon-192.png",apple:"/apple-touch-icon.png"},appleWebApp:{capable:true,title:"My Apps",statusBarStyle:"black-translucent" as const}};
export const viewport={themeColor:"#07070c"};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}<LogoutButton/></body></html>}
