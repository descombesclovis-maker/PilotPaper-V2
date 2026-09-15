import { CompleteDpBackgroundExperience } from "@/components/production/complete-dp-background-experience";
import { PilotPaperProductionShell } from "@/components/production/pilotpaper-production-shell";
import { PilotPaperUpdateButton } from "@/components/pilotpaper-update-button";

export default function DeclarationPrealablePage() {
  return (
    <PilotPaperProductionShell>
      <CompleteDpBackgroundExperience />
      <PilotPaperUpdateButton />
    </PilotPaperProductionShell>
  );
}
