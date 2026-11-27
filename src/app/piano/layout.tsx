import { ReactNode } from "react";
import { PianoProvider } from "./PianoProvider";

export default function PianoLayout({ children }: { children: ReactNode }) {
  return <PianoProvider>{children}</PianoProvider>;
}
