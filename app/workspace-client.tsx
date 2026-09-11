"use client";

import { type CSSProperties, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  Building2,
  CheckCircle2,
  CircleDashed,
  Clock3,
  Cpu,
  Database,
  Download,
  FileCheck2,
  FileStack,
  FileText,
  Gauge,
  LayoutDashboard,
  LoaderCircle,
  LockKeyhole,
  MapPin,
  PanelRightOpen,
  Plus,
  Ruler,
  ScanLine,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  UploadCloud,
  X,
  XCircle,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Textarea } from "@/components/ui/textarea";
import { Toaster } from "@/components/ui/sonner";
import {
  GenerateDeclarationLabel,
  PilotPaperMark,
  PilotPaperWordmark,
} from "@/components/pilotpaper-brand";
import {
  calculateCompletion,
  evaluateDpPieces,
  type DpStatus,
} from "@/lib/dp-engine";
import { formatSiret } from "@/lib/siret";
import {
  formatFrenchVat,
  normalizeFrenchVat,
  validateFrenchVat,
} from "@/lib/vat";

async function readJsonResponse<T>(response: Response): Promise<T> {
  if (response.status === 413) {
    throw new Error("La photo préparée dépasse encore la limite technique de transfert. PilotPaper doit normalement la réduire automatiquement ; réessayez ou exportez la même image dans un format standard sans la recadrer.");
  }
  const body = await response.text();
  if (!body.trim()) {
    throw new Error(
      response.ok
        ? "Le serveur a renvoyé une réponse vide."
        : `Le serveur local a échoué (${response.status}). Redémarrez PilotPaper puis réessayez.`,
    );
  }
  try {
    return JSON.parse(body) as T;
  } catch {
    throw new Error("La réponse du serveur local est invalide. Redémarrez PilotPaper puis réessayez.");
  }
}

type DecodedPhoto = {
  source: CanvasImageSource;
  width: number;
  height: number;
  close: () => void;
};

async function decodePhoto(file: File): Promise<DecodedPhoto> {
  // Prefer ImageBitmap because it honors EXIF orientation and decodes off the main DOM path.
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
  } catch {
    // Browser fallback: useful for image formats supported by Chromium/Windows but not ImageBitmap.
    const objectUrl = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.decoding = "async";
      image.src = objectUrl;
      await image.decode();
      if (!image.naturalWidth || !image.naturalHeight) throw new Error("dimensions absentes");
      return { source: image, width: image.naturalWidth, height: image.naturalHeight, close: () => URL.revokeObjectURL(objectUrl) };
    } catch {
      URL.revokeObjectURL(objectUrl);
      throw new Error(
        "Cette image ne peut pas être décodée sur ce PC. PilotPaper accepte tout format image que le navigateur peut lire et le convertit automatiquement en PNG. Pour un format RAW/HEIC/TIFF non décodable par Windows, exportez simplement la photo en JPEG, PNG, WebP ou AVIF sans la recadrer.",
      );
    }
  }
}

