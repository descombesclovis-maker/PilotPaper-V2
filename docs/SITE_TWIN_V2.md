# PilotPaper Site Twin V2

## Why V2 exists

PilotPaper must stop generating DP pieces from independent guesses. One physical project must be reconstructed once, reviewed once, and then reused by every document.

The current failure mode is structural: a selector can find one set of Google Solar faces, DP3 can independently rebuild another building/roof interpretation, and DP6 can ask vision to rediscover the roof again from photographs. A label such as `Pan C` is therefore not a reliable physical identity.

Site Twin V2 makes the site model the source of truth. Documents become renderers of the same model.

## Non-negotiable invariants

1. Address and cadastral property are resolved before roof analysis.
2. Target building identity is explicit and reviewable.
3. All physical roof faces are detected before any PV configuration is considered.
4. PV eligibility never deletes a real face. Every face remains visible with an explicit `fits / does not fit` state.
5. Physical face IDs are stable and never depend on A/B/C display order.
6. Google Solar is evidence/enrichment, never the cadastral authority and never the sole roof model.
7. One immutable Site Twin revision feeds DP1, DP2, DP3, DP4, DP5, DP6, DP7 and DP8.
8. A document cannot silently re-run roof understanding and invent a different building or different roof-face identity.
9. Roof Designer remains a last-resort geometry fallback, not the primary workflow.
10. Every user correction becomes a regression fixture so the same case cannot break again unnoticed.

## Architecture

### Stage 0 — Evidence Normalizer

Normalize every user photograph before any OpenAI or vision call:

- decode bytes and validate magic bytes;
- apply EXIF orientation;
- convert HEIC/unsupported formats to JPEG or PNG;
- strip malformed metadata;
- clamp dimensions/file size while preserving useful detail;
- compute SHA-256 digest;
- reject corrupted uploads before DP generation.

This stage prevents failures such as `image data does not represent a valid image` from reaching DP6.

### Stage 1 — Property Lock

Inputs: exact address.

Evidence hierarchy:

1. address point;
2. cadastral parcel geometry;
3. BD TOPO building footprints around the address;
4. orthophoto for visual confirmation.

Output: one property context with explicit target building IDs. Ambiguity must be shown to the user rather than guessed.

### Stage 2 — Site Twin Builder

Primary metric source when available: IGN LiDAR HD / MNS / MNH.

Process:

1. crop elevation/point-cloud evidence to the locked building footprint;
2. isolate building/roof points;
3. segment planar roof surfaces (RANSAC / region growing);
4. merge coplanar fragments;
5. compute intersections between planes to recover ridges, hips and valleys;
6. clip each plane to the building outline;
7. detect residual objects/obstacles;
8. cross-check with orthophoto and Google Solar metadata when available;
9. assign stable physical IDs;
10. compute confidence and provenance per face.

Fallback when LiDAR is unavailable: Google Solar + BD TOPO + orthophoto + vision reconstruction, but still into the same Site Twin schema.

### Stage 3 — Site Twin Inspector

The user sees the complete physical roof, not only currently compatible PV faces.

Required UI:

- target parcel highlighted;
- target building highlighted;
- every physical roof face outlined and labelled A/B/C/D...;
- incompatible faces remain visible but greyed/red with a reason;
- compatible faces are selectable;
- selected face is highlighted;
- optional quick corrections: exclude building, add/split/merge face, move a vertex;
- one-click `La maison et les pans sont corrects` confirmation.

This is **not** Roof Designer. It is a review/editor of the automatically generated Site Twin. Roof Designer is only used if metric geometry cannot be reconstructed at all.

### Stage 4 — Deterministic PV Layout

PV Layout receives Site Twin roof polygons and real module dimensions.

For every physical face it returns an explicit eligibility record:

- fits / does not fit;
- maximum module count;
- resolved rows/columns;
- resolved setbacks;
- reasons for incompatibility.

The requested configuration is then laid out mathematically on selected physical faces. Generative AI never chooses coordinates.

### Stage 5 — Camera Registration

User photos are registered to the Site Twin.

Automatic path:

- roof/building feature matching;
- vanishing-line / ridge / eave constraints;
- camera pose or roof-plane homography estimation;
- reprojection error measurement.

Fallback path: four quick correspondence clicks on the target roof plane. This fallback is much lighter than redrawing a roof and preserves the same Site Twin geometry.

### Stage 6 — DP renderers

All pieces receive `(siteTwinRevision, pvLayoutSnapshot)`.

- DP1: official location map + locked parcel/project marker.
- DP2: parcel + building + exact PV layout in orthographic plan.
- DP3: true section through the Site Twin mesh/roof planes. No Google Solar re-detection.
- DP4: elevations/roof appearance derived from the same model.
- DP5: before/after roof representation from the same scene.
- DP6: project the exact PV polygons into the registered photograph, then render/refine only inside the locked mask.
- DP7/DP8: normalized original photographs with required presentation/annotations; no unrelated generative modification.

No renderer is allowed to resolve a new parcel, new building, or new roof-face list.

### Stage 7 — PilotPaper Inspector V2

Inspector compares every output against the Site Twin and PV Layout snapshot:

- exact module count;
- exact selected face IDs;
- module polygons inside roof polygons;
- setbacks;
- perspective reprojection error;
- building preservation;
- cross-piece consistency;
- parcel/building identity;
- all dimensions and annotations agree across DP2/DP3/DP4/DP5/DP6.

Critical failure rejects the piece and retries only the failing renderer. Geometry is never regenerated to make a render pass.

## Screenshot-to-regression loop

A user screenshot must create a durable lesson, not a one-off patch.

For every reported failure PilotPaper stores a fixture containing:

- address and normalized property context;
- source evidence digests;
- Site Twin revision;
- expected building IDs;
- expected physical roof-face count;
- expected selected face(s);
- PV configuration;
- failing DP number;
- expected invariant that was violated;
- screenshot/reference note.

Every core change replays all fixtures. A fix is accepted only if the new case passes and previous cases remain green.

## Azé regression case

The current 110 Rue Basse, 71260 Azé case becomes an explicit V2 regression:

- the addressed house is locked before Google Solar;
- the L-shaped roof must expose all physical roof faces before PV filtering;
- the expected physical face count must be recorded after Site Twin ground-truth confirmation;
- a 2x6 / 12-module configuration may mark faces incompatible, but cannot make physical faces disappear;
- DP3 must slice the same Site Twin used by the selector;
- DP6 must use the same selected physical face and normalized source images.

## Source priority

Metric geometry priority:

1. user-confirmed Site Twin correction;
2. IGN LiDAR HD / elevation-derived geometry;
3. BD TOPO footprint + metric orthophoto constraints;
4. Google Solar roof-plane metadata;
5. vision inference from imagery;
6. Roof Designer last resort.

Visual appearance priority:

1. user photographs;
2. IGN orthophoto;
3. deterministic render from geometry;
4. constrained generative refinement inside a fixed mask only.

## Release rule

Site Twin V2 stays isolated on `feature/site-twin-v2` until:

- the Azé case is correct;
- simple 2-pitch reference houses are correct;
- L/T/U-shaped residential roofs are correct;
- DP2 and DP3 derive from one model;
- DP6 camera registration is stable;
- all existing regression cases pass.

Only then may the Windows validation branch consume V2.
