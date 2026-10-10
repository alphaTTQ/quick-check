// 処方履歴（90日）による薬ごとの突合
// ・定期の間に臨時処方が挟まっても、定期薬は最後に出た日と比べて「継続」になる
// ・中止は処方日数（＋来局遅れの猶予）で判定、頓服・外用は直前の処方で判定
// ・旧形式（直近1回）の保存を引き継ぐ／旧DBは触らない／90日後に後片付け
// ・バックアップ（新旧形式）
const fs=require('fs'), vm=require('vm'), crypto=require('crypto');
const path=require('path');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');

let fail=0; const ok=(c,m)=>{console.log((c?'PASS':'FAIL')+'  '+m); if(!c)fail++;};

function mkEl(){ const el={ innerHTML:'', textContent:'', className:'', value:'', open:false,
  style:{}, dataset:{}, offsetWidth:0,
  classList:{add(){},remove(){},toggle(){},contains:()=>false},
  addEventListener(){}, appendChild(){}, insertAdjacentElement(){}, remove(){},
  querySelector:()=>null, querySelectorAll:()=>[],
  showModal(){el.open=true;}, close(){el.open=false;}, select(){}, focus(){}, click(){} }; return el; }
function makeLS(init){
  return { _s:Object.assign({}, init||{}),
    getItem(k){ return this._s[k]===undefined?null:this._s[k]; },
    setItem(k,v){ this._s[k]=String(v); }, removeItem(k){ delete this._s[k]; } };
}
function makeApp(extra){
  const els=new Map();
  const doc={ getElementById:id=>{ if(!els.has(id)) els.set(id, mkEl()); return els.get(id); },
    querySelector:()=>mkEl(), querySelectorAll:()=>[], createElement:()=>mkEl(),
    addEventListener(){}, dispatchEvent(){}, body:mkEl(), documentElement:mkEl() };
  const ctx={ console, TextDecoder, TextEncoder, setTimeout, clearTimeout, document:doc,
    location:{protocol:'https:', hostname:'example.test', host:'example.test'},
    navigator:{}, matchMedia:()=>({matches:false, addEventListener(){}}),
    addEventListener(){}, confirm:()=>true, requestAnimationFrame:()=>0, cancelAnimationFrame(){},
    crypto:{getRandomValues:a=>crypto.randomFillSync(a)},
    URL:{createObjectURL:()=>'', revokeObjectURL(){}}, Image:function(){}, ...(extra||{}) };
  ctx.window=ctx; ctx.globalThis=ctx;
  vm.createContext(ctx);
  const mm=html.match(/var DRUG_MASTER_RAW ?= ?[\s\S]*?;\r?\n/);
  vm.runInContext(mm?mm[0]:'var DRUG_MASTER_RAW="";', ctx);
  vm.runInContext('var DRUG_MASTER_INFO=null;', ctx);
  vm.runInContext(html.slice(html.lastIndexOf('<script>')+8, html.lastIndexOf('</script>')), ctx);
  const api=vm.runInContext(`({processScanned, parseJahis, Store, compareHistory, recordKeys,
    validateBackup, exportData, bakImport, showKindList, loadDemo, stripForStorage,
    getMeta:()=>compareMeta, getLast:()=>lastCompare})`, ctx);
  api.doc=doc;
  return api;
}

/* ---------- 処方せんの組み立て ---------- */
const HEAD=['JAHIS10','1,1,1234567,13,Ａ内科','4,2,01,内科','11,,日薬 太郎,ﾆﾁﾔｸ ﾀﾛｳ','12,1','13,19600606'];
const AMLO25='201,{rp},{seq},1,2,612170709,ノルバスク錠２．５ｍｇ,1,1,錠';
const AMLO5 ='201,{rp},{seq},1,2,612170710,ノルバスク錠５ｍｇ,1,1,錠';
const ROSU  ='201,{rp},{seq},1,2,620000001,クレストール錠２．５ｍｇ,1,1,錠';
const MET2  ='201,{rp},{seq},1,2,620004321,メトホルミン塩酸塩錠２５０ｍｇ,2,1,錠';
const MET3  ='201,{rp},{seq},1,2,620004321,メトホルミン塩酸塩錠２５０ｍｇ,3,1,錠';
const NEX   ='201,{rp},{seq},1,2,620009999,ネキシウムカプセル２０ｍｇ,1,1,カプセル';
const CLAR  ='201,{rp},{seq},1,2,620008888,クラリスロマイシン錠２００ｍｇ,2,1,錠';
const CALO  ='201,{rp},{seq},1,2,620098701,カロナール錠５００,1,1,錠';
const LOXO  ='201,{rp},{seq},1,2,662620001,ロキソプロフェンＮａテープ１００ｍｇ,14,1,枚';
/** rps: [{kind:'1'|'2'|'3', days, use, drugs:[...]}] */
function RX(date, rps){
  const L=[...HEAD, '51,'+date];
  rps.forEach((rp,i)=>{
    const no=i+1;
    L.push(`101,${no},${rp.kind||'1'},,${rp.days}`, `111,${no},1,,${rp.use||'１日１回朝食後'},1`);
    rp.drugs.forEach((d,j)=>L.push(d.replace('{rp}',no).replace('{seq}',j+1)));
  });
  return L.join('\r\n');
}
const TEIKI=(date, drugs)=>RX(date,[{days:28, drugs}]);
const kindOf=(r,name)=>{ const x=r.rows.find(x=>((x.curr||x.prev).名称||'').includes(name)); return x?x.kind:'(なし)'; };
const rowOf=(r,name)=>r.rows.find(x=>((x.curr||x.prev).名称||'').includes(name));

