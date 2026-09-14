import { DpPieceWorkbenchClient } from "@/components/dp-piece-workbench-client";
import { PilotPaperUpdateButton } from "@/components/pilotpaper-update-button";
import { SiteTwinAddressBridge } from "@/components/site-twin-address-bridge";

export default function Page() {
  return (
    <>
      <SiteTwinAddressBridge />
      <DpPieceWorkbenchClient />
      <PilotPaperUpdateButton />
    </>
  );
}
