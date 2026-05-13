/**
 * map.js - SVG日本地図 & 撮影ポイントマッピングモジュール
 */

const JAPAN = { minLat:24, maxLat:46, minLng:122, maxLng:149 };
let pinGroup = null, mapSvg = null, onPinClick = null;
const SVG_W = 500, SVG_H = 700;
let currentScale = 1, panX = 0, panY = 0;

function ll2svg(lat, lng) {
  return {
    x: ((lng - JAPAN.minLng) / (JAPAN.maxLng - JAPAN.minLng)) * SVG_W,
    y: ((JAPAN.maxLat - lat) / (JAPAN.maxLat - JAPAN.minLat)) * SVG_H
  };
}

const ISLANDS = {
  hokkaido: 'M350,60 L370,50 L395,55 L410,45 L425,50 L430,65 L440,80 L435,95 L420,100 L415,115 L400,120 L385,115 L375,105 L370,90 L360,85 L345,90 L335,80 L340,70 Z',
  honshu: 'M350,120 L365,115 L380,120 L390,130 L385,145 L375,155 L370,165 L380,175 L375,190 L365,200 L355,210 L340,215 L330,225 L320,240 L310,255 L295,265 L280,275 L265,285 L255,290 L240,295 L230,305 L220,315 L215,330 L220,345 L230,355 L240,348 L250,340 L260,335 L275,340 L290,335 L305,325 L310,315 L320,305 L330,295 L335,280 L340,265 L350,255 L360,245 L365,230 L370,215 L365,200 L370,185 L385,175 L380,160 L375,150 L385,135 Z',
  shikoku: 'M230,360 L250,350 L270,348 L285,355 L280,365 L265,370 L250,372 L235,370 Z',
  kyushu: 'M195,340 L210,335 L218,345 L215,360 L220,375 L215,390 L205,400 L195,410 L185,405 L180,390 L175,375 L180,360 L185,350 Z',
  okinawa: 'M130,520 L135,515 L140,520 L138,528 L132,525 Z'
};

function svgEl(tag, attrs) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

export function initMap(container, handler) {
  onPinClick = handler;
  mapSvg = svgEl('svg', { viewBox: `0 0 ${SVG_W} ${SVG_H}`, class: 'japan-map-svg' });
  mapSvg.style.cssText = 'width:100%;height:100%;';
  mapSvg.appendChild(svgEl('rect', { x:0,y:0,width:SVG_W,height:SVG_H,fill:'#0c1929',rx:8 }));

  const grid = svgEl('g', { opacity:'0.15' });
  for (let lat = 26; lat <= 44; lat += 2) {
    const p = ll2svg(lat, JAPAN.minLng), p2 = ll2svg(lat, JAPAN.maxLng);
    grid.appendChild(svgEl('line', { x1:p.x,y1:p.y,x2:p2.x,y2:p2.y,stroke:'#4a90d9','stroke-width':'0.5' }));
  }
  for (let lng = 124; lng <= 148; lng += 2) {
    const p = ll2svg(JAPAN.maxLat, lng), p2 = ll2svg(JAPAN.minLat, lng);
    grid.appendChild(svgEl('line', { x1:p.x,y1:p.y,x2:p2.x,y2:p2.y,stroke:'#4a90d9','stroke-width':'0.5' }));
  }
  mapSvg.appendChild(grid);

  const isl = svgEl('g', {});
  for (const [, d] of Object.entries(ISLANDS)) {
    isl.appendChild(svgEl('path', { d, fill:'#1a3a5c', stroke:'#2a6496', 'stroke-width':'1.5' }));
  }
  mapSvg.appendChild(isl);
  pinGroup = svgEl('g', {});
  mapSvg.appendChild(pinGroup);
  container.appendChild(mapSvg);
  setupTouch(container);
}

export function updatePins(photos) {
  if (!pinGroup) return;
  while (pinGroup.firstChild) pinGroup.removeChild(pinGroup.firstChild);
  for (const p of photos) {
    if (!p.lat || !p.lng) continue;
    const pos = ll2svg(p.lat, p.lng);
    const g = svgEl('g', { style:'cursor:pointer;', 'data-id': p.id });
    g.appendChild(svgEl('circle', { cx:pos.x,cy:pos.y,r:8,fill:'rgba(245,158,11,0.3)',class:'pin-glow' }));
    g.appendChild(svgEl('circle', { cx:pos.x,cy:pos.y,r:4,fill:'#f59e0b',stroke:'#fff','stroke-width':'1.5' }));
    g.addEventListener('click', () => { if (onPinClick) onPinClick(p); });
    pinGroup.appendChild(g);
  }
  const label = svgEl('text', { x:SVG_W-10,y:SVG_H-10,fill:'rgba(255,255,255,0.5)','font-size':'12','text-anchor':'end','font-family':'system-ui' });
  label.textContent = `📍 ${photos.filter(p=>p.lat&&p.lng).length} 地点`;
  pinGroup.appendChild(label);
}

function setupTouch(el) {
  let sd=0, ss=1, sx=0, sy=0, pan=false;
  el.addEventListener('touchstart', e => {
    if (e.touches.length===2) { sd=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY); ss=currentScale; }
    else if (e.touches.length===1) { pan=true; sx=e.touches[0].clientX-panX; sy=e.touches[0].clientY-panY; }
  }, {passive:true});
  el.addEventListener('touchmove', e => {
    if (e.touches.length===2&&sd>0) { const d=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY); currentScale=Math.max(0.5,Math.min(4,ss*(d/sd))); applyTf(); }
    else if (e.touches.length===1&&pan) { panX=e.touches[0].clientX-sx; panY=e.touches[0].clientY-sy; applyTf(); }
  }, {passive:true});
  el.addEventListener('touchend', ()=>{ pan=false; sd=0; }, {passive:true});
}

function applyTf() { if(mapSvg) { mapSvg.style.transform=`translate(${panX}px,${panY}px) scale(${currentScale})`; mapSvg.style.transformOrigin='center center'; } }

export function resetMapZoom() { currentScale=1; panX=0; panY=0; applyTf(); }
export function zoomIn() { currentScale=Math.min(4,currentScale*1.3); applyTf(); }
export function zoomOut() { currentScale=Math.max(0.5,currentScale/1.3); applyTf(); }
