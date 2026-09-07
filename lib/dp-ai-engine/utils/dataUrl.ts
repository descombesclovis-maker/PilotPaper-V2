import type { InputPhoto } from "../types";
export const toDataUrl = (p: InputPhoto) => `data:${p.mimeType};base64,${p.base64}`;
