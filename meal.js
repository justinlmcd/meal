// MEAL. Supabase stores the diary; this browser only displays it.
(function(){
'use strict';
const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const SLOTS=[['breakfast','Breakfast'],['lunch','Lunch'],['dinner','Dinner'],['snack','Snacks']];
const MACRO_COLORS={protein:'#3987e5',carbs:'#d95926',fat:'#199e70'};
const PAGE=1000;
const isoDay=d=>{ const x=new Date(d); return new Date(x.getTime()-x.getTimezoneOffset()*60000).toISOString().slice(0,10); };
const today=()=>isoDay(new Date());
const parseDay=s=>{ const [y,m,d]=s.split('-').map(Number); return new Date(y,m-1,d); };
const addDays=(s,n)=>isoDay(new Date(parseDay(s).getTime()+n*86400000+3600000*6));
const shortDate=s=>parseDay(s).toLocaleDateString([], {month:'short',day:'numeric'});
const longDate=s=>parseDay(s).toLocaleDateString([], {weekday:'short',month:'short',day:'numeric',year:'numeric'});
const r0=n=>String(Math.round(Number(n)||0));
const r1=n=>{ const v=Math.round((Number(n)||0)*10)/10; return Number.isInteger(v)?String(v):v.toFixed(1); };
const slotNow=()=>{ const h=new Date().getHours(); return h<11?'breakfast':h<15?'lunch':h<21?'dinner':'snack'; };

let client=null,user=null,busy=false,authSub=null,connecting=null,storageCleanup=null;
let entries=[],foods=[],goals={calories:2000,protein:150,carbs:200,fat:65},range='7',day=today(),loadId=0;

function message(id,text,kind=''){ $(id).textContent=text; $(id).className='message'+(kind?' '+kind:''); }

// ---- connection: the two public Supabase settings come from /api/config ----
function projectConfig(v){ const url=typeof v?.url==='string'?v.url.trim().replace(/\/$/,''):'', key=typeof v?.key==='string'?v.key.trim():''; if(!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url)||!/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) throw new Error('This page needs its Supabase connection set up in Vercel.'); return {url,key}; }
async function connect(){
  if(client)return client; if(connecting)return connecting;
  connecting=(async()=>{ let r; try{ r=await fetch('/api/config',{cache:'no-store'}); }catch{ throw new Error('Could not connect. Check your internet connection and try again.'); }
    if(!r.ok) throw new Error('This page needs its Supabase connection set up in Vercel.'); return makeClient(projectConfig(await r.json())); })();
  try{ return await connecting; } finally{ connecting=null; }
}
function makeClient(config){
  if(!window.supabase) throw new Error('The connection library could not load. Reload the page.');
  const storageKey='meal.auth.'+new URL(config.url).hostname, storage=window.localStorage;
  authSub?.unsubscribe(); client?.auth.stopAutoRefresh(); storageCleanup?.();
  client=supabase.createClient(config.url,config.key,{auth:{storage,storageKey,persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}});
  const mine=client;
  authSub=client.auth.onAuthStateChange((_e,session)=>{ setTimeout(()=>{ if(client!==mine)return; setUser(session&&storage.getItem(storageKey)?session.user:null); },0); }).data.subscription;
  const changed=e=>{ if(client===mine&&e.storageArea===storage&&(e.key===storageKey||e.key===null)&&e.newValue===null)setUser(null); };
  window.addEventListener('storage',changed); storageCleanup=()=>window.removeEventListener('storage',changed);
  return client;
}
function setUser(next){
  if(next?.id===user?.id)return;
  user=next; loadId++;
  $('connect-open').hidden=!!user;
  for(const id of ['sign-out','add-open','add-row']) $(id).hidden=!user;
  for(const id of ['entry-fields','goals-fields']) $(id).disabled=!user;
  $('connection-status').textContent=user?'Connected':'Your record'; $('connection-status').classList.toggle('connected',!!user);
  if(!user){ entries=[]; foods=[]; render(); $('diary-list').innerHTML='<p class="row-empty">Sign in to see your diary.</p>'; $('foods-list').innerHTML='<p class="row-empty">Sign in to see your saved foods.</p>'; for(const id of ['entry-dialog','scan-dialog','photo-dialog','goals-dialog']) $(id).close(); }
  else load();
}
$('connect-open').onclick=()=>{ $('connection-dialog').showModal(); $('email').focus(); };
$('connect-close').onclick=()=>{ if(!busy)$('connection-dialog').close(); };
$('connect-form').addEventListener('submit',async e=>{
  e.preventDefault(); if(busy)return; busy=true; $('connect-submit').disabled=true; message('connect-message','Signing in…');
  try{ const db=await connect(); const {data,error}=await db.auth.signInWithPassword({email:$('email').value.trim(),password:$('password').value}); if(error)throw error; $('password').value=''; setUser(data.user); $('connection-dialog').close(); message('connect-message',''); }
  catch(err){ message('connect-message',err.message||'Could not sign in.','error'); }
  finally{ busy=false; $('connect-submit').disabled=false; }
});
$('sign-out').onclick=async()=>{ if(!client||busy)return; busy=true; try{ const {error}=await client.auth.signOut({scope:'local'}); if(error)throw error; setUser(null); }catch(err){ message('history-message',err.message,'error'); } finally{ busy=false; } };

// ---- reading all of it, and never some of it ----
async function readAll(make){ const all=[]; let from=0; for(;;){ const {data,error,count}=await make().range(from,from+PAGE-1); if(error)throw error; all.push(...data); from+=data.length; if(from>=count||!data.length)return all; } }
async function load(){
  const id=++loadId; message('history-message','');
  try{
    const db=await connect();
    const [e,f,g]=await Promise.all([
      readAll(()=>db.from('meal_entries').select('*',{count:'exact'}).order('eaten_on',{ascending:false}).order('created_at',{ascending:false})),
      readAll(()=>db.from('foods').select('*',{count:'exact'}).order('name')),
      db.from('meal_goals').select('*').maybeSingle()
    ]);
    if(id!==loadId)return;
    if(g.error)throw g.error;
    entries=e.map(n=>({...n,calories:+n.calories,protein:+n.protein,carbs:+n.carbs,fat:+n.fat}));
    foods=f.map(n=>({...n,calories:+n.calories,protein:+n.protein,carbs:+n.carbs,fat:+n.fat}));
    if(g.data) goals={calories:+g.data.calories,protein:+g.data.protein,carbs:+g.data.carbs,fat:+g.data.fat};
    render();
  }catch(err){ if(id!==loadId)return; const missing=/relation .* does not exist|schema cache/i.test(err.message||''); message('history-message',missing?'Run setup.sql in your Supabase SQL editor once, then reload.':(err.message||'Could not load your diary.'),'error'); }
}

// ---- derived ----
const sum=(rows,k)=>rows.reduce((a,r)=>a+(r[k]||0),0);
const onDay=d=>entries.filter(r=>r.eaten_on===d);
function byDay(w){ const m=new Map(); for(let d=w.start; d<=w.end; d=addDays(d,1)) m.set(d,0); for(const r of entries) if(m.has(r.eaten_on)) m.set(r.eaten_on,m.get(r.eaten_on)+r.calories); return [...m].map(([d,total])=>({day:d,total})); }

function render(){
  const t=today(), rows=onDay(t), cal=sum(rows,'calories');
  const pct=(v,g)=>g>0?Math.min(100,v/g*100):0;
  $('cal-total').textContent=entries.length?r0(cal):'—'; $('cal-goal').textContent=`/ ${r0(goals.calories)} kcal`;
  const left=goals.calories-cal; $('cal-note').textContent=entries.length?(left>=0?`${r0(left)} kcal left today · ${rows.length} item${rows.length===1?'':'s'}`:`${r0(-left)} kcal over today`):'Your first meal starts here.';
  $('cal-fill').style.width=pct(cal,goals.calories)+'%'; $('cal-fill').classList.toggle('over',cal>goals.calories);
  $('side-today').textContent=entries.length?r0(cal):'—'; $('side-goal').textContent=r0(goals.calories);
  for(const [k,p] of [['protein','p'],['carbs','c'],['fat','f']]){ const v=sum(rows,k); $(p+'-total').innerHTML=`${esc(r0(v))}<span> g</span>`; $(p+'-goal').textContent=`of ${r0(goals[k])} g`; $(p+'-fill').style.width=pct(v,goals[k])+'%'; }
  drawLine(); drawDonut(); renderDiary(); renderFoods();
}

// ---- line: calories per day with the goal ----
let linePts=[];
function drawLine(){
  const svg=$('line-plot'); const w={start:addDays(today(),-(Number(range)-1)),end:today()}; const days=byDay(w);
  const has=days.some(d=>d.total>0); $('line-empty').hidden=has; svg.hidden=!has; $('line-sub').textContent=`Last ${range} days · avg ${r0(days.reduce((a,d)=>a+d.total,0)/days.length)} kcal · goal ${r0(goals.calories)}`; if(!has){ svg.innerHTML=''; return; }
  const W=700,H=260,L=56,R=16,T=16,B=34; const max=Math.max(goals.calories,...days.map(d=>d.total))*1.12||1;
  const x=i=>L+(days.length===1?(W-L-R)/2:i*(W-L-R)/(days.length-1)); const y=v=>T+(H-T-B)*(1-v/max);
  linePts=days.map((d,i)=>({...d,px:x(i),py:y(d.total)}));
  const path=linePts.map((p,i)=>`${i?'L':'M'}${p.px.toFixed(1)} ${p.py.toFixed(1)}`).join('');
  const area=`${path}L${linePts.at(-1).px.toFixed(1)} ${H-B}L${linePts[0].px.toFixed(1)} ${H-B}Z`;
  const ticks=[0,.5,1].map(f=>`<line class="grid" x1="${L}" x2="${W-R}" y1="${y(max*f)}" y2="${y(max*f)}"/><text x="${L-8}" y="${y(max*f)+4}" text-anchor="end">${r0(max*f)}</text>`).join('');
  const gy=y(goals.calories); const goal=`<line x1="${L}" x2="${W-R}" y1="${gy}" y2="${gy}" stroke="#c9a7ff" stroke-opacity=".55" stroke-dasharray="6 5"/><text x="${W-R}" y="${gy-5}" text-anchor="end" fill="#c9a7ff">goal</text>`;
  const step=Math.ceil(days.length/7); const xl=linePts.filter((_,i)=>i%step===0||i===linePts.length-1).map(p=>`<text x="${p.px}" y="${H-10}" text-anchor="middle">${esc(shortDate(p.day))}</text>`).join('');
  const dots=linePts.length<=31?linePts.map(p=>`<circle cx="${p.px}" cy="${p.py}" r="${p.total>0?3.5:0}" fill="${p.total>goals.calories?'#ffae9f':'#c9a7ff'}" stroke="#0b090f" stroke-width="2"/>`).join(''):'';
  svg.innerHTML=`<defs><linearGradient id="wash" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c9a7ff" stop-opacity=".18"/><stop offset="1" stop-color="#c9a7ff" stop-opacity="0"/></linearGradient></defs>${ticks}<line class="axis" x1="${L}" x2="${W-R}" y1="${H-B}" y2="${H-B}"/><path d="${area}" fill="url(#wash)"/>${goal}<path d="${path}" fill="none" stroke="#c9a7ff" stroke-width="2" stroke-linejoin="round"/>${dots}${xl}<g id="line-focus"></g><rect class="hit" x="${L}" y="0" width="${W-L-R}" height="${H}"/>`;
}
function lineHover(e){
  if(!linePts.length)return; const svg=$('line-plot'), r=svg.getBoundingClientRect(); const mx=(e.clientX-r.left)/r.width*700;
  let best=linePts[0]; for(const p of linePts) if(Math.abs(p.px-mx)<Math.abs(best.px-mx)) best=p;
  $('line-focus').innerHTML=`<line x1="${best.px}" x2="${best.px}" y1="16" y2="226" stroke="#c9a7ff" stroke-opacity=".3"/><circle cx="${best.px}" cy="${best.py}" r="5" fill="#ecdfff" stroke="#0b090f" stroke-width="2"/>`;
  const rows=onDay(best.day), tip=$('line-tip'), card=$('line-card').getBoundingClientRect();
  tip.innerHTML=`${esc(longDate(best.day))}<strong>${r0(best.total)} kcal</strong>P ${r0(sum(rows,'protein'))} · C ${r0(sum(rows,'carbs'))} · F ${r0(sum(rows,'fat'))} g`;
  tip.classList.remove('hidden'); tip.style.left=(r.left-card.left+best.px/700*r.width)+'px'; tip.style.top=(r.top-card.top+best.py/260*r.height)+'px';
}
$('line-plot').addEventListener('pointermove',lineHover); $('line-plot').addEventListener('pointerleave',()=>{ $('line-tip').classList.add('hidden'); const f=$('line-focus'); if(f)f.innerHTML=''; });

// ---- donut: where the calories came from, in this range ----
function drawDonut(){
  const svg=$('donut'); const from=addDays(today(),-(Number(range)-1)); const rows=entries.filter(r=>r.eaten_on>=from&&r.eaten_on<=today());
  const segs=[{name:'Protein',key:'protein',cal:sum(rows,'protein')*4},{name:'Carbs',key:'carbs',cal:sum(rows,'carbs')*4},{name:'Fat',key:'fat',cal:sum(rows,'fat')*9}].filter(s=>s.cal>0);
  const total=segs.reduce((a,s)=>a+s.cal,0); const has=total>0; $('pie-empty').hidden=has; $('donut-wrap').hidden=!has; $('pie-sub').textContent=`Last ${range} days · calories from each macro`; if(!has){ svg.innerHTML=''; $('legend').innerHTML=''; return; }
  const C=75,Rr=66,ri=46; let a0=-Math.PI/2; const pt=(a,r)=>[C+r*Math.cos(a),C+r*Math.sin(a)];
  for(const s of segs){ s.a0=a0; s.a1=a0+s.cal/total*Math.PI*2; s.pct=s.cal/total; s.color=MACRO_COLORS[s.key]; a0=s.a1; }
  const arc=s=>{ if(s.pct>=.9999) return `<circle cx="${C}" cy="${C}" r="${(Rr+ri)/2}" fill="none" stroke="${s.color}" stroke-width="${Rr-ri}"/>`; const [x0,y0]=pt(s.a0,Rr),[x1,y1]=pt(s.a1,Rr),[x2,y2]=pt(s.a1,ri),[x3,y3]=pt(s.a0,ri); const big=s.a1-s.a0>Math.PI?1:0; return `<path d="M${x0} ${y0}A${Rr} ${Rr} 0 ${big} 1 ${x1} ${y1}L${x2} ${y2}A${ri} ${ri} 0 ${big} 0 ${x3} ${y3}Z" fill="${s.color}" stroke="#0f0c14" stroke-width="2"/>`; };
  svg.innerHTML=segs.map((s,i)=>`<g data-seg="${i}">${arc(s)}</g>`).join('')+`<text class="donut-center" x="${C}" y="${C+7}" text-anchor="middle">${r0(total)}</text>`;
  $('legend').innerHTML=segs.map((s,i)=>`<li data-seg="${i}"><i style="background:${s.color}"></i><span>${s.name}</span><b>${Math.round(s.pct*100)}%</b></li>`).join('');
  const tip=$('pie-tip'), card=$('pie-card');
  svg.querySelectorAll('[data-seg]').forEach(g=>{ const s=segs[g.dataset.seg];
    g.addEventListener('pointermove',e=>{ const cr=card.getBoundingClientRect(); tip.innerHTML=`${s.name}<strong>${r0(s.cal)} kcal · ${Math.round(s.pct*100)}%</strong>`; tip.classList.remove('hidden'); tip.style.left=(e.clientX-cr.left)+'px'; tip.style.top=(e.clientY-cr.top)+'px'; $('legend').querySelectorAll('li').forEach(li=>li.classList.toggle('dim',li.dataset.seg!==g.dataset.seg)); });
    g.addEventListener('pointerleave',()=>{ tip.classList.add('hidden'); $('legend').querySelectorAll('li').forEach(li=>li.classList.remove('dim')); });
  });
}

// ---- diary ----
function renderDiary(){
  const t=today(); $('day-label').textContent=day===t?'Today':day===addDays(t,-1)?'Yesterday':longDate(day); $('day-next').disabled=day>=t;
  const rows=onDay(day); $('diary-count').textContent=rows.length?`${r0(sum(rows,'calories'))} kcal · ${rows.length} item${rows.length===1?'':'s'}`:'';
  if(!entries.length){ $('diary-list').innerHTML='<p class="row-empty">Nothing logged yet. Photo a meal, scan a barcode, or type it in.</p>'; return; }
  if(!rows.length){ $('diary-list').innerHTML=`<p class="row-empty">Nothing logged on ${esc(longDate(day))}.</p>`; return; }
  $('diary-list').innerHTML=SLOTS.map(([key,label])=>{ const items=rows.filter(r=>r.slot===key); if(!items.length) return '';
    return `<div class="slot"><div class="slot-head">${label}<span>${r0(sum(items,'calories'))} kcal</span></div><div class="rows">${items.map(r=>`<div class="row"><span class="dot" style="background:${MACRO_COLORS[topMacro(r)]}"></span><div class="who"><b>${esc(r.name)}${r.brand?` <small>${esc(r.brand)}</small>`:''}${r.source!=='manual'?`<span class="src">${esc(r.source)}</span>`:''}</b><small class="macro-line">${r.portion?esc(r.portion)+' · ':''}P ${r1(r.protein)} · C ${r1(r.carbs)} · F ${r1(r.fat)} g</small></div><span class="amt">${r0(r.calories)}</span><div class="ops"><button class="text-button" data-entry-edit="${r.id}" type="button">Edit</button><button class="text-button" data-entry-del="${r.id}" type="button">Delete</button></div></div>`).join('')}</div></div>`; }).join('');
}
function topMacro(r){ const p=r.protein*4,c=r.carbs*4,f=r.fat*9; return p>=c&&p>=f?'protein':c>=f?'carbs':'fat'; }
function renderFoods(){
  $('foods-count').textContent=foods.length?`${foods.length} saved`:'';
  if(!foods.length){ $('foods-list').innerHTML='<p class="row-empty">Foods you save or scan show up here so you can log them in one tap.</p>'; return; }
  $('foods-list').innerHTML=foods.map(f=>`<div class="row"><span class="dot" style="background:${MACRO_COLORS[topMacro(f)]}"></span><div class="who"><b>${esc(f.name)}${f.brand?` <small>${esc(f.brand)}</small>`:''}</b><small class="macro-line">${esc(f.serving)} · P ${r1(f.protein)} · C ${r1(f.carbs)} · F ${r1(f.fat)} g</small></div><span class="amt">${r0(f.calories)}</span><div class="ops"><button class="text-button" data-food-log="${f.id}" type="button">Log</button><button class="text-button" data-food-del="${f.id}" type="button">Remove</button></div></div>`).join('');
}
$('day-prev').onclick=()=>{ day=addDays(day,-1); renderDiary(); }; $('day-next').onclick=()=>{ if(day<today()){ day=addDays(day,1); renderDiary(); } };

// ---- manual / saved-food entry ----
function num(s,label){ const v=Number(String(s).replace(',','.')); if(!Number.isFinite(v)||v<0) throw new Error(`Enter ${label} as a number.`); return Math.round(v*10)/10; }
function openEntry(pre){
  if(!user){ $('connection-dialog').showModal(); return; }
  const p=pre||{};
  $('entry-id').value=p.id||''; $('entry-title').textContent=p.id?'Edit food.':'Add food.'; $('entry-save').textContent=p.id?'Save ↗':'Log it ↗';
  $('entry-name').value=p.name||''; $('entry-brand').value=p.brand||''; $('entry-portion').value=p.portion||''; $('entry-slot').value=p.slot||slotNow();
  $('entry-cal').value=p.calories!=null?r1(p.calories):''; $('entry-p').value=r1(p.protein||0); $('entry-c').value=r1(p.carbs||0); $('entry-f').value=r1(p.fat||0);
  $('entry-date').value=p.eaten_on||day; $('entry-source').value=p.source||'manual'; $('entry-barcode').value=p.barcode||''; $('entry-save-food').checked=!!p.saveFood;
  $('entry-search').value=''; $('entry-results').hidden=true; $('entry-search').closest('label').hidden=!!p.id||!foods.length;
  message('entry-message',''); $('entry-dialog').showModal(); (p.name?$('entry-cal'):(foods.length?$('entry-search'):$('entry-name'))).focus();
}
$('entry-search').addEventListener('input',()=>{ const q=$('entry-search').value.trim().toLowerCase(); const hits=q?foods.filter(f=>(f.name+' '+f.brand).toLowerCase().includes(q)).slice(0,8):[]; $('entry-results').hidden=!hits.length; $('entry-results').innerHTML=hits.map(f=>`<button type="button" data-pick="${f.id}"><span><b>${esc(f.name)}</b><small>${esc(f.brand?f.brand+' · ':'')}${esc(f.serving)} · P ${r1(f.protein)} C ${r1(f.carbs)} F ${r1(f.fat)}</small></span><span>${r0(f.calories)}</span></button>`).join(''); });
$('entry-results').addEventListener('click',e=>{ const b=e.target.closest('[data-pick]'); if(!b)return; const f=foods.find(x=>x.id===b.dataset.pick); if(!f)return; $('entry-name').value=f.name; $('entry-brand').value=f.brand; $('entry-portion').value=f.serving; $('entry-cal').value=r1(f.calories); $('entry-p').value=r1(f.protein); $('entry-c').value=r1(f.carbs); $('entry-f').value=r1(f.fat); $('entry-source').value='saved'; $('entry-barcode').value=f.barcode; $('entry-results').hidden=true; $('entry-search').value=''; $('entry-cal').focus(); });
$('entry-form').addEventListener('submit',async e=>{
  e.preventDefault(); if(busy||!user)return; busy=true; $('entry-save').disabled=true;
  try{
    const row={eaten_on:$('entry-date').value,slot:$('entry-slot').value,name:$('entry-name').value.trim(),brand:$('entry-brand').value.trim(),portion:$('entry-portion').value.trim(),calories:num($('entry-cal').value,'calories'),protein:num($('entry-p').value||'0','protein'),carbs:num($('entry-c').value||'0','carbs'),fat:num($('entry-f').value||'0','fat'),source:$('entry-source').value,barcode:$('entry-barcode').value};
    if(!row.name) throw new Error('Give it a name.'); if(!row.eaten_on) throw new Error('Pick a date.');
    const db=await connect(); const id=$('entry-id').value;
    const q=id?db.from('meal_entries').update(row).eq('id',id):db.from('meal_entries').insert(row); const {error}=await q; if(error)throw error;
    if($('entry-save-food').checked) await saveFood(db,{name:row.name,brand:row.brand,barcode:row.barcode,serving:row.portion||'1 serving',calories:row.calories,protein:row.protein,carbs:row.carbs,fat:row.fat});
    day=row.eaten_on; $('entry-dialog').close(); await load();
  }catch(err){ message('entry-message',err.message||'Could not save.','error'); }
  finally{ busy=false; $('entry-save').disabled=false; }
});
async function saveFood(db,food){
  const existing=food.barcode?foods.find(f=>f.barcode===food.barcode):foods.find(f=>f.name.toLowerCase()===food.name.toLowerCase()&&f.brand.toLowerCase()===food.brand.toLowerCase());
  const q=existing?db.from('foods').update(food).eq('id',existing.id):db.from('foods').insert(food); const {error}=await q; if(error)throw error;
}

// ---- barcode scanner: BarcodeDetector where the browser has it, ZXing everywhere else ----
let scanStream=null,scanTimer=null,zxingReader=null,scanning=false;
function offLookup(code){ return fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=product_name,brands,nutriments,serving_size,serving_quantity`,{headers:{'Accept':'application/json'}}); }
function fromOFF(code,p){
  const n=p.nutriments||{}; const per=k=>Number(n[k+'_serving']); const hund=k=>Number(n[k+'_100g']);
  const hasServing=Number.isFinite(per('energy-kcal'))&&per('energy-kcal')>0; const g=Number(p.serving_quantity)||0;
  const pick=k=>hasServing&&Number.isFinite(per(k))?per(k):(g&&Number.isFinite(hund(k))?hund(k)*g/100:(Number.isFinite(hund(k))?hund(k):0));
  const serving=hasServing||g?(p.serving_size||`${g} g`):'100 g';
  return {name:(p.product_name||'').trim()||`Product ${code}`,brand:(p.brands||'').split(',')[0].trim(),barcode:code,serving,calories:Math.round(pick('energy-kcal')||0),protein:pick('proteins')||0,carbs:pick('carbohydrates')||0,fat:pick('fat')||0};
}
async function lookupBarcode(code){
  code=String(code).replace(/\D/g,''); if(code.length<8) throw new Error('That does not look like a product barcode.');
  const local=foods.find(f=>f.barcode===code); if(local) return {...local,serving:local.serving};
  let r; try{ r=await offLookup(code); }catch{ throw new Error('Could not reach Open Food Facts. Check your connection.'); }
  const j=await r.json().catch(()=>({})); if(!r.ok||j.status===0||!j.product) throw new Error(`Barcode ${code} is not in Open Food Facts yet. Type it in instead and tick "save" so it is here next time.`);
  return fromOFF(code,j.product);
}
function showFound(food){
  $('scan-found').hidden=false; $('scan-found').innerHTML=`<b>${esc(food.name)}</b><small>${esc(food.brand?food.brand+' · ':'')}${esc(food.serving)} · ${r0(food.calories)} kcal · P ${r1(food.protein)} C ${r1(food.carbs)} F ${r1(food.fat)} g</small><button class="primary" id="scan-use" type="button" style="margin-top:12px">Log this ↗</button>`;
  $('scan-use').onclick=()=>{ stopScan(); $('scan-dialog').close(); openEntry({name:food.name,brand:food.brand,portion:food.serving,calories:food.calories,protein:food.protein,carbs:food.carbs,fat:food.fat,source:'barcode',barcode:food.barcode,saveFood:!foods.some(f=>f.barcode===food.barcode)}); };
}
async function onCode(code){ if(scanning)return; scanning=true; message('scan-message','Looking up '+code+'…'); try{ showFound(await lookupBarcode(code)); message('scan-message',''); if(navigator.vibrate)navigator.vibrate(60); } catch(err){ message('scan-message',err.message,'error'); } finally{ setTimeout(()=>{ scanning=false; },2500); } }
async function startScan(){
  const video=$('scan-video'); $('scan-found').hidden=true; message('scan-message','');
  if(!navigator.mediaDevices?.getUserMedia){ message('scan-message','This browser has no camera access. Type the barcode number instead.','error'); return; }
  try{ scanStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720}},audio:false}); video.srcObject=scanStream; await video.play(); }
  catch{ message('scan-message','Camera access was blocked. Allow the camera, or type the number instead.','error'); return; }
  if('BarcodeDetector' in window){
    const det=new BarcodeDetector({formats:['ean_13','ean_8','upc_a','upc_e','code_128']});
    scanTimer=setInterval(async()=>{ if(scanning||video.readyState<2)return; try{ const codes=await det.detect(video); if(codes.length) onCode(codes[0].rawValue); }catch{} },250);
  } else {
    try{
      if(!window.ZXing) await new Promise((ok,bad)=>{ const s=document.createElement('script'); s.src='https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js'; s.onload=ok; s.onerror=bad; document.head.appendChild(s); });
      zxingReader=new ZXing.BrowserMultiFormatReader(); zxingReader.decodeFromStream(scanStream,video,(result)=>{ if(result) onCode(result.getText()); });
    }catch{ message('scan-message','The scanner library could not load. Type the number instead.','error'); }
  }
}
function stopScan(){ clearInterval(scanTimer); scanTimer=null; try{ zxingReader?.reset(); }catch{} zxingReader=null; scanStream?.getTracks().forEach(t=>t.stop()); scanStream=null; $('scan-video').srcObject=null; scanning=false; }
$('scan-open').onclick=()=>{ if(!user){ $('connection-dialog').showModal(); return; } $('scan-code').value=''; $('scan-dialog').showModal(); startScan(); };
$('scan-close').onclick=()=>{ stopScan(); $('scan-dialog').close(); };
$('scan-dialog').addEventListener('close',stopScan);
$('scan-lookup').onclick=()=>{ const c=$('scan-code').value.trim(); if(c) onCode(c); };
$('scan-code').addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); $('scan-lookup').click(); } });

// ---- photo → AI estimate ----
let photoData=null,photoType='image/jpeg',photoItems=[];
function resizeImage(file){ return new Promise((ok,bad)=>{ const img=new Image(); const url=URL.createObjectURL(file); img.onload=()=>{ URL.revokeObjectURL(url); const max=1280; const s=Math.min(1,max/Math.max(img.width,img.height)); const c=document.createElement('canvas'); c.width=Math.round(img.width*s); c.height=Math.round(img.height*s); c.getContext('2d').drawImage(img,0,0,c.width,c.height); ok(c.toDataURL('image/jpeg',.82)); }; img.onerror=()=>{ URL.revokeObjectURL(url); bad(new Error('That file is not an image this browser can read.')); }; img.src=url; }); }
$('photo-file').addEventListener('change',async()=>{ const f=$('photo-file').files[0]; $('photo-results').hidden=true; photoData=null; if(!f)return; try{ photoData=await resizeImage(f); photoType='image/jpeg'; $('photo-preview').src=photoData; $('photo-preview').hidden=false; message('photo-message',''); }catch(err){ message('photo-message',err.message,'error'); } });
$('photo-open').onclick=()=>{ if(!user){ $('connection-dialog').showModal(); return; } $('photo-file').value=''; $('photo-preview').hidden=true; $('photo-results').hidden=true; $('photo-hint').value=''; photoData=null; message('photo-message',''); message('photo-log-message',''); $('photo-slot').value=slotNow(); $('photo-date').value=day; $('photo-dialog').showModal(); };
$('photo-close').onclick=()=>{ if(!busy)$('photo-dialog').close(); };
$('photo-form').addEventListener('submit',async e=>{
  e.preventDefault(); if(busy||!user)return; if(!photoData){ message('photo-message','Pick or take a photo first.','error'); return; }
  busy=true; $('photo-analyze').disabled=true; $('photo-message').innerHTML='<span class="spinner"></span>Looking at your plate…'; $('photo-message').className='message';
  try{
    const db=await connect(); const {data:{session}}=await db.auth.getSession(); if(!session) throw new Error('Sign in again to analyze a photo.');
    const r=await fetch('/api/analyze',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+session.access_token},body:JSON.stringify({image:photoData,media_type:photoType,hint:$('photo-hint').value.trim()})});
    const j=await r.json().catch(()=>({})); if(!r.ok) throw new Error(j.error||'Could not analyze the photo.');
    photoItems=(j.items||[]).map(it=>({name:String(it.name||'Food'),portion:String(it.portion||''),calories:Math.max(0,Math.round(+it.calories||0)),protein:Math.max(0,+it.protein||0),carbs:Math.max(0,+it.carbs||0),fat:Math.max(0,+it.fat||0),confidence:it.confidence||'medium'}));
    if(!photoItems.length){ message('photo-message',j.notes||'No food was found in that photo. Try a closer shot.','error'); return; }
    $('photo-items').innerHTML=photoItems.map((it,i)=>`<label class="item"><span><b>${esc(it.name)}</b><small>${esc(it.portion)} · ${it.calories} kcal · P ${r1(it.protein)} C ${r1(it.carbs)} F ${r1(it.fat)} g</small><span class="conf">${esc(it.confidence)} confidence</span></span><input type="checkbox" data-item="${i}" checked></label>`).join('');
    $('photo-notes').textContent=[j.meal_name?`Looks like: ${j.meal_name}.`:'',j.notes||''].filter(Boolean).join(' ');
    $('photo-results').hidden=false; message('photo-message',`Found ${photoItems.length} item${photoItems.length===1?'':'s'} · ${photoItems.reduce((a,b)=>a+b.calories,0)} kcal total. Untick anything that is wrong.`,'success');
  }catch(err){ message('photo-message',err.message||'Could not analyze the photo.','error'); }
  finally{ busy=false; $('photo-analyze').disabled=false; }
});
$('photo-log').onclick=async()=>{
  if(busy||!user)return; const picked=[...$('photo-items').querySelectorAll('input:checked')].map(i=>photoItems[+i.dataset.item]); if(!picked.length){ message('photo-log-message','Nothing selected.','error'); return; }
  busy=true; $('photo-log').disabled=true;
  try{ const d=$('photo-date').value||today(), slot=$('photo-slot').value; const db=await connect();
    const {error}=await db.from('meal_entries').insert(picked.map(it=>({eaten_on:d,slot,name:it.name,portion:it.portion,calories:it.calories,protein:it.protein,carbs:it.carbs,fat:it.fat,source:'photo'}))); if(error)throw error;
    day=d; $('photo-dialog').close(); await load(); }
  catch(err){ message('photo-log-message',err.message||'Could not save.','error'); }
  finally{ busy=false; $('photo-log').disabled=false; }
};

// ---- goals ----
function openGoals(){ if(!user){ $('connection-dialog').showModal(); return; } $('goal-cal').value=r0(goals.calories); $('goal-p').value=r0(goals.protein); $('goal-c').value=r0(goals.carbs); $('goal-f').value=r0(goals.fat); message('goals-message',''); $('goals-dialog').showModal(); $('goal-cal').focus(); }
$('goals-open').onclick=openGoals; $('cal-goal').onclick=openGoals; $('side-goal-link').onclick=e=>{ e.preventDefault(); openGoals(); };
$('goals-close').onclick=()=>{ if(!busy)$('goals-dialog').close(); };
$('goals-form').addEventListener('submit',async e=>{
  e.preventDefault(); if(busy||!user)return; busy=true; $('goals-save').disabled=true;
  try{ const row={user_id:user.id,calories:num($('goal-cal').value,'calories'),protein:num($('goal-p').value,'protein'),carbs:num($('goal-c').value,'carbs'),fat:num($('goal-f').value,'fat'),updated_at:new Date().toISOString()}; if(row.calories<=0) throw new Error('Calories must be above zero.');
    const db=await connect(); const {error}=await db.from('meal_goals').upsert(row,{onConflict:'user_id'}); if(error)throw error; $('goals-dialog').close(); await load(); }
  catch(err){ message('goals-message',err.message||'Could not save.','error'); }
  finally{ busy=false; $('goals-save').disabled=false; }
});

// ---- wiring ----
$('add-open').onclick=()=>openEntry(); $('manual-open').onclick=()=>openEntry();
$('entry-close').onclick=()=>{ if(!busy)$('entry-dialog').close(); };
for(const id of ['entry-dialog','photo-dialog','goals-dialog','connection-dialog']) $(id).addEventListener('cancel',e=>{ if(busy)e.preventDefault(); });
document.addEventListener('click',async e=>{
  const b=e.target.closest('button[data-entry-edit],button[data-entry-del],button[data-food-log],button[data-food-del]'); if(!b||busy)return;
  if(b.dataset.entryEdit) return openEntry(entries.find(r=>r.id===b.dataset.entryEdit));
  if(b.dataset.foodLog){ const f=foods.find(x=>x.id===b.dataset.foodLog); return openEntry({name:f.name,brand:f.brand,portion:f.serving,calories:f.calories,protein:f.protein,carbs:f.carbs,fat:f.fat,source:'saved',barcode:f.barcode}); }
  const table=b.dataset.entryDel?'meal_entries':'foods', id=b.dataset.entryDel||b.dataset.foodDel;
  if(!confirm(table==='meal_entries'?'Delete this from your diary?':'Remove this saved food?'))return;
  busy=true; try{ const db=await connect(); const {error}=await db.from(table).delete().eq('id',id); if(error)throw error; await load(); } catch(err){ message('history-message',err.message||'Could not delete.','error'); } finally{ busy=false; }
});
document.querySelectorAll('[data-range]').forEach(b=>b.onclick=()=>{ range=b.dataset.range; document.querySelectorAll('[data-range]').forEach(x=>x.setAttribute('aria-pressed',String(x===b))); render(); });

// Reconnect a saved session, if any.
render();
connect().catch(()=>{});
})();
