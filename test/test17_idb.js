// 実装準拠のIndexedDB（fake-indexeddb）で、実機と同じ経路を検証する
// 実行には fake-indexeddb が必要: npm install --no-save fake-indexeddb@6.0.0
// （無い環境では SKIPPED と表示して正常終了する）
// 1. 旧DB（v1.2.x: shohousen_kansa / rx / schema3）からの引き継ぎ
// 2. 旧DBが無い端末では旧DBを作らない
// 3. 履歴の追加・インデックス検索・薬ごとの突合
// 4. 旧DBは引き継ぎ後も変更されない（旧版に戻せる）
const fs=require('fs'), vm=require('vm'), crypto=require('crypto');
let IDBFactory;
try{ ({IDBFactory}=require('fake-indexeddb')); }
catch(e){ console.log('SKIPPED: fake-indexeddb が無いためこのテストは実行しません（npm install --no-save fake-indexeddb@6.0.0）'); process.exit(0); }
const html=fs.readFileSync(require('path').join(__dirname,'..','index.html'),'utf8');
let fail=0; const ok=(c,m)=>{console.log((c?'PASS':'FAIL')+'  '+m); if(!c)fail++;};

function mkEl(){ const el={ innerHTML:'', textContent:'', className:'', value:'', open:false, style:{}, dataset:{},
  classList:{add(){},remove(){},toggle(){},contains:()=>false}, addEventListener(){}, appendChild(){},
  insertAdjacentElement(){}, remove(){}, querySelector:()=>null, querySelectorAll:()=>[],
  showModal(){}, close(){}, select(){}, focus(){}, click(){} }; return el; }
function makeApp(indexedDB){
  const els=new Map();
  const doc={ getElementById:id=>{ if(!els.has(id)) els.set(id, mkEl()); return els.get(id); },
    querySelector:()=>mkEl(), querySelectorAll:()=>[], createElement:()=>mkEl(),
    addEventListener(){}, dispatchEvent(){}, body:mkEl(), documentElement:mkEl() };
  const ctx={ console, TextDecoder, TextEncoder, setTimeout, clearTimeout, document:doc, indexedDB,
    location:{protocol:'https:', hostname:'x.test', host:'x.test'}, navigator:{},
    matchMedia:()=>({matches:false, addEventListener(){}}), addEventListener(){}, confirm:()=>true,
    requestAnimationFrame:()=>0, cancelAnimationFrame(){}, crypto:{getRandomValues:a=>crypto.randomFillSync(a)},
    URL:{createObjectURL:()=>'', revokeObjectURL(){}}, Image:function(){} };
  ctx.window=ctx; ctx.globalThis=ctx;
  vm.createContext(ctx);
  const mm=html.match(/var DRUG_MASTER_RAW ?= ?[\s\S]*?;\r?\n/);
  vm.runInContext(mm?mm[0]:'var DRUG_MASTER_RAW="";', ctx);
  vm.runInContext('var DRUG_MASTER_INFO=null;', ctx);
  vm.runInContext(html.slice(html.lastIndexOf('<script>')+8, html.lastIndexOf('</script>')), ctx);
  return vm.runInContext('({processScanned, parseJahis, Store, recordKeys, stripForStorage, getMeta:()=>compareMeta, getLast:()=>lastCompare})', ctx);
}
const req=r=>new Promise((res,rej)=>{ r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); });
const HEAD=['JAHIS10','1,1,1234567,13,Ａ内科','4,2,01,内科','11,,日薬 太郎,ﾆﾁﾔｸ ﾀﾛｳ','12,1','13,19600606'];
const RX=(date,drugs,days)=>[...HEAD,'51,'+date,`101,1,1,,${days||28}`,'111,1,1,,１日１回朝食後,1',
  ...drugs.map((d,i)=>`201,1,${i+1},1,2,${d}`)].join('\r\n');
const AMLO='612170709,ノルバスク錠２．５ｍｇ,1,1,錠', ROSU='620000001,クレストール錠２．５ｍｇ,1,1,錠',
      CLAR='620008888,クラリスロマイシン錠２００ｍｇ,2,1,錠';

