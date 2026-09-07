"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Eye,
  FlaskConical,
  ImageIcon,
  LoaderCircle,
  Ruler,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type ProjectOption = {
  id: string;
  siteAddress: string;
  moduleCount: number | null;
  moduleReference: string;
  formData: string;
};

type ProjectListResponse = {
  projects?: ProjectOption[];
  error?: string;
};

type StoredDetails = Record<string, unknown>;
type VisionStatus = "" | "verified" | "fallback";
type CheckStatus = "" | "passed" | "warning";
type AiQaStatus = "" | "passed" | "warning" | "unavailable";

type LabDiagnostics = {
  vision: VisionStatus;
  geometry: CheckStatus;
  sourcePreservation: "" | "preserved" | "changed";
  aiQa: AiQaStatus;
  roofConfidence?: number;
  qaScore?: number;
  photorealismScore?: number;
  qaIssues: number;
  panelCount: string;
  sourceRole: string;
  projection: string;
  gutterMm: string;
  ridgeMm: string;
  leftMm: string;
  rightMm: string;
  fieldWidthMm: string;
  fieldHeightMm: string;
};

const EMPTY_DIAGNOSTICS: LabDiagnostics = {
  vision: "",
  geometry: "",
  sourcePreservation: "",
  aiQa: "",
  qaIssues: 0,
  panelCount: "",
  sourceRole: "",
  projection: "",
  gutterMm: "",
  ridgeMm: "",
  leftMm: "",
  rightMm: "",
  fieldWidthMm: "",
  fieldHeightMm: "",
};

function parsedDetails(project?: ProjectOption): StoredDetails {
  try {
    return JSON.parse(project?.formData ?? "{}") as StoredDetails;
  } catch {
    return {};
  }
}

function numberString(value: unknown, fallback: string) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? String(number) : fallback;
}

function optionalNumber(value: string | null) {
  if (value == null || value.trim() === "") return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function metricLabel(value: string, suffix = "mm") {
  return value ? `${value} ${suffix}` : "—";
}

function DiagnosticCard({
  icon,
  title,
  value,
  detail,
  tone,
}: {
  icon: React.ReactNode;
  title: string;
  value: string;
  detail: string;
  tone: "success" | "warning" | "neutral";
}) {
  const toneClass =
    tone === "success"
      ? "border-emerald-200 bg-emerald-50/80 text-emerald-950"
      : tone === "warning"
        ? "border-amber-200 bg-amber-50/90 text-amber-950"
        : "border-zinc-200 bg-white text-zinc-900";

  return (
    <div className={`rounded-2xl border p-3 ${toneClass}`}>
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.08em] opacity-70">
        {icon}
        {title}
      </div>
      <p className="mt-2 text-sm font-semibold">{value}</p>
      <p className="mt-1 text-[11px] leading-4 opacity-70">{detail}</p>
    </div>
  );
}