(async()=>{
  /* ===== A. 定期 → 臨時 → 定期（今回の要望の中心） ===== */
  {
    const api=makeApp(); await api.Store.init();
    await api.processScanned(api.parseJahis(TEIKI('20260213',[AMLO25,ROSU,MET2])));
    await api.processScanned(api.parseJahis(RX('20260227',[{days:5, use:'１日２回朝夕食後', drugs:[CLAR]}])));
    await api.processScanned(api.parseJahis(TEIKI('20260313',[AMLO25,ROSU,MET2])));
    const r=api.getLast();
    ok(api.getMeta().mode==='compare' && api.getMeta().history.length===2, 'A-1. 3/13は履歴2件（2/13定期・2/27臨時）と突合');
    ok(['ノルバスク','クレストール','メトホルミン'].every(n=>kindOf(r,n)==='same'),
       'A-2. 定期薬は臨時を飛び越えて2/13と比べ「継続」（以前は「新規」と誤表示）');
    ok(rowOf(r,'ノルバスク').lastDate==='20260213', 'A-3. 前回処方日 2/13 を保持');
    ok(kindOf(r,'クラリス')==='(なし)', 'A-4. 期間の終わった臨時薬（2/27・5日分）は「中止」に出さない');
    ok(r.counts.del===0 && r.counts.add===0 && r.counts.chg===0 && r.counts.same===3, 'A-5. 件数: 中止0・新規0・変更0・継続3');
    const out=api.doc.getElementById('result').innerHTML;
    ok(out.includes('2/13') && out.includes('比較した履歴 2件'), 'A-6. 画面に前回処方日と比較した履歴件数を表示');
    ok((await api.Store.all()).length===3, 'A-7. 3枚とも履歴に残る');
  }

  /* ===== B〜D. 中止の判定（処方日数＋猶予） ===== */
  {
    const H=[{date:'20260213', rx:null}], api=makeApp();
    const prev=api.parseJahis(TEIKI('20260213',[AMLO25,ROSU]));
    const hist=[{date:'20260213', rx:prev}];
    const fresh=()=>[{date:'20260213', rx:api.parseJahis(TEIKI('20260213',[AMLO25,ROSU]))}];
    let r=api.compareHistory(api.parseJahis(TEIKI('20260313',[AMLO25])), fresh(), '20260313');
    ok(kindOf(r,'クレストール')==='del' && rowOf(r,'クレストール').lastDate==='20260213', 'B-1. 定期薬が止まった → 中止（最終 2/13）');
    r=api.compareHistory(api.parseJahis(TEIKI('20260323',[AMLO25])), fresh(), '20260323');
    ok(kindOf(r,'クレストール')==='del', 'C-1. 10日遅れの来局（3/23）でも中止として検出（猶予14日）');
    r=api.compareHistory(api.parseJahis(TEIKI('20260420',[AMLO25])), fresh(), '20260420');
    ok(kindOf(r,'クレストール')==='(なし)', 'D-1. 期限（3/26）を大きく過ぎた来局では中止に出さない');
    ok(rowOf(r,'ノルバスク').gapNote.includes('間が空いています'), 'D-2. 間が空いた継続薬には「再開の可能性」を表示');
    void H; void hist;
  }

  /* ===== E〜F. 臨時薬の再処方・頓服 ===== */
  {
    const api=makeApp();
    const hist=()=>[
      {date:'20260227', rx:api.parseJahis(RX('20260227',[{days:5, drugs:[CLAR]}]))},
      {date:'20260213', rx:api.parseJahis(RX('20260213',[{days:28, drugs:[AMLO25]},{kind:'2', days:10, use:'疼痛時', drugs:[CALO]}]))},
    ];
    let r=api.compareHistory(api.parseJahis(RX('20260313',[{days:28,drugs:[AMLO25]},{days:5,drugs:[CLAR]}])), hist(), '20260313');
    ok(kindOf(r,'クラリス')==='same' && rowOf(r,'クラリス').lastDate==='20260227', 'E-1. 臨時薬が再び出たら直近の臨時（2/27）と比べる');
    r=api.compareHistory(api.parseJahis(TEIKI('20260313',[AMLO25])), hist(), '20260313');
    ok(kindOf(r,'カロナール')==='(なし)', 'F-1. 頓服は直前の処方（2/27）に無ければ中止に出さない');
    const hist2=()=>[
      {date:'20260227', rx:api.parseJahis(RX('20260227',[{kind:'2', days:10, use:'疼痛時', drugs:[CALO]}]))},
      {date:'20260213', rx:api.parseJahis(TEIKI('20260213',[AMLO25]))},
    ];
    r=api.compareHistory(api.parseJahis(TEIKI('20260313',[AMLO25])), hist2(), '20260313');
    ok(kindOf(r,'カロナール')==='del', 'F-2. 直前の処方に入っていた頓服が今回ない → 中止');
    const histTape=()=>[{date:'20260213', rx:api.parseJahis(RX('20260213',[{kind:'3', days:1, use:'１日２回貼付', drugs:[LOXO]}]))}];
    r=api.compareHistory(api.parseJahis(TEIKI('20260313',[AMLO25])), histTape(), '20260313');
    ok(kindOf(r,'ロキソ')==='del', 'F-3. 外用も直前の処方に入っていて今回ない → 中止');
  }

  /* ===== G〜I. 変更・規格切替・新規 ===== */
  {
    const api=makeApp();
    let r=api.compareHistory(api.parseJahis(TEIKI('20260313',[MET3,NEX])),
      [{date:'20260213', rx:api.parseJahis(TEIKI('20260213',[MET2]))}], '20260313');
    const m=rowOf(r,'メトホルミン');
    ok(m.kind==='chg' && m.changes.some(c=>c.k==='用量'&&c.a==='2錠'&&c.b==='3錠') && m.lastDate==='20260213',
       'G-1. 用量変更は最後に出た日（2/13）の内容と比べる');
    ok(kindOf(r,'ネキシウム')==='add', 'I-1. 過去90日に記録のない薬は新規');
    r=api.compareHistory(api.parseJahis(TEIKI('20260301',[AMLO5])), [
      {date:'20260215', rx:api.parseJahis(TEIKI('20260215',[AMLO5]))},
      {date:'20260201', rx:api.parseJahis(TEIKI('20260201',[AMLO25]))}], '20260301');
    ok(r.rows.filter(x=>x.kind==='del').length===0 && kindOf(r,'ノルバスク錠５')==='same',
       'H-1. 規格を切り替えた後の古い規格（2.5mg）は中止に出さない');
    r=api.compareHistory(api.parseJahis(TEIKI('20260313',[AMLO5])),
      [{date:'20260213', rx:api.parseJahis(TEIKI('20260213',[AMLO25]))}], '20260313');
    ok(r.rows.length===1 && r.rows[0].kind==='chg' && r.rows[0].spec, 'H-2. 規格だけ違う場合は「規格変更の可能性」');
  }

  /* ===== J. 交付日不明 ===== */
  {
    const api=makeApp(); await api.Store.init();
    await api.processScanned(api.parseJahis(TEIKI('20260213',[AMLO25])));
    const noDate=TEIKI('20260313',[AMLO25]).replace(/\r\n51,20260313/,'');
    await api.processScanned(api.parseJahis(noDate));
    ok(api.getMeta().mode==='compare' && api.getMeta().dateUnknown===true, 'J-1. 交付日不明でも全記録と比較は表示');
    ok((await api.Store.all()).length===1, 'J-2. 交付日不明は履歴に追加しない');
  }

  /* ===== K〜M. 旧形式（直近1回）からの引き継ぎ ===== */
  {
    // 旧版で保存されたデータを作る（同じ塩で鍵を作らないと引き継いでも照合できない）
    const oldSalt='0123456789abcdef0123456789abcdef';
    const helper=makeApp();
    const oldRx=helper.parseJahis(TEIKI('20260213',[AMLO25,ROSU]));
    const keys=helper.recordKeys(oldRx, oldSalt);
    const oldRec={id:keys[0], keys, cand:'', date:'20260213', savedAt:Date.now()-5*86400000,
                  text:helper.stripForStorage(oldRx.raw)};
    const oldLS={shohousen_kansa_v1:JSON.stringify({salt:oldSalt, recs:{[keys[0]]:oldRec}, meta_schema:3})};
    const ls=makeLS(oldLS);
    const api=makeApp({localStorage:ls, indexedDB:undefined});
    await api.Store.init();
    ok(api.Store.mode==='local' && !api.Store.degraded, 'K-1. 新しい保存領域で起動');
    const recs=await api.Store.all();
    ok(recs.length===1 && recs[0].date==='20260213', 'K-2. 旧形式の保存（直近1回分）を履歴の1件目として引き継ぐ');
    ok((await api.Store.getSalt())===oldSalt, 'K-3. 照合鍵の塩も引き継ぐ（同じ患者が引き続き照合できる）');
    await api.processScanned(api.parseJahis(TEIKI('20260313',[AMLO25])));
    ok(api.getMeta().mode==='compare' && kindOf(api.getLast(),'クレストール')==='del',
       'K-4. 引き継いだ記録と比較できる（クレストール中止を検出）');
    ok(ls._s.shohousen_kansa_v1===oldLS.shohousen_kansa_v1, 'L-1. 旧形式のデータには手を付けない（旧版に戻しても使える）');
    // 再起動しても二重に引き継がない
    await api.Store.init();
    ok((await api.Store.all()).length===2, 'L-2. 再起動しても引き継ぎは1回だけ（消したものが復活しない）');
    // 移行から90日経過 → 旧データを削除
    const st=JSON.parse(ls._s.quickcheck_hist_v1);
    st.meta_migratedAt=Date.now()-91*86400000;
    ls._s.quickcheck_hist_v1=JSON.stringify(st);
    const api2=makeApp({localStorage:ls, indexedDB:undefined});
    await api2.Store.init();
    ok(ls._s.shohousen_kansa_v1===undefined, 'M-1. 移行から90日後に旧形式のデータを削除（中身は全て期限切れのため）');
    // 旧形式が別の鍵方式（schema 2 以前）なら引き継がない
    const api3=makeApp({localStorage:makeLS({shohousen_kansa_v1:JSON.stringify({salt:oldSalt, recs:{[keys[0]]:oldRec}, meta_schema:2})}), indexedDB:undefined});
    await api3.Store.init();
    ok((await api3.Store.all()).length===0, 'M-2. 鍵の作り方が違う古い形式は引き継がない');
  }

  /* ===== N. バックアップ ===== */
  {
    const api=makeApp(); await api.Store.init();
    await api.processScanned(api.parseJahis(TEIKI('20260213',[AMLO25])));
    await api.processScanned(api.parseJahis(TEIKI('20260313',[AMLO25,NEX])));
    await api.exportData();
    const dump=api.doc.getElementById('bakArea').value;
    const data=JSON.parse(dump);
    ok(data.format==='quickcheck/2' && data.records.length===2, 'N-1. 書き出しは新形式・履歴2件');
    ok(api.validateBackup(data).ok===true, 'N-2. 同一患者の履歴（鍵を共有）をそのまま取り込める');
    const legacy={format:'shohousen-kansa/1', salt:data.salt, records:[data.records[0]]};
    ok(api.validateBackup(legacy).ok===true, 'N-3. 旧形式の書き出しも取り込める');
    const api2=makeApp(); await api2.Store.init();
    api2.doc.getElementById('bakArea').value=dump;
    await api2.bakImport();
    ok((await api2.Store.all()).length===2, 'N-4. 別端末への取り込みで履歴が再現される');
    await api2.processScanned(api2.parseJahis(TEIKI('20260410',[AMLO25])));
    ok(api2.getMeta().history.length===2, 'N-5. 取り込んだ履歴と比較できる');
  }

  /* ===== O. 一覧ポップアップに前回処方日 ===== */
  {
    const api=makeApp(); await api.Store.init();
    await api.processScanned(api.parseJahis(TEIKI('20260213',[AMLO25,ROSU,MET2])));
    await api.processScanned(api.parseJahis(TEIKI('20260313',[AMLO25,MET3])));
    api.showKindList('chg');
    ok(api.doc.getElementById('listBody').innerHTML.includes('前回 2/13'), 'O-1. 変更ありの一覧に前回処方日');
    api.showKindList('del');
    ok(api.doc.getElementById('listBody').innerHTML.includes('クレストール') &&
       api.doc.getElementById('listBody').innerHTML.includes('前回 2/13'), 'O-2. 中止の一覧に最終処方日');
  }

  /* ===== P. テストモード（デモ）は臨時が挟まる例 ===== */
  {
    const api=makeApp(); await api.Store.init();
    api.loadDemo();
    const r=api.getLast();
    ok(kindOf(r,'クラリス')==='(なし)' && kindOf(r,'クレストール')==='del',
       'P-1. デモ: 臨時の抗菌薬は中止に出ず、止まった定期薬は中止に出る');
    ok((await api.Store.all()).length===0, 'P-2. デモは保存しない');
  }

  process.exit(fail?1:0);
})().catch(e=>{ console.error('EXEC ERROR', e); process.exit(1); });
