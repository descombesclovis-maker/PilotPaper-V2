import assert from "node:assert/strict";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({
  appType: "custom",
  configFile: false,
  root,
  resolve: { alias: { "@": root } },
  server: { middlewareMode: true },
});
after(async () => { await vite.close(); });

const pixelsPromise = vite.ssrLoadModule("/lib/dp-ai-engine/utils/pngPixels.ts");

function rgba(width, height, rgb) {
  const output = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    output[i * 4] = rgb;
    output[i * 4 + 1] = rgb;
    output[i * 4 + 2] = rgb;
    output[i * 4 + 3] = 255;
  }
  return output;
}

test("strict compositor restores every source pixel outside the authorized PV island", async () => {
  const { encodePng, decodePng, strictCompositePng } = await pixelsPromise;
  const width = 100;
  const height = 80;
  const source = encodePng(width, height, rgba(width, height, 40));
  const candidate = encodePng(width, height, rgba(width, height, 220));
  const polygon = [[
    { x: 0.35, y: 0.30 },
    { x: 0.65, y: 0.30 },
    { x: 0.65, y: 0.70 },
    { x: 0.35, y: 0.70 },
  ]];
  const output = decodePng(strictCompositePng(source, candidate, polygon, 0));

  const outside = (10 * width + 10) * 4;
  const inside = (40 * width + 50) * 4;
  assert.equal(output.rgba[outside], 40, "building pixel outside mask must be restored from source");
  assert.equal(output.rgba[inside], 220, "candidate rendering must survive inside the authorized panel island");
});

test("strict compositor preserves original image dimensions even when AI candidate size changes", async () => {
  const { encodePng, decodePng, strictCompositePng } = await pixelsPromise;
  const source = encodePng(100, 80, rgba(100, 80, 60));
  const candidate = encodePng(200, 160, rgba(200, 160, 180));
  const polygon = [[
    { x: 0.4, y: 0.4 }, { x: 0.6, y: 0.4 }, { x: 0.6, y: 0.6 }, { x: 0.4, y: 0.6 },
  ]];
  const output = decodePng(strictCompositePng(source, candidate, polygon, 0));
  assert.equal(output.width, 100);
  assert.equal(output.height, 80);
});

test("strict compositor rejects a materially different candidate aspect ratio", async () => {
  const { encodePng, strictCompositePng } = await pixelsPromise;
  const source = encodePng(100, 80, rgba(100, 80, 60));
  const candidate = encodePng(200, 100, rgba(200, 100, 180));
  const polygon = [[
    { x: 0.4, y: 0.4 }, { x: 0.6, y: 0.4 }, { x: 0.6, y: 0.6 }, { x: 0.4, y: 0.6 },
  ]];
  assert.throws(() => strictCompositePng(source, candidate, polygon, 0), /aspect ratio too much/);
});
