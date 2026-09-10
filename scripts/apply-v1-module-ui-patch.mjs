import { readFileSync, writeFileSync } from "node:fs";

const path = "app/workspace-client.tsx";
let source = readFileSync(path, "utf8");

function replaceOnce(label, from, to) {
  const count = source.split(from).length - 1;
  if (count !== 1) {
    throw new Error(`${label}: expected exactly one anchor, found ${count}`);
  }
  source = source.replace(from, to);
}

replaceOnce(
  "resolved module type",
  `type SavedProject = {`,
  `type ResolvedPvModule = {
  manufacturer: string;
  model: string;
  canonicalReference: string;
  widthMm: number;
  heightMm: number;
  thicknessMm: number;
  powerWp: number;
  sourceUrl: string;
  sourceDocument: string;
  verifiedAt: string;
};

type SavedProject = {`,
);

replaceOnce(
  "module resolver state",
  `  const [moduleCount, setModuleCount] = useState("");
  const [moduleReference, setModuleReference] = useState("");
  const [injectionMode, setInjectionMode] = useState("");`,
  `  const [moduleCount, setModuleCount] = useState("");
  const [moduleReference, setModuleReference] = useState("");
  const [resolvedModule, setResolvedModule] = useState<ResolvedPvModule | null>(null);
  const [moduleLookupState, setModuleLookupState] = useState<"idle" | "loading" | "verified" | "error">("idle");
  const [moduleLookupError, setModuleLookupError] = useState("");
  const [injectionMode, setInjectionMode] = useState("");`,
);

replaceOnce(
  "technical gate",
  `  const technicalFieldsComplete =
    Number(moduleWidthMm) > 0 && Number(moduleHeightMm) > 0 && Number(panelGapMm) >= 0 &&
    Boolean(roofColor.trim()) && Boolean(panelColor.trim()) && Boolean(mountingSystem.trim());`,
  `  const technicalFieldsComplete =
    Boolean(resolvedModule) && Number(panelGapMm) >= 0 &&
    Boolean(roofColor.trim()) && Boolean(panelColor.trim()) && Boolean(mountingSystem.trim());`,
);

replaceOnce(
  "restore module resolver",
  `    setModuleReference(project.moduleReference);
    setInjectionMode(project.injectionMode);`,
  `    setModuleReference(project.moduleReference);
    setResolvedModule(null);
    setModuleLookupState("idle");
    setModuleLookupError("");
    if (project.moduleReference) void resolveModuleReference(project.moduleReference, project.moduleCount ?? 0);
    setInjectionMode(project.injectionMode);`,
);

replaceOnce(
  "module resolver function",
  `  async function analyzeRoofFacesAndCapacity(id: string) {`,
  `  async function resolveModuleReference(reference = moduleReference, quantity = Number(moduleCount)) {
    const exactReference = reference.trim();
    if (!exactReference) {
      setResolvedModule(null);
      setModuleLookupState("error");
      setModuleLookupError("Renseignez la référence exacte indiquée sur la fiche fabricant.");
      return null;
    }

    setModuleLookupState("loading");
    setModuleLookupError("");
    try {
      const response = await fetch(\`/api/pv-modules/resolve?reference=\${encodeURIComponent(exactReference)}\`, { cache: "no-store" });
      const payload = await readJsonResponse<{ module?: ResolvedPvModule; error?: string }>(response);
      if (!response.ok || !payload.module) {
        throw new Error(payload.error ?? "Référence absente du catalogue fabricant vérifié.");
      }
      const moduleSpec = payload.module;
      setResolvedModule(moduleSpec);
      setModuleLookupState("verified");
      setModuleReference(moduleSpec.canonicalReference);
      setModuleWidthMm(String(moduleSpec.widthMm));
      setModuleHeightMm(String(moduleSpec.heightMm));
      setPowerKwp(quantity > 0 ? String((moduleSpec.powerWp * quantity) / 1000) : "");
      return moduleSpec;
    } catch (error) {
      setResolvedModule(null);
      setModuleLookupState("error");
      setModuleWidthMm("");
      setModuleHeightMm("");
      setPowerKwp("");
      setModuleLookupError(error instanceof Error ? error.message : "La fiche fabricant n'a pas pu être vérifiée.");
      return null;
    }
  }

  async function analyzeRoofFacesAndCapacity(id: string) {`,
);

replaceOnce(
  "layout payload",
  `          moduleCount: Number(moduleCount), moduleReference, moduleWidthMm: Number(moduleWidthMm), moduleHeightMm: Number(moduleHeightMm),
          panelGapMm: Number(panelGapMm),`,
  `          moduleCount: Number(moduleCount), moduleReference,
          panelGapMm: Number(panelGapMm),`,
);

replaceOnce(
  "step three validation",
  `      (!supportType ||
        !powerKwp ||
        !moduleCount ||
        !moduleReference ||
        !injectionMode ||
        !technicalFieldsComplete)`,
  `      (!supportType ||
        !moduleCount ||
        !moduleReference ||
        !resolvedModule ||
        !injectionMode ||
        !technicalFieldsComplete)`,
);

