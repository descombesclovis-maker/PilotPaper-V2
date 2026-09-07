"use client";

import { useEffect, useMemo, useState } from "react";
import { FlaskConical, ImageIcon, LoaderCircle, TriangleAlert } from "lucide-react";
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

type ProjectListResponse = { projects?: ProjectOption[]; error?: string };

type StoredDetails = Record<string, unknown>;

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

export function AdminDpImageLab() {
  const [open, setOpen] = useState(false);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [projectId, setProjectId] = useState("");
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [resultUrl, setResultUrl] = useState("");
  const [resultMeta, setResultMeta] = useState("");

  const [dp, setDp] = useState<"4" | "6">("6");
  const [moduleReference, setModuleReference] = useState("");
  const [moduleWidthMm, setModuleWidthMm] = useState("1134");
  const [moduleHeightMm, setModuleHeightMm] = useState("1762");
  const [moduleCount, setModuleCount] = useState("12");
  const [rows, setRows] = useState("2");
  const [columns, setColumns] = useState("6");
  const [orientation, setOrientation] = useState<"portrait" | "landscape">("portrait");
  const [layoutMode, setLayoutMode] = useState<"fixed" | "automatic">("fixed");
  const [panelGapMm, setPanelGapMm] = useState("20");
  const [gutterClearanceMm, setGutterClearanceMm] = useState("300");
  const [ridgeClearanceMm, setRidgeClearanceMm] = useState("0");
  const [roofFace, setRoofFace] = useState("");
  const [roofPitchDeg, setRoofPitchDeg] = useState("30");
  const [placement, setPlacement] = useState<"centered" | "left" | "right">("centered");
  const [roofTopology, setRoofTopology] = useState("unknown");
  const [covering, setCovering] = useState("unknown");
  const [frameColor, setFrameColor] = useState("noir");

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === projectId),
    [projectId, projects],
  );

  useEffect(() => {
    if (!open || projects.length || loadingProjects) return;
    setLoadingProjects(true);
    fetch("/api/projects", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json() as ProjectListResponse;
        if (!response.ok) throw new Error(payload.error ?? "Impossible de charger les dossiers.");
        const list = payload.projects ?? [];
        setProjects(list);
        if (list[0]) setProjectId(list[0].id);
      })
      .catch((error) => toast.error(error instanceof Error ? error.message : "Impossible de charger les dossiers."))
      .finally(() => setLoadingProjects(false));
  }, [open, projects.length, loadingProjects]);

  useEffect(() => {
    if (!selectedProject) return;
    const details = parsedDetails(selectedProject);
    setModuleReference(selectedProject.moduleReference || String(details.moduleReference ?? ""));
    setModuleWidthMm(numberString(details.moduleWidthMm, "1134"));
    setModuleHeightMm(numberString(details.moduleHeightMm, "1762"));
    setModuleCount(String(selectedProject.moduleCount ?? 12));
    setRows(numberString(details.layoutRows, "2"));
    setColumns(numberString(details.layoutColumns, "6"));
    setOrientation(details.moduleOrientation === "landscape" ? "landscape" : "portrait");
    setLayoutMode(details.layoutMode === "automatic" ? "automatic" : "fixed");
    setPanelGapMm(numberString(details.panelGapMm, "20"));
    setGutterClearanceMm(numberString(details.preferredGutterClearanceMm, "300"));
    setRidgeClearanceMm(numberString(details.ridgeClearanceMm, "0"));
    setRoofFace(String(details.priorityRoofFaceId ?? ""));
    setRoofPitchDeg(numberString(details.roofPitchDeg, "30"));
    setRoofTopology(String(details.roofTopology ?? "unknown"));
    setCovering(String(details.coveringType ?? "unknown"));
    setFrameColor(String(details.panelColor ?? "noir"));
    setResultUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return "";
    });
    setResultMeta("");
  }, [selectedProject]);

  useEffect(() => () => {
    if (resultUrl) URL.revokeObjectURL(resultUrl);
  }, [resultUrl]);

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

  async function generate() {
    if (!canGenerate) {
      toast.error("Vérifiez la quantité, les dimensions et le calepinage du test.");
      return;
    }
    setGenerating(true);
    setResultMeta("Analyse des 2 photos + géométrie IGN + projection déterministe…");
    try {
      const response = await fetch(`/api/projects/${projectId}/admin-image-test`, {
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
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({ error: `Erreur ${response.status}` })) as { error?: string };
        throw new Error(payload.error ?? `Erreur ${response.status}`);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      setResultUrl((current) => {
        if (current) URL.revokeObjectURL(current);
        return url;
      });
      const sourceRole = response.headers.get("X-PilotPaper-Source-Role") ?? "inconnue";
      const confidence = response.headers.get("X-PilotPaper-Roof-Confidence") ?? "?";
      const count = response.headers.get("X-PilotPaper-Panel-Count") ?? moduleCount;
      setResultMeta(`DP${dp} · ${count} panneaux · base ${sourceRole} · confiance toiture ${confidence}`);
      toast.success(`Image test DP${dp} générée.`);
    } catch (error) {
      setResultMeta("");
      toast.error(error instanceof Error ? error.message : "Le laboratoire n'a pas pu produire l'image.");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
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
      <DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Laboratoire Admin · insertion photovoltaïque</DialogTitle>
          <DialogDescription>
            Test isolé : photo proche + photo oblique uniquement. PilotPaper récupère l’IGN automatiquement et ne génère qu’une seule image DP4 ou DP6. Aucun PDF ni dossier complet n’est produit.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(340px,.85fr)]">
          <div className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <Label>Dossier test</Label>
                <Select value={projectId} onValueChange={setProjectId} disabled={loadingProjects}>
                  <SelectTrigger><SelectValue placeholder={loadingProjects ? "Chargement…" : "Choisir un dossier"} /></SelectTrigger>
                  <SelectContent>
                    {projects.map((project) => (
                      <SelectItem key={project.id} value={project.id}>
                        {project.siteAddress || `Dossier ${project.id.slice(0, 8)}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Pièce à tester</Label>
                <Select value={dp} onValueChange={(value) => setDp(value as "4" | "6")}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="4">DP4 · représentation toiture/façade</SelectItem>
                    <SelectItem value="6">DP6 · insertion photoréaliste</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Référence module</Label>
                <Input value={moduleReference} onChange={(event) => setModuleReference(event.target.value)} placeholder="Ex. DMEGC 500 W" />
              </div>

              <div className="space-y-2"><Label>Largeur module (mm)</Label><Input type="number" min="1" value={moduleWidthMm} onChange={(event) => setModuleWidthMm(event.target.value)} /></div>
              <div className="space-y-2"><Label>Hauteur module (mm)</Label><Input type="number" min="1" value={moduleHeightMm} onChange={(event) => setModuleHeightMm(event.target.value)} /></div>
              <div className="space-y-2"><Label>Quantité</Label><Input type="number" min="1" value={moduleCount} onChange={(event) => setModuleCount(event.target.value)} /></div>
              <div className="space-y-2"><Label>Orientation</Label><Select value={orientation} onValueChange={(value) => setOrientation(value as "portrait" | "landscape")}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="portrait">Portrait</SelectItem><SelectItem value="landscape">Paysage</SelectItem></SelectContent></Select></div>

              <div className="space-y-2"><Label>Mode calepinage</Label><Select value={layoutMode} onValueChange={(value) => setLayoutMode(value as "fixed" | "automatic")}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="fixed">Matrice imposée</SelectItem><SelectItem value="automatic">Placement automatique</SelectItem></SelectContent></Select></div>
              <div className="space-y-2"><Label>Placement</Label><Select value={placement} onValueChange={(value) => setPlacement(value as "centered" | "left" | "right")}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="centered">Centré</SelectItem><SelectItem value="left">Aligné gauche</SelectItem><SelectItem value="right">Aligné droite</SelectItem></SelectContent></Select></div>
              <div className="space-y-2"><Label>Rangées</Label><Input type="number" min="1" value={rows} onChange={(event) => setRows(event.target.value)} /></div>
              <div className="space-y-2"><Label>Colonnes</Label><Input type="number" min="1" value={columns} onChange={(event) => setColumns(event.target.value)} /></div>

              {!fixedLayoutValid && (
                <div className="sm:col-span-2 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                  En mode matrice imposée, rangées × colonnes doit être égal à la quantité.
                </div>
              )}

              <div className="space-y-2"><Label>Écart modules (mm)</Label><Input type="number" min="0" value={panelGapMm} onChange={(event) => setPanelGapMm(event.target.value)} /></div>
              <div className="space-y-2"><Label>Recul gouttière préféré (mm)</Label><Input type="number" min="0" value={gutterClearanceMm} onChange={(event) => setGutterClearanceMm(event.target.value)} /></div>
              <div className="space-y-2"><Label>Recul faîtage (mm)</Label><Input type="number" min="0" value={ridgeClearanceMm} onChange={(event) => setRidgeClearanceMm(event.target.value)} /></div>
              <div className="space-y-2"><Label>Pente toiture (°)</Label><Input type="number" min="0" max="75" value={roofPitchDeg} onChange={(event) => setRoofPitchDeg(event.target.value)} /></div>
              <div className="space-y-2"><Label>Pan prioritaire (facultatif)</Label><Input value={roofFace} onChange={(event) => setRoofFace(event.target.value)} placeholder="Ex. A" /></div>
              <div className="space-y-2"><Label>Couleur cadre/panneau</Label><Input value={frameColor} onChange={(event) => setFrameColor(event.target.value)} placeholder="noir" /></div>

              <div className="space-y-2"><Label>Topologie</Label><Select value={roofTopology} onValueChange={setRoofTopology}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="unknown">Détection automatique</SelectItem><SelectItem value="gable">Deux pans</SelectItem><SelectItem value="mono_pitch">Mono-pente</SelectItem><SelectItem value="hipped">Croupe / quatre pans</SelectItem><SelectItem value="flat">Toit plat</SelectItem><SelectItem value="carport">Carport</SelectItem><SelectItem value="canopy">Ombrière</SelectItem></SelectContent></Select></div>
              <div className="space-y-2"><Label>Couverture</Label><Select value={covering} onValueChange={setCovering}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="unknown">Détection automatique</SelectItem><SelectItem value="tile">Tuile</SelectItem><SelectItem value="slate">Ardoise</SelectItem><SelectItem value="steel_sheet">Bac acier</SelectItem><SelectItem value="zinc">Zinc</SelectItem><SelectItem value="membrane">Membrane</SelectItem><SelectItem value="other">Autre</SelectItem></SelectContent></Select></div>
            </div>

            <Button type="button" onClick={() => void generate()} disabled={!canGenerate || generating} className="w-full">
              {generating ? <LoaderCircle className="animate-spin" /> : <FlaskConical />}
              {generating ? "Analyse + génération en cours…" : `Générer uniquement la DP${dp}`}
            </Button>
            <p className="text-xs leading-5 text-zinc-500">
              Le test est sauvegardé séparément comme TEST / NON VALIDÉ. Il ne modifie pas les DP du dossier et ne remplace aucune source originale.
            </p>
          </div>

          <div className="min-h-[420px] rounded-2xl border bg-zinc-50 p-4">
            {resultUrl ? (
              <div className="space-y-3">
                <img src={resultUrl} alt={`Résultat test DP${dp}`} className="max-h-[68vh] w-full rounded-xl object-contain shadow-sm" />
                <p className="text-xs text-zinc-500">{resultMeta}</p>
              </div>
            ) : (
              <div className="flex min-h-[390px] flex-col items-center justify-center gap-3 text-center text-zinc-400">
                <ImageIcon className="size-10" />
                <p className="max-w-xs text-sm">Le rendu unique apparaîtra ici. Aucune DP supplémentaire ne sera générée.</p>
                {resultMeta && <p className="text-xs">{resultMeta}</p>}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
