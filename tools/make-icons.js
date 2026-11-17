const zlib=require('zlib'),fs=require('fs');
function crc(buf){let c,t=[];for(let n=0;n<256;n++){c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;t[n]=c>>>0}let x=0xffffffff;for(const b of buf)x=t[(x^b)&255]^(x>>>8);return (x^0xffffffff)>>>0}
function chunk(type,data){const l=Buffer.alloc(4);l.writeUInt32BE(data.length);const td=Buffer.concat([Buffer.from(type),data]);const c=Buffer.alloc(4);c.writeUInt32BE(crc(td));return Buffer.concat([l,td,c])}
function png(w,h,rgba){const raw=Buffer.alloc((w*4+1)*h);for(let y=0;y<h;y++){raw[y*(w*4+1)]=0;rgba.copy(raw,y*(w*4+1)+1,y*w*4,(y+1)*w*4)}
const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(w,0);ihdr.writeUInt32BE(h,4);ihdr[8]=8;ihdr[9]=6;
return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',zlib.deflateSync(raw)),chunk('IEND',Buffer.alloc(0))])}
function rrect(x,y,x0,y0,x1,y1,r){const cx=(x0+x1)/2,cy=(y0+y1)/2,hx=(x1-x0)/2-r,hy=(y1-y0)/2-r;const dx=Math.abs(x-cx)-hx,dy=Math.abs(y-cy)-hy;return Math.hypot(Math.max(dx,0),Math.max(dy,0))+Math.min(Math.max(dx,dy),0)-r}
function render(size,{rounded,scale}){const SS=3,buf=Buffer.alloc(size*size*4);
for(let py=0;py<size;py++)for(let px=0;px<size;px++){let R=0,G=0,B=0,A=0;
for(let sy=0;sy<SS;sy++)for(let sx=0;sx<SS;sx++){
const u=(px+(sx+.5)/SS)/size,v=(py+(sy+.5)/SS)/size;
let inside=rounded?rrect(u,v,0,0,1,1,.22)<0:true;
if(!inside)continue;
const t=(u+v)/2;let r=230+(150-230)*t,g=36+(16-36)*t,b=36+(16-36)*t;
// glyph
const gu=(u-.5)/scale+.5,gv=(v-.5)/scale+.5;
if(rrect(gu,gv,.29,.18,.71,.80,.05)<0){r=g=b=255;
const bars=[[.36,.30,.64,.34],[.36,.40,.64,.44],[.36,.50,.58,.54]];
for(const [a,c,d,e] of bars) if(gu>=a&&gu<=d&&gv>=c&&gv<=e){r=200;g=24;b=24}
if(rrect(gu,gv,.36,.61,.64,.71,.03)<0){r=22;g=163;b=106}}
R+=r;G+=g;B+=b;A+=255}
const n=SS*SS,o=(py*size+px)*4;buf[o]=A?R/(A/255):0;buf[o+1]=A?G/(A/255):0;buf[o+2]=A?B/(A/255):0;buf[o+3]=A/n}
return png(size,size,buf)}
const out='../assets/icons/';
fs.writeFileSync(out+'icon-192.png',render(192,{rounded:true,scale:1}));
fs.writeFileSync(out+'icon-512.png',render(512,{rounded:true,scale:1}));
fs.writeFileSync(out+'icon-maskable-512.png',render(512,{rounded:false,scale:.75}));
fs.writeFileSync(out+'apple-touch-icon.png',render(180,{rounded:false,scale:.9}));
fs.writeFileSync(out+'icon.svg',`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#DC2626"/><stop offset="1" stop-color="#B91C1C"/></linearGradient></defs><rect width="512" height="512" rx="112" fill="url(#g)"/><rect x="148" y="92" width="216" height="318" rx="26" fill="#fff"/><rect x="184" y="154" width="144" height="20" rx="6" fill="#DC2626"/><rect x="184" y="205" width="144" height="20" rx="6" fill="#DC2626"/><rect x="184" y="256" width="100" height="20" rx="6" fill="#DC2626"/><rect x="184" y="312" width="144" height="51" rx="15" fill="#16A36A"/></svg>`);
