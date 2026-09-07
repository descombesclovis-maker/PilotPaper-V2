# PilotPaper — Universalisation roadmap

This document tracks the staged evolution of PilotPaper from the current DP-AI-FIRST prototype into a universal photovoltaic project/document engine.

Status legend: `[ ]` todo · `[-]` in progress · `[x]` completed.

## P0 — Reliability and architecture
- [-] 001 — Separate generation from validation: generated artifacts must survive QA failure.
- [ ] 002 — Explicit TEST / STANDARD / PRODUCTION modes.
- [ ] 003 — Never discard any OpenAI-generated image; retain every candidate and metadata.
- [ ] 004 — Per-step resume/retry without restarting the whole dossier.
- [ ] 005 — Persistent cache for geocoding, cadastre, imagery, vision, geometry, layouts and AI outputs.
- [ ] 006 — Real asynchronous generation jobs with status/progress endpoints.
- [ ] 007 — Stage-level timeouts and network-only retries.
- [ ] 008 — Persistent request IDs, durations and OpenAI costs per stage.
- [ ] 009 — Health dashboard: success/fallback/error/cost/latency metrics.
- [ ] 010 — Feature flags and isolated experimental/production pipelines.

## P1 — Roof Digital Twin
- [ ] 011 — Canonical Roof Digital Twin shared by all DP pieces.
- [ ] 012 — Stable face IDs across satellite, photos, 3D and documents.
- [ ] 013 — IGN orthophoto + cadastre + elevation/LiDAR fusion.
- [ ] 014 — Roof-face segmentation.
- [ ] 015 — Ridge/eave/rake/hip/valley detection.
- [ ] 016 — Obstacle detection: roof windows, chimneys, vents, antennas, existing PV, vegetation.
- [ ] 017 — Per-face metric usable-area map.
- [ ] 018 — Multi-view face matching.
- [ ] 019 — Camera calibration from EXIF and vanishing points.
- [ ] 020 — Confidence map and provenance for every geometric fact.
- [ ] 021 — Manual one-click face correction fallback.
- [ ] 022 — Manual obstacle correction fallback.
- [ ] 023 — Extra-photo support beyond the minimum three.
- [ ] 024 — Automatic photo-role classification.
- [ ] 025 — Duplicate/unrelated-photo detection.
- [ ] 026 — Video capture / frame extraction pathway.
- [ ] 027 — Photogrammetry / SfM pathway for difficult sites.
- [ ] 028 — Optional NeRF / Gaussian-splat reconstruction pathway.

## P1 — Universal PV layout solver
- [ ] 029 — Replace matrix-only placement with a real constraint solver.
- [ ] 030 — Automatic portrait/landscape comparison.
- [ ] 031 — Automatic enumeration of feasible matrices.
- [ ] 032 — Multi-objective scoring: capacity, symmetry, production, installation simplicity, aesthetics.
- [ ] 033 — Dynamic eave/ridge/rake/valley/obstacle clearances.
- [ ] 034 — Manufacturer/mounting-system-specific clearance rules.
- [ ] 035 — Centered partial final rows.
- [ ] 036 — Multiple independent blocks on one face.
- [ ] 037 — Multi-face allocation.
- [ ] 038 — Trapezoidal/triangular/hipped/irregular roof faces.
- [ ] 039 — Flat roofs with tilt and row spacing.
- [ ] 040 — Carports and canopies.
- [ ] 041 — Ground mounts.
- [ ] 042 — Facade PV.
- [ ] 043 — Agricultural/industrial roofs.
- [ ] 044 — Tile/slate/steel/zinc/membrane/fibre-cement support rules.
- [ ] 045 — Solar-yield objective as an optional optimization target.
- [ ] 046 — Shading-aware placement.

## P1 — Exact projection + photorealism
- [ ] 047 — Deterministic 3D panel geometry independent of the image model.
- [ ] 048 — Per-panel masks with real gaps.
- [ ] 049 — True camera projection of panel polygons.
- [ ] 050 — GPT Image used as photorealistic finishing layer, not geometry authority.
- [ ] 051 — Preserve all pixels outside the authorized edit corridor.
- [ ] 052 — Exact panel-count verification.
- [ ] 053 — Perspective/vanishing-line verification.
- [ ] 054 — Apparent-size verification from camera projection.
- [ ] 055 — Roof-contact / floating-panel verification.
- [ ] 056 — Lighting/reflection/contact-shadow matching.
- [ ] 057 — Local sharpness/noise/compression matching.
- [ ] 058 — High-resolution render then downsample when beneficial.
- [ ] 059 — Local photometric harmonization.
- [ ] 060 — Exact module texture/model library.
- [ ] 061 — Hybrid physically correct renderer + image-model finishing.

## P2 — Deterministic DP document engine
- [ ] 062 — DP1 fully GIS-derived.
- [ ] 063 — DP2 deterministic parcel/building/project plan.
- [ ] 064 — DP3 deterministic section from the Digital Twin.
- [ ] 065 — DP4 deterministic orthographic elevation + optional photorealistic companion.
- [ ] 066 — DP5 generated from exact equipment/mounting data.
- [ ] 067 — DP6 photomontage from exact projection + AI finishing.
- [ ] 068 — DP7/DP8 preserve original evidence photos.
- [ ] 069 — Auto camera-position/direction markers on DP1/DP2.
- [ ] 070 — Automatic regulatory legends and useful dimensions.
- [ ] 071 — Never publish an unsupported dimension.
- [ ] 072 — Common layout_id enforced across DP2/3/4/5/6.
- [ ] 073 — Whole-dossier graphical/textual consistency validation.
- [ ] 074 — Final PDF visual QA by rendering every page.
- [ ] 075 — Detect clipped text, blank imagery, missing pieces and page overflow.