(async()=>{
  /* --- 旧DBが無い端末 --- */
  {
    const idb=new IDBFactory();
    const api=makeApp(idb);
    await api.Store.init();
    ok(api.Store.mode==='idb' && !api.Store.degraded, '1-1. IndexedDBで起動');
    const dbs=await idb.databases();
    const old=dbs.find(d=>d.name==='shohousen_kansa');
    ok(dbs.some(d=>d.name==='quickcheck_hist') && (!old || old.version===0), '1-2. 旧DBが無い端末では旧DBを作らない（中断で残る空のバージョン0以外は無い）');
    // 定期 → 臨時 → 定期
    await api.processScanned(api.parseJahis(RX('20260213',[AMLO,ROSU])));
    await api.processScanned(api.parseJahis(RX('20260227',[CLAR],5)));
    await api.processScanned(api.parseJahis(RX('20260313',[AMLO,ROSU])));
    const r=api.getLast();
    ok(api.getMeta().history.length===2, '1-3. インデックス検索で同一患者の履歴2件を取得');
    ok(r.counts.same===2 && r.counts.del===0 && r.counts.add===0, '1-4. 臨時を挟んでも定期薬は継続・臨時薬は中止に出ない');
    ok((await api.Store.all()).length===3, '1-5. 3枚とも保存');
    // 再起動で消えない（永続化）
    const api2=makeApp(idb); await api2.Store.init();
    ok((await api2.Store.all()).length===3, '1-6. 再起動後も履歴が残る');
  }

  /* --- 旧DB（v1.2.x）がある端末 --- */
  {
    const idb=new IDBFactory();
    const salt='0123456789abcdef0123456789abcdef';
    const helper=makeApp(new IDBFactory());
    const oldRx=helper.parseJahis(RX('20260213',[AMLO,ROSU]));
    const keys=helper.recordKeys(oldRx, salt);
    const oldRec={id:keys[0], keys, cand:'', date:'20260213', savedAt:Date.now()-3*86400000, text:helper.stripForStorage(oldRx.raw)};
    // v1.2.x と同じ構造で旧DBを作る
    const odbRq=idb.open('shohousen_kansa',1);
    odbRq.onupgradeneeded=()=>{ const s=odbRq.result.createObjectStore('rx',{keyPath:'id'});
      s.createIndex('keys','keys',{multiEntry:true}); odbRq.result.createObjectStore('meta'); };
    const odb=await req(odbRq);
    await new Promise(res=>{ const tx=odb.transaction(['rx','meta'],'readwrite');
      tx.objectStore('rx').put(oldRec); tx.objectStore('meta').put(3,'schema'); tx.objectStore('meta').put(salt,'salt');
      tx.oncomplete=res; });
    odb.close();

    const api=makeApp(idb);
    await api.Store.init();
    ok(!api.Store.degraded, '2-1. 旧DBのある端末で起動');
    const recs=await api.Store.all();
    ok(recs.length===1 && recs[0].date==='20260213', '2-2. 旧DBの記録を引き継ぐ');
    ok((await api.Store.getSalt())===salt, '2-3. 塩も引き継ぐ');
    await api.processScanned(api.parseJahis(RX('20260313',[AMLO])));
    ok(api.getMeta().mode==='compare' && api.getLast().counts.del===1, '2-4. 引き継いだ記録と比較できる（中止を検出）');
    // 旧DBが無傷であること
    const odb2=await req(idb.open('shohousen_kansa',1));
    const oldAll=await req(odb2.transaction('rx','readonly').objectStore('rx').getAll());
    const oldSchema=await req(odb2.transaction('meta','readonly').objectStore('meta').get('schema'));
    odb2.close();
    ok(oldAll.length===1 && oldSchema===3, '2-5. 旧DBは変更されない（旧版に戻せば元の状態で使える）');
    // 2回目の起動で引き継ぎをやり直さない
    const api2=makeApp(idb); await api2.Store.init();
    ok((await api2.Store.all()).length===2, '2-6. 引き継ぎは1回だけ');
  }

  /* --- 移行から90日後: 旧DBを削除（起動は止まらない） --- */
  {
    const idb=new IDBFactory();
    const o=await req((()=>{ const r=idb.open('shohousen_kansa',1); r.onupgradeneeded=()=>{ r.result.createObjectStore('rx',{keyPath:'id'}); r.result.createObjectStore('meta'); }; return r; })());
    await new Promise(res=>{ const tx=o.transaction('meta','readwrite'); tx.objectStore('meta').put(3,'schema'); tx.oncomplete=res; });
    o.close();
    const api=makeApp(idb); await api.Store.init();
    // 移行時刻を91日前に書き換えて再起動
    const n=await req(idb.open('quickcheck_hist',1));
    await new Promise(res=>{ const tx=n.transaction('meta','readwrite'); tx.objectStore('meta').put(Date.now()-91*86400000,'migratedAt'); tx.oncomplete=res; });
    n.close();
    const t0=Date.now();
    const api2=makeApp(idb); await api2.Store.init();
    ok(Date.now()-t0<5000 && !api2.Store.degraded, '3-1. 旧DB削除を試みても起動は止まらない');
    const names=(await idb.databases()).map(d=>d.name);
    ok(!names.includes('shohousen_kansa'), '3-2. 移行から90日後に旧DBを削除');
  }

  process.exit(fail?1:0);
})().catch(e=>{ console.error('EXEC ERROR', e); process.exit(1); });
