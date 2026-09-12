import { deflateSync, inflateSync } from "node:zlib";
import type { Point2D } from "../types";

type DecodedPng={width:number;height:number;rgba:Uint8Array};
const SIG=Buffer.from([137,80,78,71,13,10,26,10]);

function paeth(a:number,b:number,c:number){const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c;}
function crc32(buf:Buffer):number{let crc=0xffffffff;for(const byte of buf){crc^=byte;for(let k=0;k<8;k++)crc=(crc>>>1)^(0xedb88320&-(crc&1));}return(crc^0xffffffff)>>>0;}
function chunk(type:string,data:Buffer):Buffer{const t=Buffer.from(type,"ascii"),len=Buffer.alloc(4),crc=Buffer.alloc(4);len.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(Buffer.concat([t,data])));return Buffer.concat([len,t,data,crc]);}

export function decodePng(base64:string):DecodedPng{
  const src=Buffer.from(base64,"base64");
  if(src.length<33||!src.subarray(0,8).equals(SIG))throw new Error("Strict compositor requires PNG input.");
  let off=8,width=0,height=0,bitDepth=0,colorType=-1,interlace=0;const idat:Buffer[]=[];let palette:Buffer|undefined,trns:Buffer|undefined;
  while(off+12<=src.length){const len=src.readUInt32BE(off),type=src.subarray(off+4,off+8).toString("ascii"),data=src.subarray(off+8,off+8+len);off+=12+len;
    if(type==="IHDR"){width=data.readUInt32BE(0);height=data.readUInt32BE(4);bitDepth=data[8]!;colorType=data[9]!;interlace=data[12]!;}
    else if(type==="IDAT")idat.push(data);else if(type==="PLTE")palette=data;else if(type==="tRNS")trns=data;else if(type==="IEND")break;
  }
  if(!width||!height||bitDepth!==8||interlace!==0)throw new Error("Unsupported PNG format for strict compositor (requires 8-bit non-interlaced PNG).");
  const channels=colorType===0?1:colorType===2?3:colorType===3?1:colorType===4?2:colorType===6?4:0;if(!channels)throw new Error(`Unsupported PNG color type ${colorType}.`);
  const stride=width*channels,raw=inflateSync(Buffer.concat(idat));if(raw.length<(stride+1)*height)throw new Error("Truncated PNG pixel stream.");
  const pixels=Buffer.alloc(stride*height);let inOff=0;
  for(let y=0;y<height;y++){const filter=raw[inOff++]!,row=y*stride,prev=(y-1)*stride;for(let x=0;x<stride;x++){const value=raw[inOff++]!,a=x>=channels?pixels[row+x-channels]!:0,b=y>0?pixels[prev+x]!:0,c=y>0&&x>=channels?pixels[prev+x-channels]!:0;let out=value;if(filter===1)out=(value+a)&255;else if(filter===2)out=(value+b)&255;else if(filter===3)out=(value+Math.floor((a+b)/2))&255;else if(filter===4)out=(value+paeth(a,b,c))&255;else if(filter!==0)throw new Error(`Unsupported PNG filter ${filter}.`);pixels[row+x]=out;}}
  const rgba=new Uint8Array(width*height*4);
  for(let i=0,p=0;i<width*height;i++,p+=4){const s=i*channels;
    if(colorType===6){rgba[p]=pixels[s]!;rgba[p+1]=pixels[s+1]!;rgba[p+2]=pixels[s+2]!;rgba[p+3]=pixels[s+3]!;}
    else if(colorType===2){rgba[p]=pixels[s]!;rgba[p+1]=pixels[s+1]!;rgba[p+2]=pixels[s+2]!;rgba[p+3]=255;}
    else if(colorType===0){const g=pixels[s]!;rgba[p]=g;rgba[p+1]=g;rgba[p+2]=g;rgba[p+3]=255;}
    else if(colorType===4){const g=pixels[s]!;rgba[p]=g;rgba[p+1]=g;rgba[p+2]=g;rgba[p+3]=pixels[s+1]!;}
    else {const idx=pixels[s]!,pi=idx*3;if(!palette||pi+2>=palette.length)throw new Error("Invalid indexed PNG palette.");rgba[p]=palette[pi]!;rgba[p+1]=palette[pi+1]!;rgba[p+2]=palette[pi+2]!;rgba[p+3]=trns&&idx<trns.length?trns[idx]!:255;}
  }
  return{width,height,rgba};
}

