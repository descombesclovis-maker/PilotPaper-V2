import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const selector = await readFile(new URL("../components/roof-face-selector.tsx", import.meta.url), "utf8");
const workbench = await readFile(new URL("../components/dp-piece-workbench.tsx", import.meta.url), "utf8");
const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const bridge = await readFile(new URL("../components/site-twin-address-bridge.tsx", import.meta.url), "utf8");
const roofFacesRoute = await readFile(new URL("../app/api/dp-piece/roof-faces/route.ts", import.meta.url), "utf8");
const dpRoute = await readFile(new URL("../app/api/dp-piece/route.ts", import.meta.url), "utf8");
const launcher = await readFile(new URL("../desktop/PilotPaperLauncher/Program.cs", import.meta.url), "utf8");
const windowsWorkflow = await readFile(new URL("../.github/workflows/build-v1-k-par-k-windows.yml", import.meta.url), "utf8");

test("roof selection is click-native, marker-free and supports several user-selected faces", () => {
  assert.match(selector, /Cliquez directement sur le ou les pans que vous souhaitez équiper/);
  assert.match(selector, /Aucun numéro, cercle technique ou centre de pan n&apos;est affiché/);
  assert.match(selector, /nearestFaceAt\(x, y, rect\)/);
  assert.match(selector, /setLastClick\(\{ x, y \}\)/);
  assert.match(selector, /next\.add\(face\.id\)/);
  assert.doesNotMatch(selector, /faces\.map\(\(face\) => \{[\s\S]*?<button/);
  assert.match(workbench, /ROOF_FACE_SEPARATOR = ";;"/);
  assert.match(workbench, /faceIds\.join\(ROOF_FACE_SEPARATOR\)/);
  assert.match(dpRoute, /split\(ROOF_FACE_SEPARATOR\)/);
  assert.match(dpRoute, /displayFaceId\)\.join\(", "\)/);
});

test("roof aerial view is framed from the locked cadastral parcel rather than arbitrary roof candidates", () => {
  assert.match(roofFacesRoute, /function frameAroundParcel/);
  assert.match(roofFacesRoute, /parcelRings\(target\.parcel\.parcelGeometry\)/);
  assert.match(roofFacesRoute, /const frame = frameAroundParcel\(target\)/);
});

test("Site Twin is hidden from normal UX and is prewarmed from the shared form address", () => {
  assert.doesNotMatch(page, /SiteTwinDebugger/);
  assert.match(page, /SiteTwinAddressBridge/);
  assert.match(bridge, /pilotpaper-v1-k-par-k-draft/);
  assert.match(bridge, /\/api\/site-twin-v2\/reconstruct/);
});

test("Windows package embeds and automatically starts the Geometry Engine before opening the app", () => {
  assert.match(windowsWorkflow, /Build bundled Geometry Engine/);
  assert.match(windowsWorkflow, /PilotPaper-GeometryEngine\.exe/);
  assert.match(windowsWorkflow, /geometry-engine\/\*\*/);
  assert.match(launcher, /StartGeometryEngine\(\)/);
  assert.match(launcher, /WaitUntilGeometryReadyAsync/);
  assert.match(launcher, /GeometryHealthUrl = "http:\/\/127\.0\.0\.1:8765\/health"/);
  assert.match(launcher, /PILOTPAPER_GEOMETRY_ENGINE_URL/);
});
