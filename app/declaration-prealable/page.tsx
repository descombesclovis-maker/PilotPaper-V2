import { CompleteDpExperience } from "@/components/production/complete-dp-experience";
import { PilotPaperProductionShell } from "@/components/production/pilotpaper-production-shell";
import { PilotPaperUpdateButton } from "@/components/pilotpaper-update-button";

export default function DeclarationPrealablePage() {
  return (
    <PilotPaperProductionShell>
      <CompleteDpExperience />
      <PilotPaperUpdateButton />
    </PilotPaperProductionShell>
  );
}
