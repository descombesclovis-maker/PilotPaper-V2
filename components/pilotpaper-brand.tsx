import { cn } from "@/lib/utils";

type BrandProps = {
  className?: string;
  compact?: boolean;
};

export function PilotPaperMark({ className }: BrandProps) {
  return (
    <span
      className={cn("pilotpaper-mark", className)}
      role="img"
      aria-label="Monogramme PilotPaper"
    >
      <span aria-hidden="true" />
    </span>
  );
}

export function PilotPaperWordmark({ className, compact = false }: BrandProps) {
  return (
    <span
      className={cn("pilotpaper-wordmark", compact && "is-compact", className)}
      aria-label="PilotPaper"
    >
      <span className="pilotpaper-pilot">Pilot</span>
      <span className="pilotpaper-paper">Paper</span>
    </span>
  );
}

export function GenerateDeclarationLabel() {
  return (
    <span className="generate-label">
      Générer ma <span className="generate-initial is-blue">D</span>
      <span>éclaration </span>
      <span className="generate-initial is-graphite">P</span>
      <span>réalable</span>
    </span>
  );
}
