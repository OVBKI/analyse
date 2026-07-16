#!/usr/bin/env node
/*
 * MB TRADING — Générateur du calendrier économique hebdomadaire (États-Unis, fort impact).
 *
 * Usage:
 *   node generate.mjs --data week-data.json --out mb_trading_econ.png
 *
 * Même charte que le calendrier des résultats QQQ. Ici la "heatmap" encode l'IMPACT
 * marché (Élevé -> orange, Critique -> rouge). Seules les annonces US à fort impact
 * sont affichées. Aucune donnée non-US.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execSync, execFileSync } from 'node:child_process';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const arg = (n,d)=>{ const i=argv.indexOf('--'+n); return i>=0?argv[i+1]:d; };
const DATA = resolve(arg('data', join(__dir,'week-data.json')));
const OUT  = resolve(arg('out',  join(__dir,'mb_trading_econ.png')));

const data = JSON.parse(readFileSync(DATA,'utf8'));
const fonts = readFileSync(join(__dir,'fonts-embedded.css'),'utf8');

function findChrome(){
  if (process.env.CHROME && existsSync(process.env.CHROME)) return process.env.CHROME;
  for (const g of ['/opt/pw-browsers/chromium-*/chrome-linux/chrome','/opt/pw-browsers/chromium/chrome-linux/chrome']){
    try { const h=execSync(`ls -1 ${g} 2>/dev/null | head -1`,{encoding:'utf8'}).trim(); if (h&&existsSync(h)) return h; } catch {}
  }
  for (const c of ['google-chrome','chromium','chromium-browser']){ try { return execSync(`command -v ${c}`,{encoding:'utf8'}).trim(); } catch {} }
  throw new Error('Chromium introuvable (définir CHROME).');
}

// ---- impact heatmap ----
const IMPACT = { critique:{c:'#ff4d4d',name:'Critique'}, eleve:{c:'#ffa033',name:'Élevé'} };

// ---- category icons (line SVG, render offline) ----
const ICON = {
  inflation:`<path d="M3 17l6-6 4 4 8-8"/><path d="M16 7h5v5"/>`,
  fed:`<path d="M3 21h18"/><path d="M4 10h16"/><path d="M5 10v8M9.5 10v8M14.5 10v8M19 10v8"/><path d="M12 3l8 4H4z"/>`,
  conso:`<circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/><path d="M2 3h3l2.4 12.3a1.5 1.5 0 0 0 1.5 1.2h8.2a1.5 1.5 0 0 0 1.5-1.2L22 7H6"/>`,
  emploi:`<rect x="3" y="8" width="18" height="12" rx="2"/><path d="M9 8V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/><path d="M3 13h18"/>`,
  industrie:`<path d="M3 21V9l6 4V9l6 4V5l6 3v13H3z"/>`,
  defaut:`<circle cx="12" cy="12" r="8"/>`,
};
const catLabel = { inflation:'INFLATION', fed:'BANQUE CENTRALE', conso:'CONSOMMATION', emploi:'EMPLOI', industrie:'INDUSTRIE' };
const clockIcon = `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>`;

function num(s){ if(s==null) return null; const m=String(s).replace(/ /g,'').replace(',','.').match(/-?\d+(\.\d+)?/); return m?parseFloat(m[0]):null; }
function surprise(actual,cons){
  const a=num(actual), c=num(cons);
  if(a==null||c==null) return '';
  if(a<c) return `<span class="arw dn">▼</span>`;
  if(a>c) return `<span class="arw up">▲</span>`;
  return `<span class="arw eq">■</span>`;
}

function stat(label,val,extra=''){
  const empty = (val==null||val==='—');
  return `<div class="st${empty?' st-empty':''}"><div class="stl">${label}</div><div class="stv">${empty?'—':val}${extra}</div></div>`;
}

function eventCard(e){
  const imp = IMPACT[e.impact] || IMPACT.eleve;
  const icon = ICON[e.cat] || ICON.defaut;
  return `
  <div class="card imp-${e.impact}" style="--heat:${imp.c}">
    <div class="card-spine"></div>
    <div class="card-top">
      <div class="badge" style="--heat:${imp.c}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${icon}</svg>
      </div>
      <div class="id">
        <div class="tk-row"><span class="tk">${e.code}</span><span class="exch">US · ${catLabel[e.cat]||'DONNÉE'}</span></div>
        <div class="cname">${e.name}</div>
        <div class="csector">${e.detail||''}</div>
      </div>
      <div class="sess time">${clockIcon}<span>${e.time||''}</span></div>
    </div>
    <div class="card-bot">
      ${stat('PRÉCÉDENT', e.prev)}
      ${stat('CONSENSUS', e.cons)}
      <div class="spacer"></div>
      <div class="heatpill" style="--heat:${imp.c}"><i></i>${imp.name}</div>
    </div>
  </div>`;
}

