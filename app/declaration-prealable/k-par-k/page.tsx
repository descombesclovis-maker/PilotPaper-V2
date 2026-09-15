import { DpPieceWorkbenchClient } from "@/components/dp-piece-workbench-client";
import { PilotPaperProductionShell } from "@/components/production/pilotpaper-production-shell";
import { PilotPaperUpdateButton } from "@/components/pilotpaper-update-button";

export default function KParKPage() {
  return (
    <PilotPaperProductionShell>
      <DpPieceWorkbenchClient />
      <PilotPaperUpdateButton />
    </PilotPaperProductionShell>
  );
}