async function canvasPng(source: CanvasImageSource, width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("La photo ne peut pas être préparée par le navigateur.");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(source, 0, 0, width, height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("La normalisation PNG de la photo a échoué.");
  return blob;
}

async function optimizePhotoForUpload(file: File) {
  const decoded = await decodePhoto(file);
  try {
    const sourceLong = Math.max(decoded.width, decoded.height);
    const sourceShort = Math.min(decoded.width, decoded.height);
    const sourcePixels = decoded.width * decoded.height;

    // Only block photos whose native information is already too weak for a defensible visual check.
    // We deliberately do NOT upscale them: fake pixels must never be mistaken for evidence.
    if (sourceLong < 560 || sourceShort < 320 || sourcePixels < 220_000) {
      throw new Error(
        `Photo lisible mais résolution native insuffisante (${decoded.width}×${decoded.height} px). ` +
          "Elle risquerait de masquer des rives, obstacles ou défauts de perspective et donc de compromettre la conformité de la génération.",
      );
    }

    // Keep as much native detail as possible. Very large originals are progressively reduced only
    // until the normalized PNG is safe to upload. No crop, no aspect-ratio change, no artificial upscale.
    const MAX_LONG_SIDE = 4096;
    const TARGET_BYTES = 8 * 1024 * 1024;
    const HARD_BYTES = 18 * 1024 * 1024;
    const nativeScale = Math.min(1, MAX_LONG_SIDE / sourceLong);
    let width = Math.max(1, Math.round(decoded.width * nativeScale));
    let height = Math.max(1, Math.round(decoded.height * nativeScale));
    let blob = await canvasPng(decoded.source, width, height);

    for (let attempt = 0; blob.size > TARGET_BYTES && attempt < 8; attempt += 1) {
      // Estimate the next scale from byte ratio, then leave a safety margin.
      const suggestedScale = Math.min(0.92, Math.max(0.68, Math.sqrt(TARGET_BYTES / blob.size) * 0.94));
      const conformityFloorScale = Math.max(560 / width, 320 / height);
      const scale = Math.min(1, Math.max(suggestedScale, conformityFloorScale));
      const nextWidth = Math.max(1, Math.round(width * scale));
      const nextHeight = Math.max(1, Math.round(height * scale));
      if (nextWidth === width && nextHeight === height) break;
      width = nextWidth;
      height = nextHeight;
      blob = await canvasPng(decoded.source, width, height);
    }

    if (blob.size > HARD_BYTES) {
      throw new Error(
        "PilotPaper ne peut pas réduire cette image sous la limite technique sans perdre trop de détails utiles au contrôle du toit. " +
          "Utilisez une exportation de la même photo (sans recadrage) plutôt qu'une autre prise de vue.",
      );
    }

    const baseName = file.name.replace(/\.[^.]+$/, "") || "photo";
    return new File([blob], `${baseName}-pilotpaper.png`, { type: "image/png", lastModified: Date.now() });
  } finally {
    decoded.close();
  }
}

type EstablishmentOption = {
  siret: string;
  address: string;
  ape: string | null;
  active: boolean;
  isHeadOffice: boolean;
};

type Company = {
  vat: string;
  siret: string;
  siren: string;
  name: string;
  address: string;
  ape: string | null;
  legalFormCode: string | null;
  createdAt: string | null;
  active: boolean;
  establishments: EstablishmentOption[];
  source: string;
  checkedAt: string;
};

type WorkspaceClientProps = {
  currentUser: {
    displayName: string;
    email: string | null;
  };
};

type UrbanismContext = {
  status: "verified-source" | "ambiguous" | "unavailable";
  documentId?: string;
  documentType?: string;
  documentName?: string;
  documentTimestamp?: string;
  zone?: string;
  zoneLabel?: string;
  ruleFile?: string;
  ruleSourceUrl?: string;
  supCategories?: string[];
  protectedArea?: boolean;
  protectedCategories?: string[];
  authorityReviewRequired?: boolean;
  prescriptionCount?: number;
  informationCount?: number;
  checkedAt?: string;
  source?: string;
};

type OfficialSiteDetails = {
  longitude: string;
  latitude: string;
  cityCode: string;
  postcode: string;
  municipality: string;
  checkedAt: string;
  source: string;
  satelliteSourceUrl: string;
  satelliteMetersPerPixel: string;
  satelliteGeneratedAt: string;
  satelliteMassSourceUrl: string;
  satelliteMassMetersPerPixel: string;
  satelliteMassGeneratedAt: string;
};

type ResolvedPvModule = {
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

type SavedProject = {
  id: string;
  status: string;
  currentStep: number;
  requesterKind: "company" | "person";
  requesterVat: string;
  requesterSiret: string;
  requesterSiren: string;
  requesterName: string;
  requesterFirstName: string;
  requesterLastName: string;
  requesterAddress: string;
  requesterApe: string | null;
  requesterSource: string;
  requesterVerifiedAt: string;
  siteAddress: string;
  supportType: string;
  powerKwp: string;
  moduleCount: number | null;
  moduleReference: string;
  injectionMode: string;
  formData: string;
  validationData: string;
  createdAt: string;
  updatedAt: string;
};

const steps = [
  { id: 1, label: "Demandeur", icon: Building2 },
  { id: 2, label: "Site", icon: MapPin },
  { id: 3, label: "Installation", icon: Zap },
  { id: 4, label: "Photos", icon: FileStack },
  { id: 5, label: "Contrôle", icon: ShieldCheck },
];

const sourceSlots = [
  {
    id: "near",
    label: "Vue proche",
    hint: "Maison et toiture visibles depuis la voie publique",
    accept: "image/*,.heic,.heif,.avif,.webp,.bmp,.gif,.tif,.tiff",
  },
  {
    id: "roof",
    label: "Vue oblique de la toiture",
    hint: "Toiture visible en biais pour lire la pente, les rives et les obstacles",
    accept: "image/*,.heic,.heif,.avif,.webp,.bmp,.gif,.tif,.tiff",
  },
  {
    id: "far",
    label: "Vue lointaine",
    hint: "Maison replacée dans son environnement",
    accept: "image/*,.heic,.heif,.avif,.webp,.bmp,.gif,.tif,.tiff",
  },
];

const statusMeta: Record<
  DpStatus,
  { label: string; className: string; icon: typeof CheckCircle2 }
> = {
  blocked: {
    label: "Bloqué",
    className: "state-blocked",
    icon: XCircle,
  },
  incomplete: {
    label: "Incomplet",
    className: "state-incomplete",
    icon: TriangleAlert,
  },
  "ready-review": {
    label: "Prêt au contrôle IA",
    className: "state-review",
    icon: Clock3,
  },
  verified: {
    label: "Conforme démontré",
    className: "state-verified",
    icon: BadgeCheck,
  },
  "not-required": {
    label: "A priori non requis",
    className: "state-neutral",
    icon: CircleDashed,
  },
};

function initials(value: string) {
  return value
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function parseStoredRecord(value: string | undefined) {
  try {
    return JSON.parse(value ?? "{}") as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function WorkspaceClient({ currentUser }: WorkspaceClientProps) {
  const [activeStep, setActiveStep] = useState(1);
  const [vatInput, setVatInput] = useState("");
  const [company, setCompany] = useState<Company | null>(null);
  const [companyConfirmed, setCompanyConfirmed] = useState(false);
  const [selectedSiret, setSelectedSiret] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [personAddress, setPersonAddress] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [birthCity, setBirthCity] = useState("");
  const [birthDepartment, setBirthDepartment] = useState("");
  const [birthCountry, setBirthCountry] = useState("France");
  const [representativeFirstName, setRepresentativeFirstName] = useState("");
  const [representativeLastName, setRepresentativeLastName] = useState("");
  const [lookupState, setLookupState] = useState<
    "idle" | "loading" | "success" | "error"
  >("idle");
  const [lookupError, setLookupError] = useState("");
  const [sameAddress, setSameAddress] = useState<boolean | null>(null);
  const [siteAddress, setSiteAddress] = useState("");
  const [supportType, setSupportType] = useState("");
  const [powerKwp, setPowerKwp] = useState("");
  const [moduleCount, setModuleCount] = useState("");
  const [moduleReference, setModuleReference] = useState("");
  const [resolvedModule, setResolvedModule] = useState<ResolvedPvModule | null>(null);
  const [moduleLookupState, setModuleLookupState] = useState<"idle" | "loading" | "verified" | "error">("idle");
  const [moduleLookupError, setModuleLookupError] = useState("");
  const [injectionMode, setInjectionMode] = useState("");
  const [cadastralReference, setCadastralReference] = useState("");
  const [parcelAreaM2, setParcelAreaM2] = useState("");
  const [parcelGeometry, setParcelGeometry] = useState("");
  const [urbanismContext, setUrbanismContext] = useState<UrbanismContext | null>(null);
  const [officialSiteDetails, setOfficialSiteDetails] = useState<OfficialSiteDetails>({
    longitude: "", latitude: "", cityCode: "", postcode: "", municipality: "", checkedAt: "", source: "", satelliteSourceUrl: "", satelliteMetersPerPixel: "", satelliteGeneratedAt: "", satelliteMassSourceUrl: "", satelliteMassMetersPerPixel: "", satelliteMassGeneratedAt: "",
  });
  const [moduleWidthMm, setModuleWidthMm] = useState("");
  const [moduleHeightMm, setModuleHeightMm] = useState("");
  const [panelGapMm, setPanelGapMm] = useState("20");
  const [referenceLengthMm, setReferenceLengthMm] = useState("");
  const [referenceDescription, setReferenceDescription] = useState("");
  const [layoutRows, setLayoutRows] = useState("");
  const [layoutColumns, setLayoutColumns] = useState("");
  const [roofPitchDeg, setRoofPitchDeg] = useState("");
  const [roofOrientation, setRoofOrientation] = useState("");
  const [roofColor, setRoofColor] = useState("");
  const [panelColor, setPanelColor] = useState("");
  const [mountingSystem, setMountingSystem] = useState("");
  const [moduleOrientation, setModuleOrientation] = useState<"portrait" | "landscape">("portrait");
  const [layoutMode, setLayoutMode] = useState<"fixed" | "automatic">("fixed");
  const [preferredGutterClearanceMm, setPreferredGutterClearanceMm] = useState("300");
  const [roofSelectionMode, setRoofSelectionMode] = useState<"automatic" | "priority">("automatic");
  const [priorityRoofFaceId, setPriorityRoofFaceId] = useState("");
  const [roofTopology, setRoofTopology] = useState("unknown");
  const [coveringType, setCoveringType] = useState("unknown");
  const [detectedRoofFaces, setDetectedRoofFaces] = useState<Array<{ id: string; label?: string; widthMm?: number; slopeLengthMm?: number }>>([]);
  const [isCheckingLayout, setIsCheckingLayout] = useState(false);
  const [roofFacesJson, setRoofFacesJson] = useState("");
  const [layoutCheckMessage, setLayoutCheckMessage] = useState("");
  const [projectDescription, setProjectDescription] = useState("");
  const [finalAttestation, setFinalAttestation] = useState(false);
  const [photos, setPhotos] = useState<Record<string, string>>({});
  const [projectId, setProjectId] = useState<string | null>(null);
  const [recentProjects, setRecentProjects] = useState<SavedProject[]>([]);
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState<string | null>(null);
  const [rightPanelOpen, setRightPanelOpen] = useState(false);
  const [localAiState, setLocalAiState] = useState<"checking" | "online" | "offline">("checking");

  const isCompanyMode = vatInput.length > 0;
  const personIsComplete =
    firstName.trim().length > 1 &&
    lastName.trim().length > 1 &&
    personAddress.trim().length > 5 &&
    Boolean(birthDate) &&
    birthCity.trim().length > 1 &&
    birthDepartment.trim().length > 0 &&
    birthCountry.trim().length > 1;
  const identityVerified = isCompanyMode
    ? Boolean(
        company?.active &&
        companyConfirmed &&
        representativeFirstName.trim().length > 1 &&
        representativeLastName.trim().length > 1,
      )
    : personIsComplete;
  const requesterAddress = isCompanyMode
    ? company?.address ?? ""
    : personAddress.trim();
  const identityLabel =
    lookupState === "error"
      ? "Vérification impossible"
      : identityVerified
        ? "Identité vérifiée"
        : "À compléter";

  const engineInput = useMemo(
    () => ({
      requesterVerified: identityVerified,
      siteAddress,
      supportType,
      powerKwp,
      moduleCount,
      moduleReference,
      photos,
      finalAttestation,
    }),
    [
      identityVerified,
      moduleCount,
      moduleReference,
      photos,
      finalAttestation,
      powerKwp,
      siteAddress,
      supportType,
    ],
  );

  const dpPieces = useMemo(() => evaluateDpPieces(engineInput), [engineInput]);
  const completion = useMemo(
    () => calculateCompletion(engineInput),
    [engineInput],
  );
  const blockedCount = dpPieces.filter(
    (piece) => piece.status === "blocked",
  ).length;
  const automaticProjectDescription = useMemo(() => {
    const supportLabels: Record<string, string> = {
      roof: "toiture existante",
      facade: "façade existante",
      ground: "installation au sol",
      carport: "ombrière ou carport",
    };
    const support = supportLabels[supportType] ?? "support photovoltaïque";
    const modules = moduleCount || "nombre à confirmer de";
    const reference = moduleReference.trim() || "de référence à confirmer";
    const power = powerKwp ? `, pour une puissance totale de ${powerKwp} kWc` : "";
    return `Installation de ${modules} modules photovoltaïques ${reference}${power} sur ${support}.`;
  }, [moduleCount, moduleReference, powerKwp, supportType]);
  const technicalFormData = useMemo(
    () => ({
      cadastralReference,
      parcelAreaM2,
      parcelGeometry,
      birthDate,
      birthCity,
      birthDepartment,
      birthCountry,
      representativeFirstName,
      representativeLastName,
      companyLegalFormCode: company?.legalFormCode ?? "",
      moduleWidthMm,
      moduleHeightMm,
      panelGapMm,
      referenceLengthMm,
      referenceDescription,
      layoutRows,
      layoutColumns,
      roofPitchDeg,
      roofOrientation,
      roofColor,
      panelColor,
      mountingSystem,
      moduleOrientation,
      layoutMode,
      preferredGutterClearanceMm,
      roofSelectionMode,
      priorityRoofFaceId,
      roofTopology,
      coveringType,
      roofFacesJson,
      projectDescription: projectDescription.trim() || automaticProjectDescription,
      urbanismDocumentId: urbanismContext?.documentId ?? "",
      urbanismDocumentType: urbanismContext?.documentType ?? "",
      urbanismDocumentName: urbanismContext?.documentName ?? "",
      urbanismDocumentTimestamp: urbanismContext?.documentTimestamp ?? "",
      urbanismZone: urbanismContext?.zone ?? "",
      urbanismZoneLabel: urbanismContext?.zoneLabel ?? "",
      urbanismRuleFile: urbanismContext?.ruleFile ?? "",
      urbanismRuleSourceUrl: urbanismContext?.ruleSourceUrl ?? "",
      urbanismSupCategories: (urbanismContext?.supCategories ?? []).join(","),
      urbanismProtectedArea: String(urbanismContext?.protectedArea ?? false),
      urbanismAuthorityReviewRequired: String(urbanismContext?.authorityReviewRequired ?? false),
      urbanismPrescriptionCount: String(urbanismContext?.prescriptionCount ?? 0),
      urbanismInformationCount: String(urbanismContext?.informationCount ?? 0),
      urbanismCheckedAt: urbanismContext?.checkedAt ?? "",
      urbanismSource: urbanismContext?.source ?? "",
      siteLongitude: officialSiteDetails.longitude,
      siteLatitude: officialSiteDetails.latitude,
      cityCode: officialSiteDetails.cityCode,
      postcode: officialSiteDetails.postcode,
      municipality: officialSiteDetails.municipality,
      siteContextCheckedAt: officialSiteDetails.checkedAt,
      siteContextSource: officialSiteDetails.source,
      satelliteAutoGenerated: String(Boolean(officialSiteDetails.satelliteSourceUrl)),
      satelliteSourceUrl: officialSiteDetails.satelliteSourceUrl,
      satelliteMetersPerPixel: officialSiteDetails.satelliteMetersPerPixel,
      satelliteGeneratedAt: officialSiteDetails.satelliteGeneratedAt,
      satelliteMassSourceUrl: officialSiteDetails.satelliteMassSourceUrl,
      satelliteMassMetersPerPixel: officialSiteDetails.satelliteMassMetersPerPixel,
      satelliteMassGeneratedAt: officialSiteDetails.satelliteMassGeneratedAt,
    }),
    [
      cadastralReference,
      parcelAreaM2,
      parcelGeometry,
      birthDate,
      birthCity,
      birthDepartment,
      birthCountry,
      representativeFirstName,
      representativeLastName,
      company?.legalFormCode,
      layoutColumns,
      layoutRows,
      moduleHeightMm,
      moduleWidthMm,
      panelGapMm,
      referenceDescription,
      referenceLengthMm,
      mountingSystem,
      moduleOrientation,
      layoutMode,
      preferredGutterClearanceMm,
      roofSelectionMode,
      priorityRoofFaceId,
      roofTopology,
      coveringType,
      roofFacesJson,
      panelColor,
      projectDescription,
      automaticProjectDescription,
      roofColor,
      roofOrientation,
      roofPitchDeg,
      urbanismContext,
      officialSiteDetails,
    ],
  );
  const technicalFieldsComplete =
    Boolean(resolvedModule) && Number(panelGapMm) >= 0 &&
    Boolean(roofColor.trim()) && Boolean(panelColor.trim()) && Boolean(mountingSystem.trim());
  const layoutMatches = layoutMode === "automatic" || (Number(layoutRows) > 0 && Number(layoutColumns) > 0 && Number(layoutRows) * Number(layoutColumns) === Number(moduleCount));
  const canGenerate =
    Boolean(projectId) &&
    localAiState === "online" &&
    finalAttestation &&
    technicalFieldsComplete &&
    layoutMatches &&
    dpPieces.every((piece) => piece.status !== "blocked") &&
    Boolean(photos.satellite) &&
    Boolean(photos.satellite_mass) &&
    Boolean(photos.near) &&
    Boolean(photos.roof) &&
    Boolean(photos.far);

  useEffect(() => {
    void loadProjects();
  }, []);

  useEffect(() => {
    let active = true;
    void fetch("/api/dp-ai/health", { cache: "no-store" })
      .then((response) => {
        if (active) setLocalAiState(response.ok ? "online" : "offline");
      })
      .catch(() => {
        if (active) setLocalAiState("offline");
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setRightPanelOpen(window.matchMedia("(min-width: 1181px)").matches);
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  async function loadProjects() {
    try {
      const response = await fetch("/api/projects", { cache: "no-store" });
      if (!response.ok) return;
      const payload = (await response.json()) as { projects?: SavedProject[] };
      setRecentProjects(payload.projects ?? []);
    } catch {
      // L’interface reste utilisable même si la liste ne peut pas être chargée.
    }
  }

  async function loadProjectFiles(id: string) {
    try {
      const response = await fetch(`/api/projects/${id}/files`, {
        cache: "no-store",
      });
      if (!response.ok) return;
      const payload = (await response.json()) as {
        files?: Array<{ kind: string; fileName: string }>;
      };
      const restored: Record<string, string> = {};
      for (const file of payload.files ?? []) {
        if (!restored[file.kind]) restored[file.kind] = file.fileName;
      }
      setPhotos(restored);
    } catch {
      setPhotos({});
    }
  }

  function restoreProject(project: SavedProject) {
    setProjectId(project.id);
    if (project.requesterKind === "company") {
      setVatInput(project.requesterVat);
      setSelectedSiret(project.requesterSiret);
      setCompany({
        vat: project.requesterVat,
        siret: project.requesterSiret,
        siren: project.requesterSiren,
        name: project.requesterName,
        address: project.requesterAddress,
        ape: project.requesterApe,
        legalFormCode: null,
        createdAt: null,
        active: true,
        establishments: [
          {
            siret: project.requesterSiret,
            address: project.requesterAddress,
            ape: project.requesterApe,
            active: true,
            isHeadOffice: true,
          },
        ],
        source: project.requesterSource,
        checkedAt: project.requesterVerifiedAt,
      });
      setCompanyConfirmed(true);
      setFirstName("");
      setLastName("");
      setPersonAddress("");
    } else {
      setVatInput("");
      setCompany(null);
      setCompanyConfirmed(false);
      setSelectedSiret("");
      setFirstName(project.requesterFirstName);
      setLastName(project.requesterLastName);
      setPersonAddress(project.requesterAddress);
    }
    setLookupState("success");
    setSiteAddress(project.siteAddress);
    setSameAddress(
      Boolean(project.siteAddress) &&
        project.siteAddress === project.requesterAddress,
    );
    setSupportType(project.supportType);
    setPowerKwp(project.powerKwp);
    setModuleCount(project.moduleCount ? String(project.moduleCount) : "");
    setModuleReference(project.moduleReference);
    setResolvedModule(null);
    setModuleLookupState("idle");
    setModuleLookupError("");
    if (project.moduleReference) void resolveModuleReference(project.moduleReference, project.moduleCount ?? 0);
    setInjectionMode(project.injectionMode);
    const storedDetails = parseStoredRecord(project.formData);
    setCadastralReference(String(storedDetails.cadastralReference ?? ""));
    setParcelAreaM2(String(storedDetails.parcelAreaM2 ?? ""));
    setParcelGeometry(String(storedDetails.parcelGeometry ?? ""));
    setUrbanismContext({
      status: storedDetails.urbanismDocumentId ? "verified-source" : "unavailable",
      documentId: String(storedDetails.urbanismDocumentId ?? ""),
      documentType: String(storedDetails.urbanismDocumentType ?? ""),
      documentName: String(storedDetails.urbanismDocumentName ?? ""),
      documentTimestamp: String(storedDetails.urbanismDocumentTimestamp ?? ""),
      zone: String(storedDetails.urbanismZone ?? ""),
      zoneLabel: String(storedDetails.urbanismZoneLabel ?? ""),
      ruleFile: String(storedDetails.urbanismRuleFile ?? ""),
      ruleSourceUrl: String(storedDetails.urbanismRuleSourceUrl ?? ""),
      supCategories: String(storedDetails.urbanismSupCategories ?? "").split(",").filter(Boolean),
      protectedArea: storedDetails.urbanismProtectedArea === "true",
      authorityReviewRequired: storedDetails.urbanismAuthorityReviewRequired === "true",
      prescriptionCount: Number(storedDetails.urbanismPrescriptionCount ?? 0),
      informationCount: Number(storedDetails.urbanismInformationCount ?? 0),
      checkedAt: String(storedDetails.urbanismCheckedAt ?? ""),
      source: String(storedDetails.urbanismSource ?? ""),
    });
    setOfficialSiteDetails({
      longitude: String(storedDetails.siteLongitude ?? ""),
      latitude: String(storedDetails.siteLatitude ?? ""),
      cityCode: String(storedDetails.cityCode ?? ""),
      postcode: String(storedDetails.postcode ?? ""),
      municipality: String(storedDetails.municipality ?? ""),
      checkedAt: String(storedDetails.siteContextCheckedAt ?? ""),
      source: String(storedDetails.siteContextSource ?? ""),
      satelliteSourceUrl: String(storedDetails.satelliteSourceUrl ?? ""),
      satelliteMetersPerPixel: String(storedDetails.satelliteMetersPerPixel ?? ""),
      satelliteGeneratedAt: String(storedDetails.satelliteGeneratedAt ?? ""),
      satelliteMassSourceUrl: String(storedDetails.satelliteMassSourceUrl ?? ""),
      satelliteMassMetersPerPixel: String(storedDetails.satelliteMassMetersPerPixel ?? ""),
      satelliteMassGeneratedAt: String(storedDetails.satelliteMassGeneratedAt ?? ""),
    });
    setBirthDate(String(storedDetails.birthDate ?? ""));
    setBirthCity(String(storedDetails.birthCity ?? ""));
    setBirthDepartment(String(storedDetails.birthDepartment ?? ""));
    setBirthCountry(String(storedDetails.birthCountry ?? "France"));
    setRepresentativeFirstName(String(storedDetails.representativeFirstName ?? ""));
    setRepresentativeLastName(String(storedDetails.representativeLastName ?? ""));
    setModuleWidthMm(String(storedDetails.moduleWidthMm ?? ""));
    setModuleHeightMm(String(storedDetails.moduleHeightMm ?? ""));
    setPanelGapMm(String(storedDetails.panelGapMm ?? "20"));
    setReferenceLengthMm(String(storedDetails.referenceLengthMm ?? ""));
    setReferenceDescription(String(storedDetails.referenceDescription ?? ""));
    setLayoutRows(String(storedDetails.layoutRows ?? ""));
    setLayoutColumns(String(storedDetails.layoutColumns ?? ""));
    setRoofPitchDeg(String(storedDetails.roofPitchDeg ?? ""));
    setRoofOrientation(String(storedDetails.roofOrientation ?? ""));
    setRoofColor(String(storedDetails.roofColor ?? ""));
    setPanelColor(String(storedDetails.panelColor ?? ""));
    setMountingSystem(String(storedDetails.mountingSystem ?? ""));
    setModuleOrientation(storedDetails.moduleOrientation === "landscape" ? "landscape" : "portrait");
    setLayoutMode(storedDetails.layoutMode === "automatic" ? "automatic" : "fixed");
    setPreferredGutterClearanceMm(String(storedDetails.preferredGutterClearanceMm ?? "300"));
    setRoofSelectionMode(storedDetails.roofSelectionMode === "priority" ? "priority" : "automatic");
    setPriorityRoofFaceId(String(storedDetails.priorityRoofFaceId ?? ""));
    setRoofTopology(String(storedDetails.roofTopology ?? "unknown"));
    setCoveringType(String(storedDetails.coveringType ?? "unknown"));
    setRoofFacesJson(String(storedDetails.roofFacesJson ?? ""));
    try { const faces = JSON.parse(String(storedDetails.roofFacesJson ?? "[]")); setDetectedRoofFaces(Array.isArray(faces) ? faces : []); } catch { setDetectedRoofFaces([]); }
    setProjectDescription(String(storedDetails.projectDescription ?? ""));
    const storedValidation = parseStoredRecord(project.validationData);
    setFinalAttestation(storedValidation.finalAttestation === true);
    setActiveStep(Math.min(5, Math.max(1, project.currentStep)));
    setProjectsOpen(false);
    void loadProjectFiles(project.id);
    toast.success("Dossier repris avec ses dernières données enregistrées.");
  }

  async function createProject() {
    if (!identityVerified) throw new Error("Identité non vérifiée.");
    if (isCompanyMode && !company) throw new Error("Société non vérifiée.");
    const requester = isCompanyMode
      ? {
          ...company,
          kind: "company" as const,
          vat: normalizeFrenchVat(vatInput),
        }
      : {
          kind: "person" as const,
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          name: `${firstName.trim()} ${lastName.trim()}`,
          address: personAddress.trim(),
          checkedAt: new Date().toISOString(),
          active: true,
        };
    const response = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requester }),
    });
    const payload = await readJsonResponse<{
      project?: { id: string };
      error?: string;
    }>(response);
    if (!response.ok || !payload.project?.id) {
      throw new Error(payload.error ?? "Le dossier n’a pas pu être créé.");
    }
    setProjectId(payload.project.id);
    await loadProjects();
    return payload.project.id;
  }

  async function saveProject(
    id: string,
    nextStep: number,
    overrides?: { siteAddress?: string; formData?: Record<string, unknown> },
  ) {
    const response = await fetch(`/api/projects/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        currentStep: nextStep,
        siteAddress: overrides?.siteAddress ?? siteAddress,
        supportType,
        powerKwp,
        moduleCount,
        moduleReference,
        injectionMode,
        formData: overrides?.formData ?? technicalFormData,
        validationData: { completion, dpPieces, finalAttestation },
      }),
    });
    const payload = await readJsonResponse<{ error?: string }>(response);
    if (!response.ok) {
      throw new Error(payload.error ?? "La sauvegarde n’a pas abouti.");
    }
    await loadProjects();
  }

  async function lookupCompany() {
    const vat = normalizeFrenchVat(vatInput);
    setCompany(null);
    setCompanyConfirmed(false);
    setSelectedSiret("");
    setLookupError("");

    if (!validateFrenchVat(vat)) {
      setLookupState("error");
      setLookupError("Ce numéro de TVA française est incomplet ou invalide.");
      return;
    }

    setLookupState("loading");
    try {
      const response = await fetch(`/api/companies/vat/${encodeURIComponent(vat)}`);
      const payload = (await response.json()) as {
        company?: Company;
        error?: string;
      };

      if (!response.ok || !payload.company) {
        throw new Error(payload.error ?? "Établissement introuvable.");
      }

      setCompany(payload.company);
      setSelectedSiret(payload.company.siret);
      setLookupState("success");
      if (payload.company.address) setSiteAddress(payload.company.address);
      toast.success("Société retrouvée et rapprochée dans les deux sources officielles.");
    } catch (error) {
      setLookupState("error");
      setLookupError(
        error instanceof Error
          ? error.message
          : "La vérification n’a pas abouti.",
      );
    }
  }

  function chooseEstablishment(siret: string) {
    const establishment = company?.establishments.find(
      (item) => item.siret === siret,
    );
    if (!company || !establishment) return;

    setSelectedSiret(siret);
    setCompany({
      ...company,
      siret: establishment.siret,
      address: establishment.address,
      ape: establishment.ape,
      active: establishment.active,
    });
    setCompanyConfirmed(false);
    if (sameAddress === true) setSiteAddress(establishment.address);
  }

  function chooseSameAddress(value: boolean) {
    setSameAddress(value);
    setSiteAddress(value ? requesterAddress : "");
    setUrbanismContext(null);
    setOfficialSiteDetails({ longitude: "", latitude: "", cityCode: "", postcode: "", municipality: "", checkedAt: "", source: "", satelliteSourceUrl: "", satelliteMetersPerPixel: "", satelliteGeneratedAt: "", satelliteMassSourceUrl: "", satelliteMassMetersPerPixel: "", satelliteMassGeneratedAt: "" });
  }

  async function onSourceSelected(slotId: string, file?: File) {
    if (!file) return;
    if (!projectId) {
      toast.error("Créez d’abord le dossier avant d’ajouter des pièces.");
      return;
    }
    setUploadingPhoto(slotId);
    try {
      const optimizedFile = await optimizePhotoForUpload(file);
      const formData = new FormData();
      formData.set("kind", slotId);
      formData.set("file", optimizedFile);
      const response = await fetch(`/api/projects/${projectId}/files`, {
        method: "POST",
        body: formData,
      });
      const payload = await readJsonResponse<{ error?: string }>(response);
      if (!response.ok) {
        throw new Error(payload.error ?? "La pièce n’a pas pu être enregistrée.");
      }
      setPhotos((current) => ({ ...current, [slotId]: optimizedFile.name }));
      setFinalAttestation(false);
      toast.success("Photo décodée, normalisée sans recadrage et conservée avec le maximum de détails utiles.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Échec de l’enregistrement.",
      );
    } finally {
      setUploadingPhoto(null);
    }
  }

  async function resolveModuleReference(reference = moduleReference, quantity = Number(moduleCount)) {
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
      const response = await fetch(`/api/pv-modules/resolve?reference=${encodeURIComponent(exactReference)}`, { cache: "no-store" });
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

  async function analyzeRoofFacesAndCapacity(id: string) {
    setIsCheckingLayout(true);
    try {
      const response = await fetch(`/api/projects/${id}/layout-check`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          moduleCount: Number(moduleCount), moduleReference,
          panelGapMm: Number(panelGapMm), layoutRows: Number(layoutRows), layoutColumns: Number(layoutColumns), layoutMode,
          moduleOrientation, roofPitchDeg: Number(roofPitchDeg), preferredGutterClearanceMm: Number(preferredGutterClearanceMm || 300),
          roofSelectionMode, priorityRoofFaceId, supportType, roofTopology, coveringType,
        }),
      });
      const payload = await readJsonResponse<{ fits?: boolean; error?: string; faces?: Array<{ id: string; label?: string; widthMm?: number; slopeLengthMm?: number }>; roofFacesJson?: string; resolvedGutterMm?: number; split?: boolean }>(response);
      if (!response.ok || payload.fits !== true) throw new Error(payload.error ?? "La quantité demandée ne tient pas sur les pans détectés.");
      const faces = payload.faces ?? [];
      setDetectedRoofFaces(faces);
      setRoofFacesJson(payload.roofFacesJson ?? JSON.stringify(faces));
      if (roofSelectionMode === "priority" && priorityRoofFaceId && !faces.some((face) => face.id === priorityRoofFaceId)) setPriorityRoofFaceId("");
      toast.success(payload.split ? "Quantité validée avec répartition sur plusieurs pans." : "Quantité validée sur le toit détecté.");
      return payload;
    } finally {
      setIsCheckingLayout(false);
    }
  }

  async function goNext() {
    if (activeStep === 1 && !identityVerified) {
      toast.error("Complétez et validez l’identité avant de continuer.");
      return;
    }
    if (activeStep === 2 && !siteAddress.trim()) {
      toast.error("L’adresse exacte du projet est indispensable.");
      return;
    }
    if (
      activeStep === 3 &&
      (!supportType ||
        !moduleCount ||
        !moduleReference ||
        !resolvedModule ||
        !injectionMode ||
        !technicalFieldsComplete)
    ) {
      toast.error("Complétez les données techniques indispensables au contrôle.");
      return;
    }
    if (activeStep === 3 && !layoutMatches) {
      toast.error("Le nombre de rangées multiplié par le nombre de colonnes doit correspondre au nombre de modules.");
      return;
    }
    const nextStep = Math.min(5, activeStep + 1);
    setIsSaving(true);
    try {
      const id = projectId ?? (await createProject());
      let saveOverrides: { siteAddress?: string; formData?: Record<string, unknown> } | undefined;
      if (activeStep === 3) {
        await saveProject(id, 3);
        const layout = await analyzeRoofFacesAndCapacity(id);
        if (roofSelectionMode === "priority" && !priorityRoofFaceId) {
          throw new Error("Les pans ont été détectés. Choisissez maintenant le pan prioritaire puis cliquez à nouveau sur Continuer.");
        }
        if (layout.roofFacesJson) {
          setRoofFacesJson(layout.roofFacesJson);
          saveOverrides = { formData: { ...technicalFormData, roofFacesJson: layout.roofFacesJson } };
        }
      }
      if (activeStep === 2) {
        const contextResponse = await fetch(`/api/site-context?address=${encodeURIComponent(siteAddress)}`);
        const contextPayload = await readJsonResponse<{ context?: { parcelId?: string; parcelAreaM2?: number; parcelGeometry?: unknown; normalizedAddress?: string; longitude?: number; latitude?: number; cityCode?: string; postcode?: string; municipality?: string; checkedAt?: string; source?: string; urbanism?: UrbanismContext }; error?: string }>(contextResponse);
        if (!contextResponse.ok || !contextPayload.context) {
          throw new Error(contextPayload.error ?? "Le site n’a pas pu être contrôlé par l’IGN.");
        }
        const normalizedSiteAddress = contextPayload.context.normalizedAddress || siteAddress;
        const nextParcelId = contextPayload.context.parcelId || "";
        const nextParcelArea = contextPayload.context.parcelAreaM2 ? String(contextPayload.context.parcelAreaM2) : "";
        const nextParcelGeometry = contextPayload.context.parcelGeometry ? JSON.stringify(contextPayload.context.parcelGeometry) : "";
        const nextUrbanism = contextPayload.context.urbanism ?? null;
        if (!nextUrbanism || nextUrbanism.status !== "verified-source") {
          throw new Error("Le Géoportail de l’urbanisme n’a pas identifié un règlement et une zone uniques. Le dossier ne peut pas être déclaré conforme automatiquement.");
        }
        const longitude = Number(contextPayload.context.longitude);
        const latitude = Number(contextPayload.context.latitude);
        const satelliteResponse = await fetch(`/api/projects/${id}/satellite`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ longitude, latitude }),
        });
        const satellitePayload = await readJsonResponse<{
          file?: { fileName?: string };
          massFile?: { fileName?: string };
          source?: { url?: string; metersPerPixel?: number; generatedAt?: string };
          massSource?: { url?: string; metersPerPixel?: number; generatedAt?: string };
          error?: string;
        }>(satelliteResponse);
        if (!satelliteResponse.ok || !satellitePayload.file?.fileName || !satellitePayload.massFile?.fileName || !satellitePayload.source?.url || !satellitePayload.massSource?.url) {
          throw new Error(satellitePayload.error ?? "La vue aérienne IGN n’a pas pu être créée automatiquement.");
        }
        setSiteAddress(normalizedSiteAddress);
        setCadastralReference(nextParcelId);
        setParcelAreaM2(nextParcelArea);
        setParcelGeometry(nextParcelGeometry);
        setUrbanismContext(nextUrbanism);
        const nextOfficialSite = {
          longitude: String(contextPayload.context.longitude ?? ""),
          latitude: String(contextPayload.context.latitude ?? ""),
          cityCode: contextPayload.context.cityCode ?? "",
          postcode: contextPayload.context.postcode ?? "",
          municipality: contextPayload.context.municipality ?? "",
          checkedAt: contextPayload.context.checkedAt ?? "",
          source: contextPayload.context.source ?? "",
          satelliteSourceUrl: satellitePayload.source.url,
          satelliteMetersPerPixel: String(satellitePayload.source.metersPerPixel ?? ""),
          satelliteGeneratedAt: satellitePayload.source.generatedAt ?? "",
          satelliteMassSourceUrl: satellitePayload.massSource.url,
          satelliteMassMetersPerPixel: String(satellitePayload.massSource.metersPerPixel ?? ""),
          satelliteMassGeneratedAt: satellitePayload.massSource.generatedAt ?? "",
        };
        setOfficialSiteDetails(nextOfficialSite);
        setPhotos((current) => ({
          ...current,
          satellite: satellitePayload.file?.fileName ?? "vue-satellite-ign.png",
          satellite_mass: satellitePayload.massFile?.fileName ?? "vue-satellite-masse-ign.png",
        }));
        setFinalAttestation(false);
        saveOverrides = {
          siteAddress: normalizedSiteAddress,
          formData: {
            ...technicalFormData,
            cadastralReference: nextParcelId,
            parcelAreaM2: nextParcelArea,
            parcelGeometry: nextParcelGeometry,
            urbanismDocumentId: nextUrbanism.documentId ?? "",
            urbanismDocumentType: nextUrbanism.documentType ?? "",
            urbanismDocumentName: nextUrbanism.documentName ?? "",
            urbanismDocumentTimestamp: nextUrbanism.documentTimestamp ?? "",
            urbanismZone: nextUrbanism.zone ?? "",
            urbanismZoneLabel: nextUrbanism.zoneLabel ?? "",
            urbanismRuleFile: nextUrbanism.ruleFile ?? "",
            urbanismRuleSourceUrl: nextUrbanism.ruleSourceUrl ?? "",
            urbanismSupCategories: (nextUrbanism.supCategories ?? []).join(","),
            urbanismProtectedArea: String(nextUrbanism.protectedArea ?? false),
            urbanismAuthorityReviewRequired: String(nextUrbanism.authorityReviewRequired ?? false),
            urbanismPrescriptionCount: String(nextUrbanism.prescriptionCount ?? 0),
            urbanismInformationCount: String(nextUrbanism.informationCount ?? 0),
            urbanismCheckedAt: nextUrbanism.checkedAt ?? "",
            urbanismSource: nextUrbanism.source ?? "",
            siteLongitude: nextOfficialSite.longitude,
            siteLatitude: nextOfficialSite.latitude,
            cityCode: nextOfficialSite.cityCode,
            postcode: nextOfficialSite.postcode,
            municipality: nextOfficialSite.municipality,
            siteContextCheckedAt: nextOfficialSite.checkedAt,
            siteContextSource: nextOfficialSite.source,
            satelliteAutoGenerated: "true",
            satelliteSourceUrl: nextOfficialSite.satelliteSourceUrl,
            satelliteMetersPerPixel: nextOfficialSite.satelliteMetersPerPixel,
            satelliteGeneratedAt: nextOfficialSite.satelliteGeneratedAt,
            satelliteMassSourceUrl: nextOfficialSite.satelliteMassSourceUrl,
            satelliteMassMetersPerPixel: nextOfficialSite.satelliteMassMetersPerPixel,
            satelliteMassGeneratedAt: nextOfficialSite.satelliteMassGeneratedAt,
          },
        };
      }
      await saveProject(id, nextStep, saveOverrides);
      setActiveStep(nextStep);
      toast.success("Dossier enregistré.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "La sauvegarde n’a pas abouti.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function generateDossier() {
    if (!projectId || !canGenerate) {
      toast.error("Le dossier reste verrouillé tant que tous les contrôles ne sont pas validés.");
      return;
    }
    setIsGenerating(true);
    try {
      await saveProject(projectId, 5);
      const response = await fetch(`/api/projects/${projectId}/generate`, {
        method: "POST",
      });
      if (!response.ok) {
        const payload = (await response.json()) as {
          error?: string;
          issues?: Array<{ message: string }>;
        };
        const details = payload.issues
          ?.slice(0, 3)
          .map((issue) => issue.message)
          .join(" ");
        throw new Error([payload.error, details].filter(Boolean).join(" "));
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `PilotPaper-DP-${projectId.slice(0, 8)}.pdf`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      toast.success("Dossier généré après validation préflight et postflight.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "La génération a été bloquée.");
    } finally {
      setIsGenerating(false);
    }
  }

  return (
    <SidebarProvider
      defaultOpen
      style={
        {
          "--sidebar-width": "17.5rem",
          "--sidebar-width-icon": "4.25rem",
        } as CSSProperties
      }
    >
      <div className="ambient-field" aria-hidden="true">
        <span className="ambient-orb ambient-orb-one" />
        <span className="ambient-orb ambient-orb-two" />
        <span className="ambient-grid" />
      </div>

      <Sidebar variant="floating" collapsible="icon" className="app-sidebar">
        <SidebarHeader className="p-4">
          <div className="brand-mark-wrap">
            <PilotPaperMark />
            <div className="min-w-0 group-data-[collapsible=icon]:hidden">
              <PilotPaperWordmark compact />
              <p className="truncate text-[10px] font-medium uppercase tracking-[0.18em] text-zinc-400">
                Documents · France
              </p>
            </div>
          </div>
        </SidebarHeader>

        <SidebarContent className="px-3">
          <SidebarGroup>
            <SidebarGroupLabel>Production</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton tooltip="Tableau de bord">
                    <LayoutDashboard />
                    <span>Tableau de bord</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton isActive tooltip="Nouveau dossier">
                    <Plus />
                    <span>Nouveau dossier</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    tooltip="Dossiers"
                    onClick={() => setProjectsOpen(true)}
                  >
                    <FileStack />
                    <span>Dossiers</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>

          <SidebarGroup>
            <SidebarGroupLabel>Contrôle</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton tooltip="Moteur IA local">
                    <Cpu />
                    <span>Moteur IA local</span>
                    <span className="ml-auto size-2 rounded-full bg-amber-400 group-data-[collapsible=icon]:hidden" />
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton tooltip="Référentiel">
                    <Database />
                    <span>Référentiel</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>

        <SidebarFooter className="p-3">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton tooltip="Paramètres">
                <Settings2 />
                <span>Paramètres</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton tooltip={currentUser.displayName}>
                <span className="user-avatar">
                  {initials(currentUser.displayName)}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-xs font-medium">
                    {currentUser.displayName}
                  </span>
                  <span className="block truncate text-[10px] text-zinc-400">
                    Agence non configurée
                  </span>
                </span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      </Sidebar>

      <SidebarInset className="min-w-0 bg-transparent">
        <header className="topbar">
          <div className="flex min-w-0 items-center gap-3">
            <SidebarTrigger className="md:hidden" />
            <div className="min-w-0">
              <p className="eyebrow">Nouveau dossier</p>
              <h1 className="truncate text-xl font-semibold tracking-[-0.035em] text-zinc-950">
                Déclaration préalable photovoltaïque
              </h1>
            </div>
          </div>
          <div className="topbar-status">
            <span className={`status-pulse ${projectId ? "is-saved" : ""}`} />
            <span className="hidden sm:inline">
              {projectId ? "Sauvegarde active" : "Sauvegarde au prochain écran"}
            </span>
            <Badge
              variant="outline"
              className="rounded-full bg-white/70 text-zinc-600"
            >
              {projectId ? `Dossier ${projectId.slice(0, 8)}` : "Brouillon"}
            </Badge>
            <Button
              type="button"
              variant="outline"
              onClick={() => setRightPanelOpen(true)}
              aria-expanded={rightPanelOpen}
              className="control-panel-button rounded-xl bg-white/75"
            >
              <PanelRightOpen />
              <span className="hidden sm:inline">Contrôles</span>
            </Button>
          </div>
        </header>

        <main className="workspace-main">
          <section className="wizard-shell">
            <div className="wizard-head">
              <div>
                <p className="eyebrow">Assistant guidé</p>
                <h2 className="mt-1 text-2xl font-semibold tracking-[-0.04em] text-zinc-950">
                  Seulement les informations indispensables.
                </h2>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-500">
                  Les données récupérables automatiquement ne vous seront pas
                  demandées. Chaque valeur reste sourcée et contrôlable.
                </p>
              </div>
              <div
                className="completion-ring"
                style={{ "--value": `${completion * 3.6}deg` } as CSSProperties}
              >
                <span>{completion}%</span>
              </div>
            </div>
            <Progress value={completion} className="h-1 rounded-none bg-zinc-100" />

            <div
              className="step-rail"
              role="tablist"
              aria-label="Étapes du dossier"
            >
              {steps.map((step) => {
                const Icon = step.icon;
                const isActive = activeStep === step.id;
                const isPast = activeStep > step.id;
                return (
                  <button
                    key={step.id}
                    type="button"
                    className={`step-item ${isActive ? "is-active" : ""} ${isPast ? "is-past" : ""}`}
                    onClick={() => {
                      if (step.id <= activeStep) setActiveStep(step.id);
                    }}
                    aria-selected={isActive}
                    role="tab"
                  >
                    <span className="step-icon">
                      {isPast ? <CheckCircle2 /> : <Icon />}
                    </span>
                    <span>
                      <small>0{step.id}</small>
                      <strong>{step.label}</strong>
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="wizard-body">
              {activeStep === 1 && (
                <section
                  className="stage-panel stage-enter"
                  aria-labelledby="step-one-title"
                >
                  <div className="stage-copy">
                    <Badge variant="outline" className="stage-number">
                      Étape 01
                    </Badge>
                    <h3 id="step-one-title">Identification</h3>
                    <p>
                      Trois informations suffisent. Si une TVA française est
                      indiquée, PilotPaper retrouve et contrôle automatiquement
                      la société.
                    </p>
                  </div>

                  <div className="form-card">
                    <div className={`identity-status ${lookupState === "error" ? "is-error" : identityVerified ? "is-ok" : "is-pending"}`}>
                      {lookupState === "error" ? <XCircle /> : identityVerified ? <BadgeCheck /> : <CircleDashed />}
                      {identityLabel}
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-3">
                        <Label htmlFor="vat">Numéro de TVA française</Label>
                        <span className="field-necessity">
                          Facultatif · identification automatique
                        </span>
                      </div>
                      <div className="search-field">
                        <Input
                          id="vat"
                          inputMode="text"
                          autoComplete="off"
                          value={formatFrenchVat(vatInput)}
                          onChange={(event) => {
                            setVatInput(normalizeFrenchVat(event.target.value));
                            setCompany(null);
                            setCompanyConfirmed(false);
                            setSelectedSiret("");
                            setLookupState("idle");
                            setLookupError("");
                          }}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") void lookupCompany();
                          }}
                          placeholder="FR 12 345678901"
                          aria-invalid={lookupState === "error"}
                          className="h-14 rounded-2xl border-zinc-200 bg-white pl-12 pr-40 text-base font-medium tracking-[0.08em] shadow-none"
                        />
                        <Search className="search-leading" />
                        <Button
                          type="button"
                          onClick={() => void lookupCompany()}
                          disabled={
                            lookupState === "loading" ||
                            !validateFrenchVat(vatInput)
                          }
                          className="search-action h-10 rounded-xl bg-zinc-950 px-4 text-white"
                        >
                          {lookupState === "loading" ? (
                            <LoaderCircle className="animate-spin" />
                          ) : (
                            <ScanLine />
                          )}
                          Vérifier
                        </Button>
                      </div>
                      <p className="text-xs leading-5 text-zinc-400">
                        Double contrôle VIES puis rapprochement exact avec le
                        SIREN et les établissements Sirene.
                      </p>
                    </div>

                    {!isCompanyMode && (
                      <div className="person-fields stage-enter">
                        <div className="space-y-2">
                          <Label htmlFor="first-name">Prénom</Label>
                          <Input id="first-name" value={firstName} onChange={(event) => setFirstName(event.target.value)} autoComplete="given-name" placeholder="Prénom" />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="last-name">Nom</Label>
                          <Input id="last-name" value={lastName} onChange={(event) => setLastName(event.target.value)} autoComplete="family-name" placeholder="Nom" />
                        </div>
                        <div className="space-y-2 sm:col-span-2">
                          <Label htmlFor="person-address">Adresse complète</Label>
                          <Textarea id="person-address" value={personAddress} onChange={(event) => setPersonAddress(event.target.value)} autoComplete="street-address" placeholder="Numéro, voie, code postal et commune" />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="birth-date">Date de naissance</Label>
                          <Input id="birth-date" type="date" value={birthDate} onChange={(event) => setBirthDate(event.target.value)} />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="birth-city">Commune de naissance</Label>
                          <Input id="birth-city" value={birthCity} onChange={(event) => setBirthCity(event.target.value)} placeholder="Commune" />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="birth-department">Département de naissance</Label>
                          <Input id="birth-department" value={birthDepartment} onChange={(event) => setBirthDepartment(event.target.value)} placeholder="Ex. 21" />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="birth-country">Pays de naissance</Label>
                          <Input id="birth-country" value={birthCountry} onChange={(event) => setBirthCountry(event.target.value)} />
                        </div>
                      </div>
                    )}

                    {lookupState === "error" && (
                      <Alert
                        variant="destructive"
                        className="mt-5 rounded-2xl border-red-100 bg-red-50/70"
                      >
                        <TriangleAlert />
                        <AlertTitle>Vérification impossible</AlertTitle>
                        <AlertDescription>{lookupError}</AlertDescription>
                      </Alert>
                    )}

                    {company && (
                      <div
                        className={`company-result ${company.active ? "is-active" : "is-closed"}`}
                      >
                        <div className="company-result-top">
                          <span className="company-icon">
                            <Building2 />
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <h4>{company.name}</h4>
                              <span
                                className={`source-state ${company.active ? "ok" : "bad"}`}
                              >
                                {company.active ? <BadgeCheck /> : <XCircle />}
                                {company.active
                                  ? "Établissement actif"
                                  : "Établissement fermé"}
                              </span>
                            </div>
                            <p>
                              {company.address || "Adresse non diffusée"}
                            </p>
                          </div>
                        </div>
                        <div className="company-data-grid">
                          <div>
                            <span>TVA</span>
                            <strong>{formatFrenchVat(company.vat)}</strong>
                          </div>
                          <div>
                            <span>SIREN</span>
                            <strong>{company.siren}</strong>
                          </div>
                          <div>
                            <span>Activité APE</span>
                            <strong>{company.ape ?? "Non diffusée"}</strong>
                          </div>
                        </div>
                        {company.establishments.length > 1 && (
                          <div className="establishment-picker">
                            <Label>Établissement utilisé</Label>
                            <Select value={selectedSiret} onValueChange={chooseEstablishment}>
                              <SelectTrigger className="mt-2 h-11 w-full rounded-xl bg-white">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {company.establishments.map((establishment) => (
                                  <SelectItem key={establishment.siret} value={establishment.siret} disabled={!establishment.active}>
                                    {establishment.isHeadOffice ? "Siège social — " : "Établissement — "}{formatSiret(establishment.siret)}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        )}
                        <div className="source-proof">
                          <ShieldCheck />
                          <span>
                            <strong>Source contrôlée</strong>
                            {company.source}
                          </span>
                          <time>
                            {new Intl.DateTimeFormat("fr-FR", {
                              hour: "2-digit",
                              minute: "2-digit",
                            }).format(new Date(company.checkedAt))}
                          </time>
                        </div>
                        <div className="person-fields mt-5">
                          <div className="space-y-2">
                            <Label htmlFor="representative-first-name">Prénom du représentant</Label>
                            <Input id="representative-first-name" value={representativeFirstName} onChange={(event) => setRepresentativeFirstName(event.target.value)} placeholder="Prénom" />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="representative-last-name">Nom du représentant</Label>
                            <Input id="representative-last-name" value={representativeLastName} onChange={(event) => setRepresentativeLastName(event.target.value)} placeholder="Nom" />
                          </div>
                        </div>
                        <Button
                          type="button"
                          onClick={() => setCompanyConfirmed(true)}
                          disabled={!company.active || companyConfirmed}
                          className="company-confirm"
                        >
                          {companyConfirmed ? <BadgeCheck /> : <Building2 />}
                          {companyConfirmed ? "Identité vérifiée" : "Confirmer cette société"}
                        </Button>
                      </div>
                    )}
                  </div>
                </section>
              )}

              {activeStep === 2 && (
                <section
                  className="stage-panel stage-enter"
                  aria-labelledby="step-two-title"
                >
                  <div className="stage-copy">
                    <Badge variant="outline" className="stage-number">
                      Étape 02
                    </Badge>
                    <h3 id="step-two-title">Localiser le projet</h3>
                    <p>
                      Une seule confirmation suffit. Le cadastre, la
                      photographie aérienne, l’orientation et les contraintes
                      locales seront recherchés automatiquement.
                    </p>
                  </div>
                  <div className="form-card">
                    <Label>
                      Le projet se situe-t-il à l’adresse du demandeur ?
                    </Label>
                    <div className="choice-grid mt-3">
                      <button
                        type="button"
                        className={sameAddress === true ? "selected" : ""}
                        onClick={() => chooseSameAddress(true)}
                      >
                        <CheckCircle2 />
                        <span>
                          <strong>Oui, même adresse</strong>
                          <small>Aucune nouvelle saisie</small>
                        </span>
                      </button>
                      <button
                        type="button"
                        className={sameAddress === false ? "selected" : ""}
                        onClick={() => chooseSameAddress(false)}
                      >
                        <MapPin />
                        <span>
                          <strong>Non, autre site</strong>
                          <small>Une adresse à renseigner</small>
                        </span>
                      </button>
                    </div>
                    {(sameAddress !== null || siteAddress) && (
                      <div className="mt-6 space-y-2">
                        <Label htmlFor="site-address">
                          Adresse exacte du projet
                        </Label>
                        <Textarea
                          id="site-address"
                          value={siteAddress}
                          onChange={(event) =>
                            (setSiteAddress(event.target.value), setUrbanismContext(null), setOfficialSiteDetails({ longitude: "", latitude: "", cityCode: "", postcode: "", municipality: "", checkedAt: "", source: "", satelliteSourceUrl: "", satelliteMetersPerPixel: "", satelliteGeneratedAt: "", satelliteMassSourceUrl: "", satelliteMassMetersPerPixel: "", satelliteMassGeneratedAt: "" }))
                          }
                          readOnly={sameAddress === true}
                          className="min-h-24 rounded-2xl border-zinc-200 bg-white p-4 shadow-none"
                          placeholder="Numéro, voie, code postal et commune"
                        />
                      </div>
                    )}
                    <div className="automation-strip mt-6">
                      <span>
                        <Database /> Cadastre
                      </span>
                      <span>
                        <MapPin /> Géocodage
                      </span>
                      <span>
                        <Ruler /> Orientation
                      </span>
                      <span>
                        <ShieldCheck /> Urbanisme
                      </span>
                    </div>
                  </div>
                </section>
              )}

              {activeStep === 3 && (
                <section
                  className="stage-panel stage-enter"
                  aria-labelledby="step-three-title"
                >
                  <div className="stage-copy">
                    <Badge variant="outline" className="stage-number">
                      Étape 03
                    </Badge>
                    <h3 id="step-three-title">Décrire l’installation</h3>
                    <p>
                      Saisissez la quantité et la référence exacte du module. PilotPaper
                      vérifie sa fiche fabricant puis utilise automatiquement ses dimensions
                      et sa puissance réelles ; aucune cote panneau n&apos;est inventée.
                    </p>
                  </div>
                  <div className="form-card grid gap-5 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Support</Label>
                      <Select
                        value={supportType}
                        onValueChange={setSupportType}
                      >
                        <SelectTrigger className="h-12 w-full rounded-xl border-zinc-200 bg-white px-4">
                          <SelectValue placeholder="Choisir le support" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="roof">
                            Toiture existante
                          </SelectItem>
                          <SelectItem value="carport">Ombrière / carport existant</SelectItem>
                          <SelectItem value="flat_roof">Toiture terrasse</SelectItem>
                          <SelectItem value="canopy">Ombrière existante</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Puissance totale calculée</Label>
                      <div className="flex h-12 items-center rounded-xl border border-zinc-200 bg-zinc-50 px-4 text-sm font-medium text-zinc-700">
                        {resolvedModule && powerKwp
                          ? `${powerKwp} kWc · ${resolvedModule.powerWp} W/module`
                          : "Calculée automatiquement depuis la référence et la quantité"}
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="modules">Nombre de modules</Label>
                      <Input
                        id="modules"
                        type="number"
                        min="1"
                        value={moduleCount}
                        onChange={(event) => {
                          const value = event.target.value;
                          setModuleCount(value);
                          setPowerKwp(resolvedModule && Number(value) > 0
                            ? String((resolvedModule.powerWp * Number(value)) / 1000)
                            : "");
                        }}
                        placeholder="12"
                        className="h-12 rounded-xl border-zinc-200 bg-white px-4 shadow-none"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="module-reference">
                        Référence exacte du module
                      </Label>
                      <Input
                        id="module-reference"
                        value={moduleReference}
                        onChange={(event) => {
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
                        placeholder="Ex. TSM-450NEG9R.28"
                        className="h-12 rounded-xl border-zinc-200 bg-white px-4 shadow-none"
                      />
                    </div>
                    <div className="space-y-2 sm:col-span-2">
                      <Label>Mode de valorisation · étape électrique</Label>
                      <Select
                        value={injectionMode}
                        onValueChange={setInjectionMode}
                      >
                        <SelectTrigger className="h-12 w-full rounded-xl border-zinc-200 bg-white px-4">
                          <SelectValue placeholder="Choisir le mode" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="self-no-export">
                            Autoconsommation sans injection
                          </SelectItem>
                          <SelectItem value="self-surplus">
                            Autoconsommation avec surplus
                          </SelectItem>
                          <SelectItem value="total-sale">
                            Vente totale
                          </SelectItem>
                          <SelectItem value="collective">
                            Autoconsommation collective
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="cadastral-reference">Référence cadastrale</Label>
                      <Input
                        id="cadastral-reference"
                        value={cadastralReference}
                        onChange={(event) => setCadastralReference(event.target.value)}
                        placeholder="Section AB · parcelle 0123"
                        className="h-12 rounded-xl border-zinc-200 bg-white px-4 shadow-none"
                      />
                    </div>
                    <div className="space-y-3 sm:col-span-2 rounded-2xl border border-zinc-200 bg-zinc-50/70 p-4">
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
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-2">
                        <Label htmlFor="panel-gap">Jeu entre modules</Label>
                        <div className="unit-field">
                          <Input id="panel-gap" type="number" min="0" max="100" value={panelGapMm} onChange={(event) => setPanelGapMm(event.target.value)} placeholder="20" />
                          <span>mm</span>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="reference-length">Cote réelle de référence</Label>
                        <div className="unit-field">
                          <Input id="reference-length" type="number" min="1" value={referenceLengthMm} onChange={(event) => setReferenceLengthMm(event.target.value)} placeholder="1000" />
                          <span>mm</span>
                        </div>
                      </div>
                    </div>
                    <div className="space-y-2 sm:col-span-2">
                      <Label htmlFor="reference-description">Élément correspondant à cette cote</Label>
                      <Input
                        id="reference-description"
                        value={referenceDescription}
                        onChange={(event) => setReferenceDescription(event.target.value)}
                        placeholder="Ex. règle de 1 m posée dans le plan de toiture"
                        className="h-12 rounded-xl border-zinc-200 bg-white px-4 shadow-none"
                      />
                      <p className="text-xs leading-relaxed text-zinc-500">
                        CoteGuard s’en sert pour recaler les profondeurs et refuse toute mesure uniquement estimée à l’image.
                      </p>
                    </div>
                    <div className="space-y-3 sm:col-span-2 rounded-2xl border border-zinc-200 bg-zinc-50/70 p-4">
                      <div className="flex flex-wrap items-end gap-3">
                        <div className="min-w-[220px] flex-1 space-y-2">
                          <Label>Calepinage</Label>
                          <Select value={layoutMode} onValueChange={(value) => setLayoutMode(value as "fixed" | "automatic")}>
                            <SelectTrigger className="h-11 bg-white"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="fixed">Rangées / colonnes imposées</SelectItem>
                              <SelectItem value="automatic">Répartition automatique de la quantité</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="min-w-[220px] flex-1 space-y-2">
                          <Label>Choix du pan</Label>
                          <Select value={roofSelectionMode} onValueChange={(value) => { setRoofSelectionMode(value as "automatic" | "priority"); if (value === "automatic") setPriorityRoofFaceId(""); }}>
                            <SelectTrigger className="h-11 bg-white"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="automatic">Automatique · meilleur pan puis surplus</SelectItem>
                              <SelectItem value="priority">Pan prioritaire choisi par l’utilisateur</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <Button type="button" variant="outline" disabled={!projectId || isCheckingLayout || !moduleCount || !resolvedModule} onClick={() => projectId && analyzeRoofFacesAndCapacity(projectId)}>{isCheckingLayout ? "Analyse…" : "Analyser les pans"}</Button>
                      </div>
                      {detectedRoofFaces.length > 0 && (
                        <div className="space-y-2">
                          <p className="text-xs font-medium text-zinc-600">Pans détectés : {detectedRoofFaces.map((face) => `${face.id}${face.label ? ` · ${face.label}` : ""}`).join(" — ")}</p>
                          {roofSelectionMode === "priority" && (
                            <Select value={priorityRoofFaceId} onValueChange={setPriorityRoofFaceId}>
                              <SelectTrigger className="h-11 bg-white"><SelectValue placeholder="Choisir le pan à remplir en premier" /></SelectTrigger>
                              <SelectContent>{detectedRoofFaces.map((face) => <SelectItem key={face.id} value={face.id}>{face.id} · {face.label || `Pan ${face.id}`}</SelectItem>)}</SelectContent>
                            </Select>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-2">
                        <Label htmlFor="layout-rows">Rangées</Label>
                        <Input id="layout-rows" type="number" min="1" value={layoutRows} onChange={(event) => setLayoutRows(event.target.value)} placeholder="2" className="h-12 rounded-xl border-zinc-200 bg-white px-4 shadow-none" />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="layout-columns">Colonnes</Label>
                        <Input id="layout-columns" type="number" min="1" value={layoutColumns} onChange={(event) => setLayoutColumns(event.target.value)} placeholder="6" className="h-12 rounded-xl border-zinc-200 bg-white px-4 shadow-none" />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-2">
                        <Label htmlFor="roof-pitch">Pente toiture</Label>
                        <div className="unit-field">
                          <Input id="roof-pitch" type="number" min="0" max="75" value={roofPitchDeg} onChange={(event) => setRoofPitchDeg(event.target.value)} placeholder="30" />
                          <span>°</span>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="roof-orientation">Orientation</Label>
                        <Input id="roof-orientation" value={roofOrientation} onChange={(event) => setRoofOrientation(event.target.value)} placeholder="Sud-est" className="h-12 rounded-xl border-zinc-200 bg-white px-4 shadow-none" />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="roof-color">Couleur couverture</Label>
                      <Input id="roof-color" value={roofColor} onChange={(event) => setRoofColor(event.target.value)} placeholder="Tuile terre cuite rouge" className="h-12 rounded-xl border-zinc-200 bg-white px-4 shadow-none" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="panel-color">Couleur modules et cadres</Label>
                      <Input id="panel-color" value={panelColor} onChange={(event) => setPanelColor(event.target.value)} placeholder="Noir mat, cadre noir" className="h-12 rounded-xl border-zinc-200 bg-white px-4 shadow-none" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="mounting-system">Système de pose</Label>
                      <Input id="mounting-system" value={mountingSystem} onChange={(event) => setMountingSystem(event.target.value)} placeholder="Surimposition parallèle au rampant" className="h-12 rounded-xl border-zinc-200 bg-white px-4 shadow-none" />
                    </div>
                  </div>
                </section>
              )}

              {activeStep === 4 && (
                <section
                  className="stage-panel stage-enter"
                  aria-labelledby="step-four-title"
                >
                  <div className="stage-copy">
                    <Badge variant="outline" className="stage-number">
                      Étape 04
                    </Badge>
                    <h3 id="step-four-title">Ajouter trois photos du projet</h3>
                    <p>
                      PilotPaper fabrique le Cerfa et les pièces DP1 à DP8. Vous fournissez une vue proche, une vue oblique de la toiture et une vue lointaine.
                    </p>
                  </div>
                  <div className="photo-grid">
                    <article className={`photo-slot automatic-source ${photos.satellite && photos.satellite_mass ? "has-file" : ""}`}>
                      <span className="photo-index">AUTO</span>
                      <span className="photo-icon">
                        {photos.satellite && photos.satellite_mass ? <FileCheck2 /> : <LoaderCircle className="animate-spin" />}
                      </span>
                      <strong>Deux vues satellite IGN</strong>
                      <small>
                        {photos.satellite && photos.satellite_mass
                          ? "Situation + plan de masse rapproché créés"
                          : "Créées automatiquement depuis l’adresse et la parcelle"}
                      </small>
                    </article>
                    {sourceSlots.map((slot, index) => (
                      <label
                        key={slot.id}
                        className={`photo-slot ${photos[slot.id] ? "has-file" : ""}`}
                      >
                        <input
                          type="file"
                          accept={slot.accept}
                          disabled={uploadingPhoto === slot.id}
                          onChange={(event) =>
                            void onSourceSelected(
                              slot.id,
                              event.target.files?.[0],
                            )
                          }
                        />
                        <span className="photo-index">{String(index + 1).padStart(2, "0")}</span>
                        <span className="photo-icon">
                          {uploadingPhoto === slot.id ? (
                            <LoaderCircle className="animate-spin" />
                          ) : photos[slot.id] ? (
                            <FileCheck2 />
                          ) : (
                            <UploadCloud />
                          )}
                        </span>
                        <strong>{slot.label}</strong>
                        <small>
                          {uploadingPhoto === slot.id
                            ? "Enregistrement sécurisé…"
                            : photos[slot.id] ?? slot.hint}
                        </small>
                      </label>
                    ))}
                  </div>
                  <Alert className="rounded-2xl border-zinc-200 bg-white/70">
                    <ShieldCheck />
                    <AlertTitle>
                      Aucun plan à importer
                    </AlertTitle>
                    <AlertDescription>
                      La vue satellite alimente les plans. Les trois photographies servent à comprendre le même bâtiment ; DP6 utilise une insertion contrôlée, tandis que DP7/DP8 conservent les photographies réelles proche et lointaine.
                      La description des travaux est également rédigée automatiquement.
                      Toutes les résolutions sont acceptées et normalisées sans recadrage ;
                      seule une perte réelle de détails pouvant fausser une pièce bloque le dossier.
                    </AlertDescription>
                  </Alert>
                </section>
              )}

              {activeStep === 5 && (
                <section
                  className="stage-panel stage-enter"
                  aria-labelledby="step-five-title"
                >
                  <div className="stage-copy stage-copy-wide">
                    <div>
                      <Badge variant="outline" className="stage-number">
                        Étape 05
                      </Badge>
                      <h3 id="step-five-title">Contrôle documentaire</h3>
                      <p>
                        Chaque pièce possède son propre verrou. Une pièce non
                        requise n’est pas inventée ; une pièce incertaine reste
                        bloquée jusqu’à vérification.
                      </p>
                    </div>
                    <div className="blocking-summary">
                      <LockKeyhole />
                      <span>
                        <strong>{blockedCount} verrous</strong>
                        <small>{canGenerate ? "Export autorisé" : "Export final indisponible"}</small>
                      </span>
                    </div>
                  </div>
                  <div className="dp-review-grid">
                    {dpPieces.map((piece) => {
                      const meta = statusMeta[piece.status];
                      const Icon = meta.icon;
                      return (
                        <article
                          key={piece.id}
                          className={`dp-review-card ${meta.className}`}
                        >
                          <div className="dp-review-top">
                            <span className="dp-code">{piece.id}</span>
                            <span className="dp-state">
                              <Icon />
                              {meta.label}
                            </span>
                          </div>
                          <h4>{piece.title}</h4>
                          <p>{piece.reason}</p>
                        </article>
                      );
                    })}
                  </div>
                  <label className={`final-attestation ${finalAttestation ? "is-checked" : ""}`}>
                    <Checkbox
                      checked={finalAttestation}
                      onCheckedChange={(checked) => setFinalAttestation(checked === true)}
                    />
                    <span>
                      <strong>Attestation finale de cohérence</strong>
                      <small>
                        Je confirme que les trois photos représentent bien le site du
                        projet. PilotPaper contrôle ensuite la vue IGN, le Cerfa, les échelles,
                        le calepinage et la cohérence des DP1 à DP8.
                      </small>
                    </span>
                  </label>
                </section>
              )}
            </div>

            <div className="wizard-footer">
              <Button
                type="button"
                variant="ghost"
                disabled={activeStep === 1}
                onClick={() =>
                  setActiveStep((current) => Math.max(1, current - 1))
                }
                className="rounded-xl"
              >
                <ArrowLeft /> Retour
              </Button>
              {activeStep < 5 ? (
                <Button
                  type="button"
                  onClick={() => void goNext()}
                  disabled={isSaving}
                  className="morph-button h-11 rounded-xl bg-zinc-950 px-6 text-white"
                >
                  {isSaving ? (
                    <>
                      <LoaderCircle className="animate-spin" /> Enregistrement…
                    </>
                  ) : (
                    <>
                      Continuer <ArrowRight />
                    </>
                  )}
                </Button>
              ) : (
                <Button
                  type="button"
                  onClick={() => void generateDossier()}
                  disabled={!canGenerate || isGenerating}
                  className="generate-button h-11 rounded-xl px-6"
                >
                  {isGenerating ? (
                    <><LoaderCircle className="animate-spin" /> Contrôle et génération…</>
                  ) : canGenerate ? (
                    <><Download /> <GenerateDeclarationLabel /></>
                  ) : (
                    <><LockKeyhole /> <GenerateDeclarationLabel /></>
                  )}
                </Button>
              )}
            </div>
          </section>

          <Sheet
            open={rightPanelOpen}
            onOpenChange={setRightPanelOpen}
            modal={false}
          >
            <SheetContent
              side="right"
              showCloseButton={false}
              onInteractOutside={(event) => event.preventDefault()}
              className="control-sheet"
            >
              <SheetHeader className="control-sheet-header">
                <div>
                  <SheetTitle>Contrôle du dossier</SheetTitle>
                  <SheetDescription>
                    DP1–DP8, cohérence et moteur local
                  </SheetDescription>
                </div>
                <SheetClose asChild>
                  <Button type="button" variant="ghost" size="icon" aria-label="Fermer le panneau">
                    <X />
                  </Button>
                </SheetClose>
              </SheetHeader>
              <div className="inspector-column control-sheet-scroll">
            <section className="dp-stack-card">
              <div className="inspector-heading">
                <div>
                  <p className="eyebrow">Dossier vivant</p>
                  <h3>Pièces DP1–DP8</h3>
                </div>
                <Badge
                  variant="outline"
                  className="rounded-full bg-white/60"
                >
                  {8 - blockedCount}/8 ouvertes
                </Badge>
              </div>

              <div
                className="document-stage"
                aria-label="Pile des huit pièces DP"
              >
                <div className="document-stack">
                  {dpPieces.map((piece, index) => {
                    const meta = statusMeta[piece.status];
                    return (
                      <div
                        key={piece.id}
                        className={`document-sheet ${meta.className}`}
                        style={
                          {
                            "--sheet-index": index,
                            "--sheet-offset": `${index * 7}px`,
                          } as CSSProperties
                        }
                      >
                        <span>{piece.id}</span>
                        <small>{piece.title}</small>
                        <i />
                      </div>
                    );
                  })}
                </div>
                <div className="document-shadow" />
              </div>

              <div className="quality-gates">
                <div>
                  <span>
                    <BadgeCheck /> Identité
                  </span>
                  <strong className={identityVerified ? "good" : "waiting"}>
                    {identityVerified ? "Vérifiée" : "En attente"}
                  </strong>
                </div>
                <div>
                  <span>
                    <Gauge /> Données
                  </span>
                  <strong className="waiting">{completion}%</strong>
                </div>
                <div>
                  <span>
                    <Ruler /> Géométrie
                  </span>
                  <strong className={layoutMatches ? "good" : "blocked"}>{layoutMatches ? "Cohérente" : "À contrôler"}</strong>
                </div>
                <div>
                  <span>
                    <Sparkles /> Moteur DP
                  </span>
                  <strong className={localAiState === "online" ? "good" : "waiting"}>
                    {localAiState === "checking" ? "Connexion…" : localAiState === "online" ? "Prêt" : "Hors ligne"}
                  </strong>
                </div>
              </div>
            </section>

            <section className="ai-card">
              <div className="ai-card-icon">
                <Cpu />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3>Moteur DP-AI-FIRST</h3>
                  <span className={localAiState === "online" ? "online-dot" : "offline-dot"} />
                </div>
                <p>
                  PilotPaper calcule le calepinage depuis les dimensions réelles, GPT-5.6 Sol analyse les pans et contrôle le dossier, et GPT Image 2 réalise uniquement les insertions visuelles autorisées.
                </p>
              </div>
              <div className="ai-pipeline">
                <span>
                  <ScanLine /> Images
                </span>
                <ArrowRight />
                <span>
                  <Ruler /> Mesures
                </span>
                <ArrowRight />
                <span>
                  <FileText /> Plans
                </span>
              </div>
            </section>

            <section className="export-lock-card">
              <div className="lock-orbit">
                <LockKeyhole />
              </div>
              <div>
                <p className="eyebrow">Règle absolue</p>
                <h3>Aucun fichier avant validation.</h3>
                <p>
                  Les prévisualisations de travail seront distinctes du dossier
                  final.
                </p>
              </div>
            </section>
              </div>
            </SheetContent>
          </Sheet>
        </main>
      </SidebarInset>

      <Dialog open={projectsOpen} onOpenChange={setProjectsOpen}>
        <DialogContent className="recent-dialog max-h-[80vh] overflow-hidden rounded-[1.7rem] border-white/80 bg-white/90 p-0 shadow-2xl backdrop-blur-2xl sm:max-w-2xl">
          <DialogHeader className="border-b border-zinc-100 p-6 pb-5">
            <DialogTitle className="text-xl tracking-[-0.04em]">
              Reprendre un dossier
            </DialogTitle>
            <DialogDescription>
              Les dossiers sont isolés par collaborateur et classés par dernière
              modification.
            </DialogDescription>
          </DialogHeader>
          <div className="recent-projects-list scrollbar-thin">
            {recentProjects.length === 0 ? (
              <div className="recent-empty">
                <FileStack />
                <strong>Aucun dossier enregistré</strong>
                <span>Le premier apparaîtra ici après la validation de l’identité.</span>
              </div>
            ) : (
              recentProjects.map((project) => (
                <button
                  key={project.id}
                  type="button"
                  className="recent-project"
                  onClick={() => restoreProject(project)}
                >
                  <span className="recent-project-icon">
                    <FileText />
                  </span>
                  <span className="min-w-0 flex-1 text-left">
                    <strong>{project.requesterName}</strong>
                    <small>
                      {project.requesterKind === "company"
                        ? `${formatFrenchVat(project.requesterVat)} · `
                        : ""}
                      Étape {project.currentStep}/5
                    </small>
                  </span>
                  <span className="recent-project-date">
                    <Clock3 />
                    {new Intl.DateTimeFormat("fr-FR", {
                      day: "2-digit",
                      month: "short",
                    }).format(new Date(project.updatedAt))}
                  </span>
                  <ArrowRight />
                </button>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Toaster position="bottom-right" richColors />
    </SidebarProvider>
  );
}