function dayRow(day){
  const evs = day.events||[];
  const has = evs.length>0;
  const cards = has ? evs.map(eventCard).join('') : (day.note?`<div class="empty">${day.note}</div>`:'');
  return `
  <div class="day ${has?'':'day-empty'}">
    <div class="rail">
      <div class="wk">${day.d}</div>
      <div class="dt">${day.date}<span>${day.mon||'JUIL'}</span></div>
      ${has?`<div class="count">${evs.length}</div>`:''}
    </div>
    <div class="content"><div class="cards">${cards}</div></div>
  </div>`;
}

const allE = data.days.flatMap(d=>d.events||[]);
const kpi = {
  total: allE.length,
  crit: allE.filter(e=>e.impact==='critique').length,
  fed: allE.filter(e=>e.cat==='fed').length,
  activeDays: data.days.filter(d=>(d.events||[]).length).length,
};

const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<style>
${fonts}
*{margin:0;padding:0;box-sizing:border-box}
:root{--line:rgba(255,255,255,.075);--txt:#eaf0f8;--mut:#93a1b8;--mut2:#5a6479;--acc:#37c2ff;}
html,body{background:#04060a;font-family:'Archivo',sans-serif;-webkit-font-smoothing:antialiased}
.poster{display:inline-block;width:1400px;position:relative;color:var(--txt);
  background:radial-gradient(1200px 620px at 82% -8%, rgba(55,194,255,.13), transparent 60%),
    radial-gradient(900px 500px at 6% 4%, rgba(255,110,80,.09), transparent 55%),
    linear-gradient(180deg,#0a0f1a 0%, #070b13 55%, #05070d 100%);overflow:hidden;}
.poster::before{content:'';position:absolute;inset:0;pointer-events:none;opacity:.5;
  background-image:linear-gradient(rgba(255,255,255,.028) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.028) 1px,transparent 1px);
  background-size:46px 46px;mask-image:linear-gradient(180deg,#000,transparent 78%);}
.pad{position:relative;padding:46px 50px 40px}
.hdr{display:flex;justify-content:space-between;align-items:flex-start;gap:24px}
.brand{display:flex;align-items:center;gap:16px}
.mark{width:56px;height:56px;border-radius:14px;position:relative;background:linear-gradient(150deg,#0e1626,#0a1120);
  border:1px solid rgba(55,194,255,.35);box-shadow:0 0 0 1px rgba(0,0,0,.4),0 10px 30px rgba(55,194,255,.10);
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
.kpi{background:linear-gradient(180deg,rgba(255,255,255,.035),rgba(255,255,255,.012));border:1px solid var(--line);border-radius:13px;padding:14px 18px;min-width:118px}
.kpi .n{font-family:'IBM Plex Mono',monospace;font-size:26px;font-weight:600;line-height:1}
.kpi .t{margin-top:7px;font-size:10.5px;letter-spacing:.13em;text-transform:uppercase;color:var(--mut);font-weight:600}
.kpi.a .n{color:var(--acc)} .kpi.r .n{color:#ff6a5f} .kpi.v .n{color:#c084fc}
.legend{background:linear-gradient(180deg,rgba(255,255,255,.035),rgba(255,255,255,.012));border:1px solid var(--line);border-radius:13px;padding:13px 18px;min-width:340px;display:flex;flex-direction:column;justify-content:center}
.legend .lt{font-size:10.5px;letter-spacing:.13em;text-transform:uppercase;color:var(--mut);font-weight:600;margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;gap:14px}
.legend .lt b{color:var(--txt);font-weight:600}
.lt-tag{font-size:9px;letter-spacing:.16em;color:var(--acc);border:1px solid rgba(55,194,255,.28);padding:3px 7px;border-radius:5px;background:rgba(55,194,255,.07);flex-shrink:0}
.grad{height:10px;border-radius:6px;background:linear-gradient(90deg,#ffb020,#ff8a3d 45%,#ff6340 75%,#ff4d4d)}
.gscale{display:flex;justify-content:space-between;margin-top:8px;font-size:10.5px;color:var(--mut);letter-spacing:.05em}
.gscale b{color:var(--txt);font-weight:600}
.grid{margin-top:26px;border-top:1px solid var(--line)}
.day{display:flex;gap:22px;padding:20px 0;border-bottom:1px solid var(--line);position:relative}
.day-empty{opacity:.78}
.rail{width:118px;flex-shrink:0;display:flex;flex-direction:column;gap:2px;position:relative}
.rail::after{content:'';position:absolute;right:-11px;top:2px;bottom:2px;width:2px;border-radius:2px;background:linear-gradient(180deg,var(--acc),transparent)}
.day-empty .rail::after{background:linear-gradient(180deg,rgba(255,255,255,.14),transparent)}
.rail .wk{font-size:13px;font-weight:800;letter-spacing:.26em;color:var(--acc)}
.day-empty .rail .wk{color:var(--mut)}
.rail .dt{font-family:'IBM Plex Mono',monospace;font-size:38px;font-weight:600;line-height:1;color:#fff;display:flex;align-items:baseline;gap:6px}
.rail .dt span{font-size:11px;letter-spacing:.14em;color:var(--mut);font-weight:500}
.rail .count{margin-top:8px;width:24px;height:24px;border-radius:7px;background:rgba(55,194,255,.14);border:1px solid rgba(55,194,255,.3);color:var(--acc);font-family:'IBM Plex Mono',monospace;font-size:13px;font-weight:600;display:flex;align-items:center;justify-content:center}
.content{flex:1;min-width:0}
.cards{display:flex;flex-wrap:wrap;gap:14px}
.empty{font-size:14px;letter-spacing:.04em;padding:14px 4px;font-style:italic;color:#54607a}
.card{position:relative;width:426px;border-radius:15px;overflow:hidden;
  background:linear-gradient(180deg, color-mix(in srgb,var(--heat) 11%, #0e1524) 0%, #0c1220 68%),#0c1220;
  border:1px solid var(--line);box-shadow:0 1px 0 rgba(255,255,255,.03) inset, 0 14px 34px rgba(0,0,0,.42)}
.card::after{content:'';position:absolute;right:-40px;top:-40px;width:150px;height:150px;border-radius:50%;
  background:radial-gradient(circle,color-mix(in srgb,var(--heat) 24%,transparent),transparent 68%);pointer-events:none}
.card-spine{position:absolute;left:0;top:0;bottom:0;width:4px;background:var(--heat);box-shadow:0 0 16px var(--heat)}
.card-top{display:flex;gap:14px;padding:16px 16px 12px 20px;position:relative}
.badge{width:50px;height:50px;border-radius:12px;flex-shrink:0;display:flex;align-items:center;justify-content:center;
  color:var(--heat);background:color-mix(in srgb,var(--heat) 16%,#0b1120);
  border:1px solid color-mix(in srgb,var(--heat) 40%,transparent);box-shadow:0 0 16px color-mix(in srgb,var(--heat) 22%,transparent)}
.badge svg{width:26px;height:26px}
.id{flex:1;min-width:0;padding-top:1px}
.tk-row{display:flex;align-items:center;gap:9px}
.tk{font-family:'IBM Plex Mono',monospace;font-size:21px;font-weight:600;letter-spacing:.02em;color:#fff}
.exch{font-size:9px;font-weight:700;letter-spacing:.1em;color:var(--mut);border:1px solid var(--line);padding:3px 6px;border-radius:5px;background:rgba(255,255,255,.03)}
.cname{font-size:14px;font-weight:600;color:#dbe4f1;margin-top:5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.csector{font-size:11px;color:var(--mut);margin-top:3px;letter-spacing:.02em}
.sess{position:absolute;top:16px;right:16px;display:flex;align-items:center;gap:5px;font-size:10px;font-weight:700;letter-spacing:.06em;padding:5px 9px;border-radius:20px;white-space:nowrap}
.sess.time{color:#bcd3ff;background:rgba(90,130,220,.14);border:1px solid rgba(120,150,230,.32);font-family:'IBM Plex Mono',monospace}
.card-bot{display:flex;align-items:center;gap:12px;padding:12px 16px 15px 20px;border-top:1px solid rgba(255,255,255,.05);background:linear-gradient(180deg,transparent,rgba(0,0,0,.18))}
.st{flex:0 0 auto;min-width:112px}
.spacer{flex:1;min-width:8px}
.stl{font-size:8.5px;letter-spacing:.14em;color:var(--mut);font-weight:600}
.stv{font-family:'IBM Plex Mono',monospace;font-size:18px;font-weight:600;color:#fff;margin-top:5px;white-space:nowrap}
.st-empty .stv{color:#4d586b}
.arw{font-size:12px;margin-left:1px}
.arw.dn{color:#2fd666}.arw.up{color:#ff5b52}.arw.eq{color:var(--mut)}
.heatpill{display:flex;align-items:center;gap:6px;font-size:11px;font-weight:700;letter-spacing:.04em;padding:6px 11px;border-radius:20px;color:var(--heat);
  background:color-mix(in srgb,var(--heat) 13%,transparent);border:1px solid color-mix(in srgb,var(--heat) 34%,transparent);flex-shrink:0}
.heatpill i{width:8px;height:8px;border-radius:50%;background:var(--heat);box-shadow:0 0 8px var(--heat)}
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
        <div class="sub">${data.brandSub || "Calendrier économique · États-Unis · fort impact"}</div>
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
      <div class="kpi a"><div class="n">${kpi.total}</div><div class="t">Annonces fort impact</div></div>
      <div class="kpi r"><div class="n">${kpi.crit}</div><div class="t">Critique</div></div>
      <div class="kpi v"><div class="n">${kpi.fed}</div><div class="t">Banque centrale</div></div>
      <div class="kpi"><div class="n">${kpi.activeDays}</div><div class="t">Jours actifs</div></div>
    </div>
    <div class="legend">
      <div class="lt"><span>Échelle — <b>impact marché attendu</b></span><span class="lt-tag">HEATMAP</span></div>
      <div class="grad"></div>
      <div class="gscale">
        <span><b>Élevé</b> · marché sensible</span>
        <span><b>Critique</b> · fort mouvement</span>
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
        <li>La <b style="color:#cfd8e6">couleur de fond</b> reflète l'<b style="color:#cfd8e6">impact marché attendu</b> (Élevé = orange, Critique = rouge). Seules les annonces <b style="color:#cfd8e6">américaines à fort impact</b> sont affichées ; les données non-US et à impact faible/moyen sont exclues.</li>
        <li>Les <b style="color:#cfd8e6">horaires</b> (US Eastern) et les valeurs <b style="color:#cfd8e6">précédent / consensus</b> sont estimés et doivent être vérifiés auprès des sources officielles (BLS, Census, Réserve fédérale) avant toute décision.</li>
        <li>Calendrier <b style="color:#cfd8e6">prévisionnel de la semaine</b> : seules les attentes (consensus) sont affichées, pas les chiffres publiés. Document informatif — <b style="color:#cfd8e6">ne constitue pas un conseil en investissement</b>.</li>
      </ul>
    </div>
    <div class="sig">
      <div class="s1">MB <b>TRADING</b></div>
      <div class="s2">Généré le ${data.generated || ''}<br>Sources : recherche web · BLS / Census / Fed<br><b style="color:#8a97ab">Ne constitue pas un conseil en investissement</b></div>
    </div>
  </div>
</div></div>
</body></html>`;

const htmlPath = join(__dir,'index.html');
const rawPath  = join(__dir,'.raw.png');
writeFileSync(htmlPath, html);
console.log('HTML assemblé:', html.length, 'octets');

const CHROME = findChrome();
execFileSync(CHROME, ['--headless=new','--no-sandbox','--disable-gpu','--hide-scrollbars',
  '--window-size=1400,2600','--force-device-scale-factor=2','--default-background-color=00000000',
  `--screenshot=${rawPath}`, `file://${htmlPath}`], {stdio:'ignore'});
console.log('Rendu Chromium OK');

try { execSync('python3 -c "import PIL"',{stdio:'ignore'}); }
catch { execSync('pip install --quiet pillow',{stdio:'inherit'}); }
execFileSync('python3',[join(__dir,'crop.py'), rawPath, OUT], {stdio:'inherit'});
console.log('Image finale:', OUT);
