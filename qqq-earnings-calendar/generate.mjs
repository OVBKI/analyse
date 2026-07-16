#!/usr/bin/env node
/*
 * MB TRADING — Générateur du calendrier hebdomadaire des résultats QQQ (Nasdaq-100).
 *
 * Usage:
 *   node generate.mjs --data week-data.json --out mb_trading_calendrier.png
 *
 * Pipeline: lit les données de la semaine (JSON) -> récupère les logos (favicons
 * officiels via recherche d'image) avec fallback monogramme -> assemble un dashboard
 * HTML (polices embarquées) -> rend via Chromium headless en 2x -> recadre au contenu.
 *
 * Dépendances runtime: node, un binaire Chromium, python3 + Pillow (auto-installé).
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execSync, execFileSync } from 'node:child_process';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));

// ---- args ----
const argv = process.argv.slice(2);
function arg(name, def){ const i = argv.indexOf('--'+name); return i>=0 ? argv[i+1] : def; }
const DATA = resolve(arg('data', join(__dir, 'week-data.json')));
const OUT  = resolve(arg('out',  join(__dir, 'mb_trading_calendrier.png')));

const data = JSON.parse(readFileSync(DATA, 'utf8'));
const fonts = readFileSync(join(__dir, 'fonts-embedded.css'), 'utf8');

// ---- locate chromium ----
function findChrome(){
  if (process.env.CHROME && existsSync(process.env.CHROME)) return process.env.CHROME;
  const globs = [
    '/opt/pw-browsers/chromium-*/chrome-linux/chrome',
    '/opt/pw-browsers/chromium/chrome-linux/chrome',
  ];
  for (const g of globs){
    try {
      const hit = execSync(`ls -1 ${g} 2>/dev/null | head -1`, {encoding:'utf8'}).trim();
      if (hit && existsSync(hit)) return hit;
    } catch {}
  }
  for (const c of ['google-chrome','chromium','chromium-browser']){
    try { return execSync(`command -v ${c}`, {encoding:'utf8'}).trim(); } catch {}
  }
  throw new Error('Chromium introuvable (définir la variable CHROME).');
}

// ---- logo fetch (favicon via image search) -> data URI, sinon null ----
function fetchLogo(domain){
  if (!domain) return null;
  const tmp = join(__dir, `.logo_${domain.replace(/\W/g,'_')}`);
  const urls = [
    `https://logo.clearbit.com/${domain}?size=256`,
    `https://www.google.com/s2/favicons?domain=${domain}&sz=256`,
  ];
  for (const url of urls){
    try {
      execSync(`curl -sSL --max-time 25 -A "Mozilla/5.0" "${url}" -o "${tmp}"`, {stdio:'ignore'});
      const buf = readFileSync(tmp);
      if (buf.length < 500) continue;
      const sig = buf.subarray(0,4).toString('hex');
      let mime = null;
      if (sig.startsWith('89504e47')) mime = 'image/png';
      else if (sig.startsWith('ffd8')) mime = 'image/jpeg';
      else if (buf.subarray(0,4).toString('ascii')==='RIFF') mime = 'image/webp';
      else if (buf.subarray(0,5).toString('ascii')==='<?xml' || buf.subarray(0,4).toString('ascii')==='<svg') mime = 'image/svg+xml';
      if (!mime) continue;
      return `data:${mime};base64,${buf.toString('base64')}`;
    } catch {}
  }
  return null;
}

// ---- heatmap helpers ----
const HEAT = { fort:{c:'#ff4d4d',name:'Fort'}, moyen:{c:'#ffb020',name:'Moyen'}, faible:{c:'#2fd666',name:'Faible'} };
const band = w => w>=3 ? 'fort' : (w>=1 ? 'moyen' : 'faible');
const barPct = w => Math.max(6, Math.min(100, w/2*100));

const sunIcon  = `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>`;
const moonIcon = `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>`;

