import "./globals.css";
import { LogoutButton } from "@/components/LogoutButton";
export const metadata={title:"Reel Radar",description:"Cinematic discovery powered by your viewing history"};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}<LogoutButton/></body></html>}
