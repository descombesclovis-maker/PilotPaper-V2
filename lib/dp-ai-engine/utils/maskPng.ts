import { deflateSync } from "node:zlib";
import type { Point2D } from "../types";

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buf) {
    crc ^= byte;
    for (let k=0;k<8;k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const t = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t,data])));
  return Buffer.concat([len,t,data,crc]);
}
function pointInPolygon(x:number,y:number,p:Point2D[]):boolean {
  let inside=false;
  for(let i=0,j=p.length-1;i<p.length;j=i++){
    const pi=p[i]!, pj=p[j]!;
    const xi=pi.x, yi=pi.y, xj=pj.x, yj=pj.y;
    const hit=((yi>y)!=(yj>y)) && (x < (xj-xi)*(y-yi)/((yj-yi)||1e-12)+xi);
    if(hit) inside=!inside;
  }
  return inside;
}

/** Reads dimensions from a PNG input and creates an RGBA PNG mask.
 * Outside selected roof plane = opaque; selected roof plane = transparent/editable.
 */
export function buildRoofMaskForPng(inputBase64:string, polygon:Point2D[]):string | undefined {
  if (!polygon || polygon.length < 3) return undefined;
  const src=Buffer.from(inputBase64,"base64");
  const sig=Buffer.from([137,80,78,71,13,10,26,10]);
  if(src.length<24 || !src.subarray(0,8).equals(sig)) return undefined;
  const width=src.readUInt32BE(16), height=src.readUInt32BE(20);
  if(!width || !height || width*height > 40_000_000) return undefined;

  const scanline=width*4+1;
  const raw=Buffer.alloc(scanline*height);
  const pts=polygon.map(q=>({x:q.x*width,y:q.y*height}));
  for(let y=0;y<height;y++){
    const row=y*scanline; raw[row]=0;
    for(let x=0;x<width;x++){
      const o=row+1+x*4;
      raw[o]=0; raw[o+1]=0; raw[o+2]=0;
      raw[o+3]=pointInPolygon(x+0.5,y+0.5,pts)?0:255;
    }
  }
  const ihdr=Buffer.alloc(13);
  ihdr.writeUInt32BE(width,0); ihdr.writeUInt32BE(height,4);
  ihdr[8]=8; ihdr[9]=6; ihdr[10]=0; ihdr[11]=0; ihdr[12]=0;
  return Buffer.concat([sig,chunk("IHDR",ihdr),chunk("IDAT",deflateSync(raw,{level:6})),chunk("IEND",Buffer.alloc(0))]).toString("base64");
}


/** Creates an OpenAI edit mask where ONLY the supplied panel polygons are transparent/editable. */
export function buildPanelIslandsMaskForPng(inputBase64:string, polygons:Point2D[][], paddingNormalized=0.002):string | undefined {
  if (!polygons.length) return undefined;
  const src=Buffer.from(inputBase64,"base64");
  const sig=Buffer.from([137,80,78,71,13,10,26,10]);
  if(src.length<24 || !src.subarray(0,8).equals(sig)) return undefined;
  const width=src.readUInt32BE(16), height=src.readUInt32BE(20);
  if(!width || !height || width*height > 40_000_000) return undefined;
  const padX=paddingNormalized*width, padY=paddingNormalized*height;
  const expanded=polygons.map(poly=>{
    const cx=poly.reduce((a,p)=>a+p.x,0)/poly.length, cy=poly.reduce((a,p)=>a+p.y,0)/poly.length;
    return poly.map(p=>({x:p.x + Math.sign(p.x-cx)*(padX/width), y:p.y + Math.sign(p.y-cy)*(padY/height)}));
  });
  const pxPolys=expanded.map(poly=>poly.map(q=>({x:q.x*width,y:q.y*height})));
  const scanline=width*4+1;
  const raw=Buffer.alloc(scanline*height);
  for(let y=0;y<height;y++){
    const row=y*scanline; raw[row]=0;
    for(let x=0;x<width;x++){
      const o=row+1+x*4;
      raw[o]=0; raw[o+1]=0; raw[o+2]=0;
      const editable=pxPolys.some(poly=>pointInPolygon(x+0.5,y+0.5,poly));
      raw[o+3]=editable?0:255;
    }
  }
  const ihdr=Buffer.alloc(13);
  ihdr.writeUInt32BE(width,0); ihdr.writeUInt32BE(height,4);
  ihdr[8]=8; ihdr[9]=6; ihdr[10]=0; ihdr[11]=0; ihdr[12]=0;
  return Buffer.concat([sig,chunk("IHDR",ihdr),chunk("IDAT",deflateSync(raw,{level:6})),chunk("IEND",Buffer.alloc(0))]).toString("base64");
}