## P2 — Official data and regulation engine
- [ ] 076 — Automatic geocoding and municipality identification.
- [ ] 077 — Automatic cadastral parcel/ref/area retrieval.
- [ ] 078 — Automatic main-building and annex detection on a parcel.
- [ ] 079 — Visual building chooser on multi-building parcels.
- [ ] 080 — PLU/PLUi document lookup.
- [ ] 081 — Urban zoning lookup.
- [ ] 082 — Local architectural-rule extraction.
- [ ] 083 — Historic-monument / ABF / protected-area detection.
- [ ] 084 — Authority-review prediction.
- [ ] 085 — Dynamic required-document engine.
- [ ] 086 — Official CERFA version monitoring/update pathway.
- [ ] 087 — Versioned regulatory rules with per-dossier provenance.
- [ ] 088 — Municipality-specific rule/template adapters where justified.

## P2 — Product/equipment knowledge
- [ ] 089 — Manufacturer module database.
- [ ] 090 — Mounting-system database.
- [ ] 091 — Auto-identify module specs from reference.
- [ ] 092 — Extract specs from uploaded manufacturer PDFs.
- [ ] 093 — Store dimensions/power/color/frame/manufacturer provenance.
- [ ] 094 — Inverter/microinverter support where documents require it.
- [ ] 095 — Physical battery support.
- [ ] 096 — Virtual battery as separate contractual/energy concept.

## P2 — Project/workflow universality
- [ ] 097 — Self-consumption without export.
- [ ] 098 — Self-consumption with surplus.
- [ ] 099 — Total sale.
- [ ] 100 — Collective self-consumption.
- [ ] 101 — Extension/modification of existing systems.
- [ ] 102 — Single-phase / three-phase context.
- [ ] 103 — Multi-zone projects.
- [ ] 104 — Multi-building projects.
- [ ] 105 — Future Enedis document engine.
- [ ] 106 — Future CONSUEL document engine.
- [ ] 107 — Single project data model feeding mairie/Enedis/CONSUEL/devis/installation outputs.

## P2 — Adaptive UX and capture
- [ ] 108 — Adaptive questionnaire: ask only what cannot be inferred.
- [ ] 109 — Reduce target input toward address + equipment + quantity + evidence.
- [ ] 110 — Guided photo capture instructions.
- [ ] 111 — Live capture-quality/coverage indicator.
- [ ] 112 — Targeted missing-evidence request instead of global rejection.
- [ ] 113 — “Select this roof face” visual control.
- [ ] 114 — “Correct obstacle” visual control.
- [ ] 115 — Real generation progress by stage.
- [ ] 116 — Per-stage elapsed time.
- [ ] 117 — Resume generation after browser close/crash.

## P2 — Validation architecture
- [ ] 118 — GeometryJudge.
- [ ] 119 — PhotoRealismJudge.
- [ ] 120 — RegulationJudge.
- [ ] 121 — DocumentJudge.
- [ ] 122 — Prefer deterministic checks over LLM checks whenever possible.
- [ ] 123 — Multi-model consensus only for ambiguous questions.
- [ ] 124 — Confidence-based escalation to targeted human confirmation.
- [ ] 125 — Cross-view geometric consistency.
- [ ] 126 — Cross-document textual consistency.
- [ ] 127 — Source provenance levels: measured/calculated/detected/estimated/assumed.
- [ ] 128 — Never present estimates as measurements.

## P3 — Testing, observability and learning
- [ ] 129 — Golden-case regression set.
- [ ] 130 — Real accepted-DP benchmark.
- [ ] 131 — Simple/medium/complex/adversarial scenario families.
- [ ] 132 — Automatic benchmark on every important change.
- [ ] 133 — Visual diff tooling.
- [ ] 134 — Geometric metrics in cm/%/IoU.
- [ ] 135 — Independent realism metrics.
- [ ] 136 — Anonymous error-class database.
- [ ] 137 — Convert mairie requests for additional information into generic rules, never address-specific hacks.
- [ ] 138 — Per-feature success/fallback regression monitoring.

## P3 — Cost and provider orchestration
- [ ] 139 — Provider abstraction for image models.
- [ ] 140 — Compare providers on the same deterministic mask.
- [ ] 141 — Multi-candidate generation only when QA requires it.
- [ ] 142 — Automatic best-candidate selection.
- [ ] 143 — Cost per dossier and per DP piece.
- [ ] 144 — Per-generation budget cap.
- [ ] 145 — Store provider request IDs, model versions and prompts without secrets.

## P3 — Industrial productization
- [ ] 146 — Project version history.
- [ ] 147 — Compare two DP6 generations side by side.
- [ ] 148 — Immutable source/output SHA-256 audit trail.
- [ ] 149 — Signed internal audit records.
- [ ] 150 — PDF archival/long-term compatibility strategy.
- [ ] 151 — Production feature rollout percentages.
- [ ] 152 — Automated rollback trigger on regression.
- [ ] 153 — Universal site-complexity score.
- [ ] 154 — Automatically select fast/3D/photogrammetry pipelines by complexity.
- [ ] 155 — Treat 5-second targeted human validation as preferable to unsafe automatic guessing.
- [ ] 156 — Target zero manual document retouching, not unsafe zero-human-input at all costs.

## Long-term target
PilotPaper should become a canonical digital solar-project engine:

**Official data + evidence vision → Roof Digital Twin → deterministic layout solver → exact camera projection → photorealistic finishing → deterministic QA → regulatory/document engines → multi-authority outputs.**

The roadmap will be expanded as implementation reveals additional generic requirements. Address-, building- or dossier-specific hacks are forbidden.
