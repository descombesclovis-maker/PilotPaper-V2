import { DpPieceWorkbenchClient } from "@/components/dp-piece-workbench-client";
import { PilotPaperUpdateButton } from "@/components/pilotpaper-update-button";
import { SiteTwinDebugger } from "@/components/site-twin-debugger";

export default function Page() {
  return (
    <>
      <SiteTwinDebugger />
      <DpPieceWorkbenchClient />
      <PilotPaperUpdateButton />
    </>
  );
}