function card(c){
  const b = band(c.weight), heat = HEAT[b];
  const sess = c.session==='bmo'
    ? {cls:'bmo', label:'AVANT OUVERTURE', icon:sunIcon}
    : {cls:'amc', label:'APRÈS CLÔTURE', icon:moonIcon};
  const uri = fetchLogo(c.domain);
  const img = uri
    ? `<img src="${uri}" alt="${c.ticker}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';">`
    : '';
  const monogram = `<span class="mono-fallback" style="${uri?'display:none;':'display:flex;'}background:${c.brand}">${c.ticker[0]}</span>`;
  return `
  <div class="card heat-${b}" style="--heat:${heat.c};--brand:${c.brand}">
    <div class="card-spine"></div>
    <div class="card-top">
      <div class="logo-chip">${img}${monogram}</div>
      <div class="id">
        <div class="tk-row"><span class="tk">${c.ticker}</span><span class="exch">${c.exchange||'NASDAQ'}</span></div>
        <div class="cname">${c.name}</div>
        <div class="csector">${c.sector||''}</div>
      </div>
      <div class="sess ${sess.cls}">${sess.icon}<span>${sess.label}</span></div>
    </div>
    <div class="card-bot">
      <div class="wblock">
        <div class="wlabel">POIDS QQQ</div>
        <div class="wbar"><span style="width:${barPct(c.weight)}%;background:${heat.c}"></span></div>
      </div>
      <div class="wval"><b>${c.weight.toFixed(2)}<em>%</em></b></div>
      <div class="heatpill" style="--heat:${heat.c}"><i></i>${heat.name}</div>
    </div>
  </div>`;
}

function ghostRow(day){
  if (!day.ghost || !day.ghost.length) return '';
  const chips = day.ghost.map(t=>`<span class="ghost">${t}</span>`).join('');
  return `<div class="ghost-row"><span class="ghost-tag">⊘ HORS NASDAQ-100</span>${chips}<span class="ghost-note">${day.ghostNote||''}</span></div>`;
}

function dayRow(day){
  const has = day.qqq && day.qqq.length>0;
  const cards = has ? day.qqq.map(card).join('') : (day.note ? `<div class="empty">${day.note}</div>` : '');
  return `
  <div class="day ${has?'':'day-empty'}">
    <div class="rail">
      <div class="wk">${day.d}</div>
      <div class="dt">${day.date}<span>${day.mon||'JUIL'}</span></div>
      ${has?`<div class="count">${day.qqq.length}</div>`:''}
    </div>
    <div class="content">
      <div class="cards">${cards}</div>
      ${ghostRow(day)}
    </div>
  </div>`;
}

// ---- KPIs (auto) ----
const allQ = data.days.flatMap(d=>d.qqq||[]);
const kpi = {
  total: allQ.length,
  bmo: allQ.filter(c=>c.session==='bmo').length,
  amc: allQ.filter(c=>c.session==='amc').length,
  activeDays: data.days.filter(d=>d.qqq&&d.qqq.length).length,
};