export function AdminDpImageLab() {
  const [open, setOpen] = useState(false);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [projectId, setProjectId] = useState("");
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [resultUrl, setResultUrl] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [diagnostics, setDiagnostics] =
    useState<LabDiagnostics>(EMPTY_DIAGNOSTICS);

  const [dp, setDp] = useState<"4" | "6">("6");
  const [moduleReference, setModuleReference] = useState("");
  const [moduleWidthMm, setModuleWidthMm] = useState("1134");
  const [moduleHeightMm, setModuleHeightMm] = useState("1762");
  const [moduleCount, setModuleCount] = useState("12");
  const [rows, setRows] = useState("2");
  const [columns, setColumns] = useState("6");
  const [orientation, setOrientation] = useState<"portrait" | "landscape">(
    "portrait",
  );
  const [layoutMode, setLayoutMode] = useState<"fixed" | "automatic">("fixed");
  const [panelGapMm, setPanelGapMm] = useState("20");
  const [gutterClearanceMm, setGutterClearanceMm] = useState("300");
  const [ridgeClearanceMm, setRidgeClearanceMm] = useState("0");
  const [roofFace, setRoofFace] = useState("");
  const [roofPitchDeg, setRoofPitchDeg] = useState("30");
  const [placement, setPlacement] = useState<"centered" | "left" | "right">(
    "centered",
  );
  const [roofTopology, setRoofTopology] = useState("unknown");
  const [covering, setCovering] = useState("unknown");
  const [frameColor, setFrameColor] = useState("noir");

  useEffect(
    () => () => {
      if (resultUrl) URL.revokeObjectURL(resultUrl);
    },
    [resultUrl],
  );

  const theoreticalField = useMemo(() => {
    const width = Number(moduleWidthMm);
    const height = Number(moduleHeightMm);
    const rowCount = Number(rows);
    const columnCount = Number(columns);
    const gap = Number(panelGapMm);
    if (
      ![width, height, rowCount, columnCount, gap].every(Number.isFinite) ||
      width <= 0 ||
      height <= 0 ||
      rowCount <= 0 ||
      columnCount <= 0 ||
      gap < 0
    ) {
      return undefined;
    }
    const panelWidth = orientation === "portrait" ? width : height;
    const panelHeight = orientation === "portrait" ? height : width;
    return {
      widthMm: columnCount * panelWidth + Math.max(0, columnCount - 1) * gap,
      heightMm: rowCount * panelHeight + Math.max(0, rowCount - 1) * gap,
    };
  }, [
    columns,
    moduleHeightMm,
    moduleWidthMm,
    orientation,
    panelGapMm,
    rows,
  ]);

  const fixedLayoutValid =
    layoutMode === "automatic" ||
    Number(rows) * Number(columns) === Number(moduleCount);

  const canGenerate = Boolean(
    projectId &&
      Number(moduleWidthMm) > 0 &&
      Number(moduleHeightMm) > 0 &&
      Number(moduleCount) > 0 &&
      Number(rows) > 0 &&
      Number(columns) > 0 &&
      fixedLayoutValid,
  );

  function clearResult() {
    setResultUrl("");
    setStatusMessage("");
    setDiagnostics(EMPTY_DIAGNOSTICS);
  }

  function applyProject(project: ProjectOption) {
    const details = parsedDetails(project);
    setProjectId(project.id);
    setModuleReference(
      project.moduleReference || String(details.moduleReference ?? ""),
    );
    setModuleWidthMm(numberString(details.moduleWidthMm, "1134"));
    setModuleHeightMm(numberString(details.moduleHeightMm, "1762"));
    setModuleCount(String(project.moduleCount ?? 12));
    setRows(numberString(details.layoutRows, "2"));
    setColumns(numberString(details.layoutColumns, "6"));
    setOrientation(
      details.moduleOrientation === "landscape" ? "landscape" : "portrait",
    );
    setLayoutMode(details.layoutMode === "automatic" ? "automatic" : "fixed");
    setPanelGapMm(numberString(details.panelGapMm, "20"));
    setGutterClearanceMm(
      numberString(details.preferredGutterClearanceMm, "300"),
    );
    setRidgeClearanceMm(numberString(details.ridgeClearanceMm, "0"));
    setRoofFace(String(details.priorityRoofFaceId ?? ""));
    setRoofPitchDeg(numberString(details.roofPitchDeg, "30"));
    setRoofTopology(String(details.roofTopology ?? "unknown"));
    setCovering(String(details.coveringType ?? "unknown"));
    setFrameColor(String(details.panelColor ?? "noir"));
    clearResult();
  }

  function selectProject(value: string) {
    const project = projects.find((item) => item.id === value);
    if (project) applyProject(project);
    else setProjectId(value);
  }

  async function loadProjects() {
    if (loadingProjects || projects.length) return;
    setLoadingProjects(true);
    try {
      const response = await fetch("/api/projects", { cache: "no-store" });
      const payload = (await response.json()) as ProjectListResponse;
      if (!response.ok) {
        throw new Error(
          payload.error ?? "Impossible de charger les dossiers.",
        );
      }
      const list = payload.projects ?? [];
      setProjects(list);
      if (list[0]) applyProject(list[0]);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Impossible de charger les dossiers.",
      );
    } finally {
      setLoadingProjects(false);
    }
  }

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    if (nextOpen && !projects.length) void loadProjects();
  }

  async function generate() {
    if (!canGenerate) {
      toast.error(
        "Vérifiez la quantité, les dimensions et le calepinage du test.",
      );
      return;
    }

    setGenerating(true);
    setDiagnostics(EMPTY_DIAGNOSTICS);
    setStatusMessage(
      "Analyse du toit → géométrie IGN → projection → rendu → contrôles…",
    );

    try {
      const response = await fetch(
        `/api/projects/${projectId}/admin-image-test`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            dp: Number(dp),
            moduleReference,
            moduleWidthMm: Number(moduleWidthMm),
            moduleHeightMm: Number(moduleHeightMm),
            moduleCount: Number(moduleCount),
            rows: Number(rows),
            columns: Number(columns),
            orientation,
            layoutMode,
            panelGapMm: Number(panelGapMm),
            gutterClearanceMm: Number(gutterClearanceMm),
            ridgeClearanceMm: Number(ridgeClearanceMm),
            roofFace: roofFace.trim() || undefined,
            roofPitchDeg: Number(roofPitchDeg),
            placement,
            roofTopology,
            covering,
            frameColor,
          }),
        },
      );

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({
          error: `Erreur ${response.status}`,
        }))) as { error?: string };
        throw new Error(payload.error ?? `Erreur ${response.status}`);
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      setResultUrl(url);

      const vision = response.headers.get("X-PilotPaper-Vision");
      const geometry = response.headers.get("X-PilotPaper-Deterministic-Audit");
      const sourcePreservation = response.headers.get("X-PilotPaper-Outside-Mask");
      const aiQa = response.headers.get("X-PilotPaper-AI-QA");
      const nextDiagnostics: LabDiagnostics = {
        vision: vision === "verified" ? "verified" : "fallback",
        geometry: geometry === "passed" ? "passed" : "warning",
        sourcePreservation:
          sourcePreservation === "preserved" ? "preserved" : "changed",
        aiQa:
          aiQa === "passed" || aiQa === "warning" || aiQa === "unavailable"
            ? aiQa
            : "unavailable",
        roofConfidence: optionalNumber(
          response.headers.get("X-PilotPaper-Roof-Confidence"),
        ),
        qaScore: optionalNumber(response.headers.get("X-PilotPaper-QA-Score")),
        photorealismScore: optionalNumber(
          response.headers.get("X-PilotPaper-Photorealism-Score"),
        ),
        qaIssues:
          Number(response.headers.get("X-PilotPaper-QA-Issues") ?? "0") || 0,
        panelCount:
          response.headers.get("X-PilotPaper-Panel-Count") ?? moduleCount,
        sourceRole:
          response.headers.get("X-PilotPaper-Source-Role") ?? "inconnue",
        projection:
          response.headers.get("X-PilotPaper-Projection") ?? "inconnue",
        gutterMm: response.headers.get("X-PilotPaper-Gutter-MM") ?? "",
        ridgeMm: response.headers.get("X-PilotPaper-Ridge-MM") ?? "",
        leftMm: response.headers.get("X-PilotPaper-Left-MM") ?? "",
        rightMm: response.headers.get("X-PilotPaper-Right-MM") ?? "",
        fieldWidthMm:
          response.headers.get("X-PilotPaper-Field-Width-MM") ?? "",
        fieldHeightMm:
          response.headers.get("X-PilotPaper-Field-Height-MM") ?? "",
      };
      setDiagnostics(nextDiagnostics);
      setStatusMessage(
        `DP${dp} · ${nextDiagnostics.panelCount} panneaux · base ${nextDiagnostics.sourceRole} · ${nextDiagnostics.projection}`,
      );

      const allStrong =
        nextDiagnostics.vision === "verified" &&
        nextDiagnostics.geometry === "passed" &&
        nextDiagnostics.sourcePreservation === "preserved" &&
        nextDiagnostics.aiQa === "passed";
      if (allStrong) {
        toast.success(
          `Image test DP${dp} générée · tous les contrôles du laboratoire sont favorables.`,
        );
      } else {
        toast.warning(
          `Image test DP${dp} générée · un ou plusieurs contrôles demandent une vérification.`,
        );
      }
    } catch (error) {
      setStatusMessage("");
      setDiagnostics(EMPTY_DIAGNOSTICS);
      toast.error(
        error instanceof Error
          ? error.message
          : "Le laboratoire n'a pas pu produire l'image.",
      );
    } finally {
      setGenerating(false);
    }
  }

  const visionTone = diagnostics.vision === "verified" ? "success" : "warning";
  const geometryTone = diagnostics.geometry === "passed" ? "success" : "warning";
  const sourceTone =
    diagnostics.sourcePreservation === "preserved" ? "success" : "warning";
  const aiTone = diagnostics.aiQa === "passed" ? "success" : "warning";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button
          type="button"
          className="fixed bottom-5 right-5 z-50 rounded-2xl shadow-xl"
          size="lg"
        >
          <FlaskConical />
          Laboratoire DP
        </Button>
      </DialogTrigger>

      <DialogContent className="max-h-[94vh] max-w-6xl overflow-y-auto border-zinc-200 bg-white/95 p-0 shadow-2xl backdrop-blur-xl">
        <div className="border-b border-zinc-100 px-6 py-5 sm:px-7">
          <DialogHeader>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-zinc-950 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-white">
                Admin
              </span>
              <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-800">
                Test / non validé
              </span>
            </div>
            <DialogTitle className="pt-2 text-2xl tracking-[-0.04em]">
              Laboratoire d’insertion photovoltaïque
            </DialogTitle>
            <DialogDescription className="max-w-3xl leading-6">
              Un seul rendu DP4 ou DP6 à partir de la photo proche et de la vue
              oblique. Les vues IGN sont récupérées automatiquement. Aucun PDF ni
              autre document n’est généré.
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="grid gap-0 lg:grid-cols-[minmax(0,.92fr)_minmax(440px,1.08fr)]">
          <div className="space-y-5 border-b border-zinc-100 p-6 sm:p-7 lg:border-b-0 lg:border-r">
            <section className="space-y-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-zinc-400">
                  Configuration essentielle
                </p>
                <p className="mt-1 text-sm text-zinc-500">
                  Les valeurs du dossier sont préchargées mais restent modifiables
                  pour ce test uniquement.
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2 sm:col-span-2">
                  <Label>Dossier test</Label>
                  <Select
                    value={projectId}
                    onValueChange={selectProject}
                    disabled={loadingProjects}
                  >
                    <SelectTrigger className="h-11">
                      <SelectValue
                        placeholder={
                          loadingProjects ? "Chargement…" : "Choisir un dossier"
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {projects.map((project) => (
                        <SelectItem key={project.id} value={project.id}>
                          {project.siteAddress ||
                            `Dossier ${project.id.slice(0, 8)}`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Image à créer</Label>
                  <Select
                    value={dp}
                    onValueChange={(value) => setDp(value as "4" | "6")}
                  >
                    <SelectTrigger className="h-11">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="4">DP4 · toiture / façade</SelectItem>
                      <SelectItem value="6">DP6 · insertion réaliste</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Référence module</Label>
                  <Input
                    className="h-11"
                    value={moduleReference}
                    onChange={(event) => setModuleReference(event.target.value)}
                    placeholder="Ex. DMEGC 500 W"
                  />
                </div>

                <div className="space-y-2">
                  <Label>Largeur module (mm)</Label>
                  <Input
                    className="h-11"
                    type="number"
                    min="1"
                    value={moduleWidthMm}
                    onChange={(event) => setModuleWidthMm(event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Hauteur module (mm)</Label>
                  <Input
                    className="h-11"
                    type="number"
                    min="1"
                    value={moduleHeightMm}
                    onChange={(event) => setModuleHeightMm(event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Quantité</Label>
                  <Input
                    className="h-11"
                    type="number"
                    min="1"
                    value={moduleCount}
                    onChange={(event) => setModuleCount(event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Orientation</Label>
                  <Select
                    value={orientation}
                    onValueChange={(value) =>
                      setOrientation(value as "portrait" | "landscape")
                    }
                  >
                    <SelectTrigger className="h-11">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="portrait">Portrait</SelectItem>
                      <SelectItem value="landscape">Paysage</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Calepinage</Label>
                  <Select
                    value={layoutMode}
                    onValueChange={(value) =>
                      setLayoutMode(value as "fixed" | "automatic")
                    }
                  >
                    <SelectTrigger className="h-11">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="fixed">Matrice imposée</SelectItem>
                      <SelectItem value="automatic">Automatique</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Placement</Label>
                  <Select
                    value={placement}
                    onValueChange={(value) =>
                      setPlacement(value as "centered" | "left" | "right")
                    }
                  >
                    <SelectTrigger className="h-11">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="centered">Centré</SelectItem>
                      <SelectItem value="left">Aligné à gauche</SelectItem>
                      <SelectItem value="right">Aligné à droite</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Rangées</Label>
                  <Input
                    className="h-11"
                    type="number"
                    min="1"
                    value={rows}
                    onChange={(event) => setRows(event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Colonnes</Label>
                  <Input
                    className="h-11"
                    type="number"
                    min="1"
                    value={columns}
                    onChange={(event) => setColumns(event.target.value)}
                  />
                </div>
              </div>

              {!fixedLayoutValid && (
                <div className="flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                  En matrice imposée, rangées × colonnes doit être exactement égal
                  à la quantité demandée.
                </div>
              )}

              <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.1em] text-zinc-500">
                  <Ruler className="size-4" />
                  Champ théorique saisi
                </div>
                <p className="mt-2 text-lg font-semibold tracking-[-0.03em] text-zinc-950">
                  {theoreticalField
                    ? `${(theoreticalField.widthMm / 1000).toFixed(2)} × ${(theoreticalField.heightMm / 1000).toFixed(2)} m`
                    : "Dimensions à compléter"}
                </p>
                <p className="mt-1 text-xs text-zinc-500">
                  Avant projection dans la perspective réelle de la toiture.
                </p>
              </div>
            </section>

            <details className="group rounded-2xl border border-zinc-200 bg-white">
              <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium text-zinc-700">
                Paramètres avancés
                <span className="ml-2 text-xs font-normal text-zinc-400">
                  reculs · toiture · aspect
                </span>
              </summary>
              <div className="grid gap-3 border-t border-zinc-100 p-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Écart modules (mm)</Label>
                  <Input
                    type="number"
                    min="0"
                    value={panelGapMm}
                    onChange={(event) => setPanelGapMm(event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Recul gouttière préféré (mm)</Label>
                  <Input
                    type="number"
                    min="0"
                    value={gutterClearanceMm}
                    onChange={(event) =>
                      setGutterClearanceMm(event.target.value)
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>Recul faîtage minimum (mm)</Label>
                  <Input
                    type="number"
                    min="0"
                    value={ridgeClearanceMm}
                    onChange={(event) => setRidgeClearanceMm(event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Pente toiture (°)</Label>
                  <Input
                    type="number"
                    min="0"
                    max="75"
                    value={roofPitchDeg}
                    onChange={(event) => setRoofPitchDeg(event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Pan prioritaire</Label>
                  <Input
                    value={roofFace}
                    onChange={(event) => setRoofFace(event.target.value)}
                    placeholder="Auto · ou A, B…"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Couleur cadre / panneau</Label>
                  <Input
                    value={frameColor}
                    onChange={(event) => setFrameColor(event.target.value)}
                    placeholder="noir"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Topologie</Label>
                  <Select value={roofTopology} onValueChange={setRoofTopology}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="unknown">Détection automatique</SelectItem>
                      <SelectItem value="gable">Deux pans</SelectItem>
                      <SelectItem value="mono_pitch">Mono-pente</SelectItem>
                      <SelectItem value="hipped">Croupe / quatre pans</SelectItem>
                      <SelectItem value="flat">Toit plat</SelectItem>
                      <SelectItem value="carport">Carport</SelectItem>
                      <SelectItem value="canopy">Ombrière</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Couverture</Label>
                  <Select value={covering} onValueChange={setCovering}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="unknown">Détection automatique</SelectItem>
                      <SelectItem value="tile">Tuile</SelectItem>
                      <SelectItem value="slate">Ardoise</SelectItem>
                      <SelectItem value="steel_sheet">Bac acier</SelectItem>
                      <SelectItem value="zinc">Zinc</SelectItem>
                      <SelectItem value="membrane">Membrane</SelectItem>
                      <SelectItem value="other">Autre</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </details>

            <Button
              type="button"
              onClick={() => void generate()}
              disabled={!canGenerate || generating}
              className="h-12 w-full rounded-2xl"
            >
              {generating ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <FlaskConical />
              )}
              {generating
                ? "Génération et contrôles en cours…"
                : `Générer uniquement la DP${dp}`}
            </Button>
            <p className="text-xs leading-5 text-zinc-500">
              Une seule image est générée. Les contrôles qui suivent analysent le
              résultat sans relancer GPT Image. Le test reste toujours séparé du
              dossier administratif de production.
            </p>
          </div>

          <div className="min-h-[610px] bg-zinc-50/70 p-5 sm:p-7">
            {resultUrl ? (
              <div className="space-y-4">
                <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white p-2 shadow-sm">
                  {/* Blob URL returned by the isolated lab; Next Image optimization is not applicable here. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={resultUrl}
                    alt={`Résultat test DP${dp}`}
                    className="max-h-[56vh] w-full rounded-xl object-contain"
                  />
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.12em] text-zinc-400">
                      Diagnostic du rendu
                    </p>
                    <p className="mt-1 text-sm text-zinc-600">{statusMessage}</p>
                  </div>
                  <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-amber-800">
                    Non validé production
                  </span>
                </div>

                <div className="grid gap-2 sm:grid-cols-2">
                  <DiagnosticCard
                    icon={<Eye className="size-4" />}
                    title="Vision toiture"
                    value={
                      diagnostics.vision === "verified"
                        ? "Toiture analysée"
                        : "Vision à confirmer"
                    }
                    detail={
                      diagnostics.vision === "verified"
                        ? `Analyse stricte exploitable · confiance ${diagnostics.roofConfidence != null ? `${Math.round(diagnostics.roofConfidence * 100)} %` : "—"}`
                        : "Le moteur a utilisé une géométrie de secours. Le rendu peut être utile visuellement mais la position du pan n’est pas certifiée."
                    }
                    tone={visionTone}
                  />
                  <DiagnosticCard
                    icon={<Ruler className="size-4" />}
                    title="Géométrie"
                    value={
                      diagnostics.geometry === "passed"
                        ? "Projection cohérente"
                        : "Géométrie à examiner"
                    }
                    detail={`${diagnostics.panelCount || "—"} panneaux · homographie · aucun chevauchement attendu`}
                    tone={geometryTone}
                  />
                  <DiagnosticCard
                    icon={<ShieldCheck className="size-4" />}
                    title="Scène originale"
                    value={
                      diagnostics.sourcePreservation === "preserved"
                        ? "Hors masque préservé"
                        : "Modification détectée"
                    }
                    detail="Les pixels hors zones panneaux doivent rester identiques à la photo source."
                    tone={sourceTone}
                  />
                  <DiagnosticCard
                    icon={<Sparkles className="size-4" />}
                    title="Réalisme"
                    value={
                      diagnostics.aiQa === "passed"
                        ? "Contrôle visuel réussi"
                        : diagnostics.aiQa === "unavailable"
                          ? "Contrôle indisponible"
                          : "Rendu à améliorer"
                    }
                    detail={
                      diagnostics.photorealismScore != null
                        ? `Photoréalisme ${Math.round(diagnostics.photorealismScore * 100)} % · QA ${diagnostics.qaScore != null ? `${Math.round(diagnostics.qaScore * 100)} %` : "—"} · ${diagnostics.qaIssues} alerte(s)`
                        : `${diagnostics.qaIssues} alerte(s) · aucun score photoréaliste disponible`
                    }
                    tone={aiTone}
                  />
                </div>

                <div className="rounded-2xl border border-zinc-200 bg-white p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.1em] text-zinc-400">
                    Géométrie résolue du champ principal
                  </p>
                  <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 text-xs sm:grid-cols-3">
                    <div>
                      <span className="text-zinc-400">Champ</span>
                      <p className="mt-1 font-medium text-zinc-800">
                        {diagnostics.fieldWidthMm && diagnostics.fieldHeightMm
                          ? `${metricLabel(diagnostics.fieldWidthMm)} × ${metricLabel(diagnostics.fieldHeightMm)}`
                          : "—"}
                      </p>
                    </div>
                    <div>
                      <span className="text-zinc-400">Gouttière</span>
                      <p className="mt-1 font-medium text-zinc-800">
                        {metricLabel(diagnostics.gutterMm)}
                      </p>
                    </div>
                    <div>
                      <span className="text-zinc-400">Faîtage</span>
                      <p className="mt-1 font-medium text-zinc-800">
                        {metricLabel(diagnostics.ridgeMm)}
                      </p>
                    </div>
                    <div>
                      <span className="text-zinc-400">Marge gauche</span>
                      <p className="mt-1 font-medium text-zinc-800">
                        {metricLabel(diagnostics.leftMm)}
                      </p>
                    </div>
                    <div>
                      <span className="text-zinc-400">Marge droite</span>
                      <p className="mt-1 font-medium text-zinc-800">
                        {metricLabel(diagnostics.rightMm)}
                      </p>
                    </div>
                    <div>
                      <span className="text-zinc-400">Photo éditée</span>
                      <p className="mt-1 font-medium text-zinc-800">
                        {diagnostics.sourceRole || "—"}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex min-h-[570px] flex-col items-center justify-center gap-4 text-center text-zinc-400">
                {generating ? (
                  <LoaderCircle className="size-11 animate-spin" />
                ) : (
                  <ImageIcon className="size-11" />
                )}
                <div>
                  <p className="font-medium text-zinc-600">
                    {generating ? "PilotPaper construit le rendu…" : "Aucun test généré"}
                  </p>
                  <p className="mt-2 max-w-sm text-sm leading-6">
                    {statusMessage ||
                      "Le rendu unique et ses contrôles apparaîtront ici. Le moteur administratif principal n’est pas modifié par ce test."}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