replaceOnce(
  "power read only",
  `                    <div className="space-y-2">
                      <Label htmlFor="power">Puissance totale prévue</Label>
                      <div className="unit-field">
                        <Input
                          id="power"
                          type="number"
                          min="0"
                          step="0.1"
                          value={powerKwp}
                          onChange={(event) => setPowerKwp(event.target.value)}
                          placeholder="6.0"
                        />
                        <span>kWc</span>
                      </div>
                    </div>`,
  `                    <div className="space-y-2">
                      <Label>Puissance totale calculée</Label>
                      <div className="flex h-12 items-center rounded-xl border border-zinc-200 bg-zinc-50 px-4 text-sm font-medium text-zinc-700">
                        {resolvedModule && powerKwp
                          ? \`\${powerKwp} kWc · \${resolvedModule.powerWp} W/module\`
                          : "Calculée automatiquement depuis la référence et la quantité"}
                      </div>
                    </div>`,
);

replaceOnce(
  "module count derives power",
  `                        onChange={(event) =>
                          setModuleCount(event.target.value)
                        }`,
  `                        onChange={(event) => {
                          const value = event.target.value;
                          setModuleCount(value);
                          setPowerKwp(resolvedModule && Number(value) > 0
                            ? String((resolvedModule.powerWp * Number(value)) / 1000)
                            : "");
                        }`,
);

replaceOnce(
  "reference resolution",
  `                        onChange={(event) =>
                          setModuleReference(event.target.value)
                        }
                        placeholder="Marque + modèle"`,
  `                        onChange={(event) => {
                          setModuleReference(event.target.value);
                          setResolvedModule(null);
                          setModuleLookupState("idle");
                          setModuleLookupError("");
                          setModuleWidthMm("");
                          setModuleHeightMm("");
                          setPowerKwp("");
                        }}
                        onBlur={() => {
                          if (moduleReference.trim()) void resolveModuleReference(moduleReference, Number(moduleCount));
                        }}
                        placeholder="Ex. TSM-450NEG9R.28"`,
);

replaceOnce(
  "manufacturer verification display",
  `                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-2">
                        <Label htmlFor="module-width">Largeur module</Label>
                        <div className="unit-field">
                          <Input id="module-width" type="number" min="1" value={moduleWidthMm} onChange={(event) => setModuleWidthMm(event.target.value)} placeholder="1134" />
                          <span>mm</span>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="module-height">Hauteur module</Label>
                        <div className="unit-field">
                          <Input id="module-height" type="number" min="1" value={moduleHeightMm} onChange={(event) => setModuleHeightMm(event.target.value)} placeholder="1762" />
                          <span>mm</span>
                        </div>
                      </div>
                    </div>`,
  `                    <div className="space-y-3 sm:col-span-2 rounded-2xl border border-zinc-200 bg-zinc-50/70 p-4">
                      <div className="flex items-center gap-2 text-sm font-medium text-zinc-800">
                        {moduleLookupState === "loading" ? <LoaderCircle className="size-4 animate-spin" /> : resolvedModule ? <BadgeCheck className="size-4 text-emerald-600" /> : <Database className="size-4 text-zinc-400" />}
                        Fiche module fabricant
                      </div>
                      {resolvedModule ? (
                        <div className="grid gap-2 text-xs text-zinc-600 sm:grid-cols-3">
                          <span><strong className="block text-zinc-900">{resolvedModule.manufacturer}</strong>{resolvedModule.canonicalReference}</span>
                          <span><strong className="block text-zinc-900">Dimensions réelles</strong>{resolvedModule.widthMm} × {resolvedModule.heightMm} × {resolvedModule.thicknessMm} mm</span>
                          <span><strong className="block text-zinc-900">Puissance nominale</strong>{resolvedModule.powerWp} W</span>
                          <a href={resolvedModule.sourceUrl} target="_blank" rel="noreferrer" className="sm:col-span-3 underline underline-offset-2">
                            Source fabricant vérifiée · {resolvedModule.sourceDocument}
                          </a>
                        </div>
                      ) : (
                        <p className={moduleLookupState === "error" ? "text-xs text-red-600" : "text-xs text-zinc-500"}>
                          {moduleLookupError || "Saisissez la référence exacte : PilotPaper récupère largeur, hauteur et puissance sans les déduire de la puissance totale."}
                        </p>
                      )}
                    </div>`,
);

replaceOnce(
  "layout analyze guard",
  `                        <Button type="button" variant="outline" disabled={!projectId || isCheckingLayout || !moduleCount || !moduleWidthMm || !moduleHeightMm} onClick={() => projectId && analyzeRoofFacesAndCapacity(projectId)}>{isCheckingLayout ? "Analyse…" : "Analyser les pans"}</Button>`,
  `                        <Button type="button" variant="outline" disabled={!projectId || isCheckingLayout || !moduleCount || !resolvedModule} onClick={() => projectId && analyzeRoofFacesAndCapacity(projectId)}>{isCheckingLayout ? "Analyse…" : "Analyser les pans"}</Button>`,
);

replaceOnce(
  "step three copy",
  `                      Les valeurs ci-dessous alimentent les contrôles de géométrie
                      et la notice. Elles seront progressivement préremplies par
                      le moteur local, mais aucune cote ne sera inventée.`,
  `                      Saisissez la quantité et la référence exacte du module. PilotPaper
                      vérifie sa fiche fabricant puis utilise automatiquement ses dimensions
                      et sa puissance réelles ; aucune cote panneau n'est inventée.`,
);

writeFileSync(path, source);
console.log("PilotPaper V1 module UI patch applied successfully.");
