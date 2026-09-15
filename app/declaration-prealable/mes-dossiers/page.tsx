import { MesDossiers } from "@/components/production/mes-dossiers";
import { PilotPaperProductionShell } from "@/components/production/pilotpaper-production-shell";
import { PilotPaperUpdateButton } from "@/components/pilotpaper-update-button";

export default function MesDossiersPage() {
  return (
    <PilotPaperProductionShell>
      <MesDossiers />
      <PilotPaperUpdateButton />
    </PilotPaperProductionShell>
  );
}
