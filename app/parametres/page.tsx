import { PilotPaperProductionShell } from "@/components/production/pilotpaper-production-shell";
import { PilotPaperSettings } from "@/components/production/pilotpaper-settings";
import { PilotPaperUpdateButton } from "@/components/pilotpaper-update-button";

export default function ParametresPage() {
  return (
    <PilotPaperProductionShell>
      <PilotPaperSettings />
      <PilotPaperUpdateButton />
    </PilotPaperProductionShell>
  );
}