const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<style>
${fonts}
*{margin:0;padding:0;box-sizing:border-box}
:root{
  --bg:#070a11; --panel:#0d1320; --panel2:#101828; --line:rgba(255,255,255,.075);
  --txt:#eaf0f8; --mut:#93a1b8; --mut2:#5a6479; --acc:#37c2ff;
}
html,body{background:#04060a;font-family:'Archivo',sans-serif;-webkit-font-smoothing:antialiased}
.poster{
  display:inline-block; width:1400px; position:relative; color:var(--txt);
  background:
    radial-gradient(1200px 620px at 82% -8%, rgba(55,194,255,.13), transparent 60%),
    radial-gradient(900px 500px at 6% 4%, rgba(120,90,255,.10), transparent 55%),
    linear-gradient(180deg,#0a0f1a 0%, #070b13 55%, #05070d 100%);
  overflow:hidden;
}
.poster::before{
  content:''; position:absolute; inset:0; pointer-events:none; opacity:.5;
  background-image:linear-gradient(rgba(255,255,255,.028) 1px,transparent 1px),
                   linear-gradient(90deg,rgba(255,255,255,.028) 1px,transparent 1px);
  background-size:46px 46px; mask-image:linear-gradient(180deg,#000,transparent 78%);
}
.pad{position:relative;padding:46px 50px 40px}
.hdr{display:flex;justify-content:space-between;align-items:flex-start;gap:24px}
.brand{display:flex;align-items:center;gap:16px}
.mark{width:56px;height:56px;border-radius:14px;position:relative;
  background:linear-gradient(150deg,#0e1626,#0a1120);border:1px solid rgba(55,194,255,.35);
  box-shadow:0 0 0 1px rgba(0,0,0,.4),0 10px 30px rgba(55,194,255,.10);
  display:flex;align-items:center;justify-content:center}
.mark svg{width:34px;height:34px}
.brand-txt .name{font-size:31px;font-weight:800;letter-spacing:.14em;line-height:1}
.brand-txt .name b{color:var(--acc)}
.brand-txt .sub{margin-top:8px;font-size:12.5px;letter-spacing:.16em;text-transform:uppercase;color:var(--mut);font-weight:600}
.week{text-align:right}
.week .lab{font-size:11px;letter-spacing:.3em;color:var(--mut);text-transform:uppercase;font-weight:600}
.week .rng{font-family:'IBM Plex Mono',monospace;font-size:34px;font-weight:600;letter-spacing:.01em;margin-top:6px;color:#fff}
.week .rng em{color:var(--acc);font-style:normal}
.week .meta{margin-top:6px;font-size:12.5px;color:var(--mut);letter-spacing:.06em}
.strip{display:flex;justify-content:space-between;align-items:stretch;gap:20px;margin-top:30px}
.kpis{display:flex;gap:12px}
.kpi{background:linear-gradient(180deg,rgba(255,255,255,.035),rgba(255,255,255,.012));
  border:1px solid var(--line);border-radius:13px;padding:14px 18px;min-width:118px}
.kpi .n{font-family:'IBM Plex Mono',monospace;font-size:26px;font-weight:600;line-height:1}
.kpi .t{margin-top:7px;font-size:10.5px;letter-spacing:.13em;text-transform:uppercase;color:var(--mut);font-weight:600}
.kpi.a .n{color:var(--acc)} .kpi.g .n{color:#ffc24b} .kpi.i .n{color:#8b93ff}
.legend{background:linear-gradient(180deg,rgba(255,255,255,.035),rgba(255,255,255,.012));
  border:1px solid var(--line);border-radius:13px;padding:13px 18px;min-width:340px;display:flex;flex-direction:column;justify-content:center}
.legend .lt{font-size:10.5px;letter-spacing:.13em;text-transform:uppercase;color:var(--mut);font-weight:600;margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;gap:14px}
.legend .lt b{color:var(--txt);font-weight:600}
.lt-tag{font-size:9px;letter-spacing:.16em;color:var(--acc);border:1px solid rgba(55,194,255,.28);padding:3px 7px;border-radius:5px;background:rgba(55,194,255,.07);flex-shrink:0}
.grad{height:10px;border-radius:6px;background:linear-gradient(90deg,#2fd666,#a6d94b 32%,#ffb020 62%,#ff7a2e 82%,#ff4d4d);}
.gscale{display:flex;justify-content:space-between;margin-top:8px;font-size:10.5px;color:var(--mut);letter-spacing:.05em}
.gscale b{color:var(--txt);font-weight:600}
.grid{margin-top:26px;border-top:1px solid var(--line)}
.day{display:flex;gap:22px;padding:20px 0;border-bottom:1px solid var(--line);position:relative}
.day-empty{opacity:.78}
.rail{width:118px;flex-shrink:0;display:flex;flex-direction:column;gap:2px;position:relative}
.rail::after{content:'';position:absolute;right:-11px;top:2px;bottom:2px;width:2px;border-radius:2px;
  background:linear-gradient(180deg,var(--acc),transparent)}
.day-empty .rail::after{background:linear-gradient(180deg,rgba(255,255,255,.14),transparent)}
.rail .wk{font-size:13px;font-weight:800;letter-spacing:.26em;color:var(--acc)}
.day-empty .rail .wk{color:var(--mut)}
.rail .dt{font-family:'IBM Plex Mono',monospace;font-size:38px;font-weight:600;line-height:1;color:#fff;display:flex;align-items:baseline;gap:6px}
.rail .dt span{font-size:11px;letter-spacing:.14em;color:var(--mut);font-weight:500}
.rail .count{margin-top:8px;width:24px;height:24px;border-radius:7px;background:rgba(55,194,255,.14);
  border:1px solid rgba(55,194,255,.3);color:var(--acc);font-family:'IBM Plex Mono',monospace;font-size:13px;font-weight:600;display:flex;align-items:center;justify-content:center}
.content{flex:1;min-width:0}
.cards{display:flex;flex-wrap:wrap;gap:14px}
.empty{font-size:14px;letter-spacing:.04em;padding:14px 4px;font-style:italic;color:#54607a}
.card{position:relative;width:362px;border-radius:15px;overflow:hidden;
  background:linear-gradient(180deg, color-mix(in srgb,var(--heat) 11%, #0e1524) 0%, #0c1220 68%),#0c1220;
  border:1px solid var(--line);
  box-shadow:0 1px 0 rgba(255,255,255,.03) inset, 0 14px 34px rgba(0,0,0,.42);}
.card::after{content:'';position:absolute;right:-40px;top:-40px;width:150px;height:150px;border-radius:50%;
  background:radial-gradient(circle,color-mix(in srgb,var(--heat) 26%,transparent),transparent 68%);pointer-events:none}
.card-spine{position:absolute;left:0;top:0;bottom:0;width:4px;background:var(--heat);box-shadow:0 0 16px var(--heat)}
.card-top{display:flex;gap:14px;padding:16px 16px 12px 20px;position:relative}
.logo-chip{width:50px;height:50px;border-radius:12px;background:#fff;flex-shrink:0;
  display:flex;align-items:center;justify-content:center;overflow:hidden;
  box-shadow:0 4px 12px rgba(0,0,0,.35),0 0 0 1px rgba(255,255,255,.5)}
.logo-chip img{width:40px;height:40px;object-fit:contain;display:block}
.mono-fallback{width:50px;height:50px;align-items:center;justify-content:center;color:#fff;font-size:24px;font-weight:800;letter-spacing:.02em}
.id{flex:1;min-width:0;padding-top:1px}
.tk-row{display:flex;align-items:center;gap:9px}
.tk{font-family:'IBM Plex Mono',monospace;font-size:22px;font-weight:600;letter-spacing:.02em;color:#fff}
.exch{font-size:9px;font-weight:700;letter-spacing:.14em;color:var(--mut);border:1px solid var(--line);
  padding:3px 6px;border-radius:5px;background:rgba(255,255,255,.03)}
.cname{font-size:13.5px;font-weight:600;color:#dbe4f1;margin-top:5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.csector{font-size:11px;color:var(--mut);margin-top:3px;letter-spacing:.02em}
.sess{position:absolute;top:16px;right:16px;display:flex;align-items:center;gap:5px;
  font-size:9.5px;font-weight:700;letter-spacing:.09em;padding:5px 9px;border-radius:20px;white-space:nowrap}
.sess svg{opacity:.95}
.sess.bmo{color:#ffcf6b;background:rgba(255,180,32,.12);border:1px solid rgba(255,180,32,.32)}
.sess.amc{color:#a6acff;background:rgba(139,147,255,.12);border:1px solid rgba(139,147,255,.32)}
.card-bot{display:flex;align-items:center;gap:14px;padding:12px 18px 15px 20px;border-top:1px solid rgba(255,255,255,.05);
  background:linear-gradient(180deg,transparent,rgba(0,0,0,.18))}
.wblock{flex:1;min-width:0}
.wlabel{font-size:9px;letter-spacing:.16em;color:var(--mut);font-weight:600}
.wbar{height:7px;border-radius:4px;background:rgba(255,255,255,.08);margin-top:7px;overflow:hidden}
.wbar span{display:block;height:100%;border-radius:4px}
.wval b{font-family:'IBM Plex Mono',monospace;font-size:21px;font-weight:600;color:#fff}
.wval em{font-style:normal;font-size:12px;color:var(--mut);margin-left:1px}
.heatpill{display:flex;align-items:center;gap:6px;font-size:11px;font-weight:700;letter-spacing:.04em;
  padding:6px 11px;border-radius:20px;color:var(--heat);
  background:color-mix(in srgb,var(--heat) 13%,transparent);border:1px solid color-mix(in srgb,var(--heat) 34%,transparent)}
.heatpill i{width:8px;height:8px;border-radius:50%;background:var(--heat);box-shadow:0 0 8px var(--heat)}
.ghost-row{display:flex;align-items:center;gap:8px;margin-top:13px;flex-wrap:wrap}
.ghost-tag{font-size:9px;font-weight:700;letter-spacing:.13em;color:#6b7688;
  border:1px dashed rgba(255,255,255,.14);padding:4px 8px;border-radius:6px}
.ghost{font-family:'IBM Plex Mono',monospace;font-size:11.5px;font-weight:500;
  color:#8994a8;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);
  padding:4px 9px;border-radius:6px}
.ghost-note{font-size:10.5px;color:#5a6479;letter-spacing:.03em;margin-left:4px;font-style:italic}
.footer{margin-top:30px;padding-top:22px;border-top:1px solid var(--line);display:flex;justify-content:space-between;gap:30px;align-items:flex-start}
.disc{flex:1}
.disc .dh{font-size:10.5px;letter-spacing:.16em;text-transform:uppercase;color:var(--acc);font-weight:700;margin-bottom:11px}
.disc ul{list-style:none;display:flex;flex-direction:column;gap:7px}
.disc li{font-size:11.5px;color:var(--mut);line-height:1.5;padding-left:17px;position:relative;letter-spacing:.01em}
.disc li::before{content:'';position:absolute;left:0;top:6px;width:6px;height:6px;border-radius:2px;background:var(--acc);opacity:.65}
.sig{text-align:right;flex-shrink:0;max-width:250px}
.sig .s1{font-size:12px;font-weight:800;letter-spacing:.12em}
.sig .s1 b{color:var(--acc)}
.sig .s2{font-size:10.5px;color:var(--mut);margin-top:7px;line-height:1.6}
</style></head>
<body>
<div class="poster"><div class="pad">
  <div class="hdr">
    <div class="brand">
      <div class="mark">
        <svg viewBox="0 0 40 40" fill="none">
          <path d="M6 27 L15 18 L21 23 L34 10" stroke="#37c2ff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M27 10 H34 V17" stroke="#37c2ff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
          <circle cx="15" cy="18" r="2.1" fill="#fff"/><circle cx="21" cy="23" r="2.1" fill="#fff"/>
        </svg>
      </div>
      <div class="brand-txt">
        <div class="name">MB <b>TRADING</b></div>
        <div class="sub">${data.brandSub || "Calendrier des résultats · Nasdaq-100 (QQQ)"}</div>
      </div>
    </div>
    <div class="week">
      <div class="lab">${data.weekLabelTop || "Semaine en cours"}</div>
      <div class="rng">${data.weekRange}</div>
      <div class="meta">${data.weekMeta || ''}</div>
    </div>
  </div>
  <div class="strip">
    <div class="kpis">
      <div class="kpi a"><div class="n">${kpi.total}</div><div class="t">Valeurs QQQ</div></div>
      <div class="kpi g"><div class="n">${kpi.bmo}</div><div class="t">Avant ouverture</div></div>
      <div class="kpi i"><div class="n">${kpi.amc}</div><div class="t">Après clôture</div></div>
      <div class="kpi"><div class="n">${kpi.activeDays}</div><div class="t">Jours actifs</div></div>
    </div>
    <div class="legend">
      <div class="lt"><span>Échelle — <b>poids dans l'ETF QQQ</b></span><span class="lt-tag">HEATMAP</span></div>
      <div class="grad"></div>
      <div class="gscale">
        <span><b>Faible</b> &lt;1%</span>
        <span><b>Moyen</b> 1–3%</span>
        <span><b>Fort</b> &gt;3%</span>
      </div>
    </div>
  </div>
  <div class="grid">
    ${data.days.map(dayRow).join('')}
  </div>
  <div class="footer">
    <div class="disc">
      <div class="dh">Disclaimer</div>
      <ul>
        <li>La <b style="color:#cfd8e6">couleur de fond</b> reflète le poids de la valeur dans l'ETF Invesco QQQ (pondérations approximatives / vérifiées sur la fiche officielle — sujettes à variation quotidienne et rééquilibrage trimestriel).</li>
        <li>Les <b style="color:#cfd8e6">dates et séances</b> (avant ouverture / après clôture) sont estimées et doivent être vérifiées auprès des sociétés et de votre courtier avant toute décision.</li>
        <li>Seules les <b style="color:#cfd8e6">composantes du Nasdaq-100 (QQQ)</b> sont affichées. Les valeurs hors indice publiant la même semaine sont exclues et signalées en grisé « hors QQQ ».</li>
      </ul>
    </div>
    <div class="sig">
      <div class="s1">MB <b>TRADING</b></div>
      <div class="s2">Généré le ${data.generated || ''}<br>Sources : recherche web · fiche Invesco QQQ<br><b style="color:#8a97ab">Ne constitue pas un conseil en investissement</b></div>
    </div>
  </div>
</div></div>
</body></html>`;

const htmlPath = join(__dir, 'index.html');
const rawPath  = join(__dir, '.raw.png');
writeFileSync(htmlPath, html);
console.log('HTML assemblé:', html.length, 'octets');

// ---- render ----
const CHROME = findChrome();
execFileSync(CHROME, [
  '--headless=new','--no-sandbox','--disable-gpu','--hide-scrollbars',
  '--window-size=1400,2600','--force-device-scale-factor=2',
  '--default-background-color=00000000',
  `--screenshot=${rawPath}`, `file://${htmlPath}`,
], {stdio:'ignore'});
console.log('Rendu Chromium OK');

// ---- autocrop (Pillow) ----
try { execSync('python3 -c "import PIL"', {stdio:'ignore'}); }
catch { execSync('pip install --quiet pillow', {stdio:'inherit'}); }
execFileSync('python3', [join(__dir,'crop.py'), rawPath, OUT], {stdio:'inherit'});
console.log('Image finale:', OUT);
