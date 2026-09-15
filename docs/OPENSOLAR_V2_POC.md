# PilotPaper V2 — OpenSolar POC

## Safety boundary

- PilotPaper V1 is frozen on branch `release/v1`.
- All OpenSolar work happens only on `release/v2`.
- OpenSolar is disabled by default with `OPENSOLAR_ENABLED=false`.
- The existing PilotPaper path remains the fallback until OpenSolar is validated on real French projects.

## Goal

Use OpenSolar as a candidate source of geometric truth for roof facets and photovoltaic layout, not as a replacement for PilotPaper's French DP workflow.

Target truth object:

- official/project address
- roof facet GeoJSON (`autoFacetsGeoJson`)
- auto-design GeoJSON when available
- scene origin
- system/module groups
- module quantity
- azimuth
- slope
- portrait/landscape layout

PilotPaper will compare these data against its current DP2/K-par-k result before any production switchover.

## Required OpenSolar access

The POC requires **Raw Data API Access**, because the Project `design` field is only populated on that plan. A 30-day trial is currently available from OpenSolar.

Local-only environment variables:

```env
OPENSOLAR_ENABLED=false
OPENSOLAR_ORG_ID=12345
OPENSOLAR_BEARER_TOKEN=secret-token
```

Never commit the bearer token and never expose it to browser code.

## Implemented POC endpoints

### Connection status

`GET /api/opensolar/status`

Returns connection/configuration state without exposing secrets.

### Project truth

`GET /api/opensolar/project-truth?projectId=<OPEN_SOLAR_PROJECT_ID>`

Reads:

- Project Details
- System Details
- compressed Raw Data `design`

Then extracts roof facets and module-group facts into a small PilotPaper-owned truth object.

## Acceptance gate before integration

OpenSolar does **not** become the production geometry engine merely because the API responds.

For at least 5–10 French test houses, compare:

1. target building identity
2. number of roof facets
3. facet outlines
4. slope
5. azimuth
6. obstacles/usable area where available
7. module quantity
8. module orientation
9. panel placement consistency
10. usefulness for DP2 → DP3 → DP4 → DP5 → DP6

Only after those comparisons pass do we set `OPENSOLAR_ENABLED=true` and wire its truth object into the DP generation chain.