export function encodePng(width:number,height:number,rgba:Uint8Array):string{
  if(rgba.length!==width*height*4)throw new Error("Invalid RGBA buffer length.");const stride=width*4+1,raw=Buffer.alloc(stride*height);
  for(let y=0;y<height;y++){const ro=y*stride;raw[ro]=0;Buffer.from(rgba.buffer,rgba.byteOffset+y*width*4,width*4).copy(raw,ro+1);}
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(width,0);ihdr.writeUInt32BE(height,4);ihdr[8]=8;ihdr[9]=6;ihdr[10]=0;ihdr[11]=0;ihdr[12]=0;
  return Buffer.concat([SIG,chunk("IHDR",ihdr),chunk("IDAT",deflateSync(raw,{level:6})),chunk("IEND",Buffer.alloc(0))]).toString("base64");
}

function inside(x:number,y:number,p:Point2D[]){let yes=false;for(let i=0,j=p.length-1;i<p.length;j=i++){const a=p[i]!,b=p[j]!;if(((a.y>y)!=(b.y>y))&&(x<(b.x-a.x)*(y-a.y)/((b.y-a.y)||1e-12)+a.x))yes=!yes;}return yes;}
function expand(polys:Point2D[][],pad=.002){return polys.map(poly=>{const cx=poly.reduce((s,p)=>s+p.x,0)/poly.length,cy=poly.reduce((s,p)=>s+p.y,0)/poly.length;return poly.map(p=>({x:Math.max(0,Math.min(1,p.x+Math.sign(p.x-cx)*pad)),y:Math.max(0,Math.min(1,p.y+Math.sign(p.y-cy)*pad))}));});}

function resizeRgba(src:DecodedPng,targetWidth:number,targetHeight:number):Uint8Array{
  if(src.width===targetWidth&&src.height===targetHeight)return src.rgba;
  const out=new Uint8Array(targetWidth*targetHeight*4);
  for(let y=0;y<targetHeight;y++){
    const fy=Math.max(0,Math.min(src.height-1,(y+.5)*src.height/targetHeight-.5));
    const y0=Math.floor(fy),y1=Math.min(src.height-1,y0+1),wy=fy-y0;
    for(let x=0;x<targetWidth;x++){
      const fx=Math.max(0,Math.min(src.width-1,(x+.5)*src.width/targetWidth-.5));
      const x0=Math.floor(fx),x1=Math.min(src.width-1,x0+1),wx=fx-x0;
      const di=(y*targetWidth+x)*4;
      const i00=(y0*src.width+x0)*4,i10=(y0*src.width+x1)*4,i01=(y1*src.width+x0)*4,i11=(y1*src.width+x1)*4;
      for(let c=0;c<4;c++){
        const top=src.rgba[i00+c]!*(1-wx)+src.rgba[i10+c]!*wx;
        const bottom=src.rgba[i01+c]!*(1-wx)+src.rgba[i11+c]!*wx;
        out[di+c]=Math.max(0,Math.min(255,Math.round(top*(1-wy)+bottom*wy)));
      }
    }
  }
  return out;
}

function candidatePixelsAtSourceSize(original:DecodedPng,candidate:DecodedPng):Uint8Array{
  if(original.width===candidate.width&&original.height===candidate.height)return candidate.rgba;
  const originalRatio=original.width/original.height,candidateRatio=candidate.width/candidate.height;
  const ratioError=Math.abs(candidateRatio-originalRatio)/originalRatio;
  if(ratioError>.02)throw new Error(`AI edit changed image aspect ratio too much (${original.width}x${original.height} -> ${candidate.width}x${candidate.height}).`);
  return resizeRgba(candidate,original.width,original.height);
}

/** Pixel-level safety net: every pixel outside the exact panel islands is copied from the immutable source PNG. */
export function strictCompositePng(originalBase64:string,candidateBase64:string,polygons:Point2D[][],paddingNormalized=.002):string{
  const a=decodePng(originalBase64),b=decodePng(candidateBase64),candidateRgba=candidatePixelsAtSourceSize(a,b);
  const allowed=expand(polygons,paddingNormalized),out=new Uint8Array(a.rgba);
  for(let y=0;y<a.height;y++)for(let x=0;x<a.width;x++){const nx=(x+.5)/a.width,ny=(y+.5)/a.height;if(!allowed.some(p=>inside(nx,ny,p)))continue;const i=(y*a.width+x)*4;out[i]=candidateRgba[i]!;out[i+1]=candidateRgba[i+1]!;out[i+2]=candidateRgba[i+2]!;out[i+3]=candidateRgba[i+3]!;}
  return encodePng(a.width,a.height,out);
}

/** Crop a PNG around the union of normalized polygons, with normalized image margin. */
export function cropPngAroundPolygons(base64:string,polygons:Point2D[][],marginNormalized=.06):string{
  const src=decodePng(base64);if(!polygons.length)throw new Error("Cannot crop without polygons.");
  const pts=polygons.flat();let minX=Math.min(...pts.map(p=>p.x)),maxX=Math.max(...pts.map(p=>p.x)),minY=Math.min(...pts.map(p=>p.y)),maxY=Math.max(...pts.map(p=>p.y));
  minX=Math.max(0,minX-marginNormalized);maxX=Math.min(1,maxX+marginNormalized);minY=Math.max(0,minY-marginNormalized);maxY=Math.min(1,maxY+marginNormalized);
  let x0=Math.max(0,Math.floor(minX*src.width)),x1=Math.min(src.width,Math.ceil(maxX*src.width)),y0=Math.max(0,Math.floor(minY*src.height)),y1=Math.min(src.height,Math.ceil(maxY*src.height));
  if(x1<=x0||y1<=y0)throw new Error("Invalid crop bounds.");
  const w=x1-x0,h=y1-y0,out=new Uint8Array(w*h*4);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const si=((y0+y)*src.width+(x0+x))*4,di=(y*w+x)*4;out[di]=src.rgba[si]!;out[di+1]=src.rgba[si+1]!;out[di+2]=src.rgba[si+2]!;out[di+3]=src.rgba[si+3]!;}
  return encodePng(w,h,out);
}

/**
 * Deterministic QA overlay: paints panel polygons over the immutable satellite
 * PNG so a second vision model can judge the chosen building/roof without
 * being allowed to change geometry.
 */
export function annotatePngWithPanelPolygons(base64:string,polygons:Point2D[][]):string{
  const src=decodePng(base64);
  if(!polygons.length)throw new Error("Cannot annotate satellite image without panel polygons.");
  const out=new Uint8Array(src.rgba);
  for(let y=0;y<src.height;y++)for(let x=0;x<src.width;x++){
    const nx=(x+.5)/src.width,ny=(y+.5)/src.height;
    if(!polygons.some(poly=>inside(nx,ny,poly)))continue;
    const i=(y*src.width+x)*4;
    out[i]=Math.round(out[i]!*0.28+18*0.72);
    out[i+1]=Math.round(out[i+1]!*0.28+63*0.72);
    out[i+2]=Math.round(out[i+2]!*0.28+105*0.72);
    out[i+3]=255;
  }
  return encodePng(src.width,src.height,out);
}
