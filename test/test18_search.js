// 履歴検索と、過去の監査結果の再表示
// ・医療機関・診療科・薬品名・交付日で保存済みの処方を探せる（ひらがな・全角数字も可）
// ・氏名で探せるのは、この画面を開いてから読んだ患者だけ（氏名は保存しない）
// ・選ぶと、その処方の交付日より前の履歴で突合し直して表示する（保存は変えない）
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
  const api=vm.runInContext(`({processScanned, parseJahis, Store, stripForStorage, recordKeys,
    openSearch, runSearch, reviewRecord, parseDateQuery, filterSearch,
    getHits:()=>searchHits, getMeta:()=>compareMeta, getLast:()=>lastCompare, getView:()=>currentView})`, ctx);
  api.doc=doc;
  api.search=async q=>{ doc.getElementById('searchInput').value=q; await api.openSearch(); return api.getHits(); };
  return api;
}

const HEAD_A=['JAHIS10','1,1,1234567,13,Ａ内科','4,2,01,内科','11,,日薬 太郎,ﾆﾁﾔｸ ﾀﾛｳ','12,1','13,19600606'];
const HEAD_B=['JAHIS10','1,1,7654321,13,Ｂ整形外科<b>','4,2,10,整形外科','11,,薬局 花子,ﾔｯｷｮｸ ﾊﾅｺ','12,2','13,19700101'];
const D={
  AMLO25:'ノルバスク錠２．５ｍｇ', AMLO5:'ノルバスク錠５ｍｇ', ROSU:'クレストール錠２．５ｍｇ',
  CLAR:'クラリスロマイシン錠２００ｍｇ', CALO:'カロナール錠５００'};
const CODE={AMLO25:'612170709', AMLO5:'612170710', ROSU:'620000001', CLAR:'620008888', CALO:'620098701'};
function RX(head, date, days, drugs){
  return [...head, '51,'+date, `101,1,1,,${days}`, '111,1,1,,１日１回朝食後,1',
    ...drugs.map((k,i)=>`201,1,${i+1},1,2,${CODE[k]},${D[k]},1,1,錠`)].join('\r\n');
}

(async()=>{
  /* ===== S1. 日付の検索語 ===== */
  {
    const api=makeApp();
    const q=t=>JSON.stringify(api.parseDateQuery(t));
    ok(q('3/13')==='{"m":3,"d":13}', 'S1-1. 3/13 は月日');
    ok(q('2026/3/13')==='{"y":2026,"m":3,"d":13}' && q('20260313')==='{"y":2026,"m":3,"d":13}', 'S1-2. 年月日（区切りあり・8桁）');
    ok(q('3月13日')==='{"m":3,"d":13}' && q('3月')==='{"m":3}', 'S1-3. 3月13日・3月');
    ok(api.parseDateQuery('2.5')===null && api.parseDateQuery('ノルバスク')===null, 'S1-4. 含量（2.5）や薬品名は日付扱いしない');
  }

  const ls=makeLS();
  const opt={localStorage:ls, indexedDB:undefined};
  const api=makeApp(opt); await api.Store.init();
  // 患者A: 2/13 定期 → 2/27 臨時（5日） → 3/13 定期（規格変更・ロスバスタチン中止）
  await api.processScanned(api.parseJahis(RX(HEAD_A,'20260213',28,['AMLO25','ROSU'])));
  await api.processScanned(api.parseJahis(RX(HEAD_A,'20260227',5,['CLAR'])));
  await api.processScanned(api.parseJahis(RX(HEAD_A,'20260313',28,['AMLO5'])));
  const atScan=JSON.stringify(api.getLast().counts);
  // 患者B: 別の医療機関
  await api.processScanned(api.parseJahis(RX(HEAD_B,'20260313',7,['CALO'])));

  /* ===== S2. 検索 ===== */
  {
    let h=await api.search('');
    ok(h.length===4 && h[0].rec.date==='20260313' && h[3].rec.date==='20260213', 'S2-1. 空欄なら全件を新しい順');
    ok(api.doc.getElementById('searchDlg').open===true, 'S2-2. 検索ダイアログが開く');
    h=await api.search('クレストール');
    ok(h.length===1 && h[0].rec.date==='20260213', 'S2-3. 薬品名で探せる');
    h=await api.search('くれすとーる');
    ok(h.length===1, 'S2-4. ひらがなでも探せる');
    h=await api.search('3/13');
    ok(h.length===2, 'S2-5. 交付日（3/13）で探せる');
    h=await api.search('３／１３　ａ内科');
    ok(h.length===1 && h[0].rec.date==='20260313', 'S2-6. 全角・全角スペース区切りの複数条件（すべてを含む）');
    h=await api.search('整形');
    ok(h.length===1, 'S2-7. 診療科・医療機関名で探せる');
    h=await api.search('日薬');
    ok(h.length===3, 'S2-8. この画面で読んだ患者は氏名で探せる（同じ患者の記録すべて）');
    h=await api.search('存在しない薬');
    ok(h.length===0 && api.doc.getElementById('searchBody').innerHTML.includes('該当する記録はありません'), 'S2-9. 該当なしの表示');
    await api.search('');
    const body=api.doc.getElementById('searchBody').innerHTML;
    const recs=await api.Store.all();
    ok(!recs.some(r=>body.includes(r.id)), 'S2-10. 記録のidを画面のHTMLに埋め込まない');
    ok(body.includes('&lt;b&gt;') && !body.includes('<b>'), 'S2-11. 医療機関名などはエスケープして表示');
    ok(body.includes('日薬 太郎') && body.includes('2026/3/13'), 'S2-12. 一覧に交付日と（読んだ患者なら）氏名を表示');
  }

  /* ===== S3. 再表示（検索から） ===== */
  {
    const n=(await api.Store.all()).length;
    const h=await api.search('3/13 ノルバスク');
    await api.reviewRecord(h[0].rec, null, true);
    const m=api.getMeta();
    ok(m.mode==='compare' && m.history.length===2 && m.review.fromSearch===true, 'S3-1. その日より前の履歴2件と突合し直す');
    ok(JSON.stringify(api.getLast().counts)===atScan, 'S3-2. 読取時と同じ結果（中止・新規・変更・継続の件数が一致）');
    ok((await api.Store.all()).length===n, 'S3-3. 再表示では保存しない');
    ok(api.getView()==='result', 'S3-4. 結果画面に表示');
    const res=api.doc.getElementById('result').innerHTML;
    ok(res.includes('保存済みの記録を再表示') && res.includes('data-search-back'), 'S3-5. 再表示である旨と「検索に戻る」');
    ok(res.includes('日薬 太郎'), 'S3-6. この画面で読んだ患者は氏名も表示');
    ok(res.includes('計算し直した'), 'S3-7. 計算し直した結果である注意書き');

    const h2=await api.search('2/13');
    await api.reviewRecord(h2[0].rec, null, true);
    const m2=api.getMeta();
    ok(m2.mode==='first' && m2.noSave===true && m2.newerDate==='20260313', 'S3-8. 最初の処方は比較対象なし（保存はしない）');
    ok(!api.doc.getElementById('result').innerHTML.includes('今回の内容を保存しました'), 'S3-9. 再表示で「保存しました」と出さない');
  }

  /* ===== S4. 氏名は保存しない（開き直すと氏名では探せない） ===== */
  {
    const raw=JSON.stringify(ls._s);
    ok(!raw.includes('日薬') && !raw.includes('ﾆﾁﾔｸ') && !raw.includes('薬局 花子'), 'S4-1. 保存領域に氏名は入らない');
    const api2=makeApp(opt); await api2.Store.init();
    ok((await api2.search('日薬')).length===0, 'S4-2. 開き直した後は氏名では探せない');
    ok((await api2.search('ノルバスク')).length===2, 'S4-3. 薬品名ではそのまま探せる');
    const h=await api2.search('3/13 ノルバスク');
    await api2.reviewRecord(h[0].rec, null, true);
    ok(JSON.stringify(api2.getLast().counts)===atScan, 'S4-4. 開き直した後も同じ監査結果を再表示できる');
    ok(api2.doc.getElementById('result').innerHTML.includes('氏名は保存していません'), 'S4-5. 氏名欄は「保存していません」');
  }

  /* ===== S5. 件数が多いとき ===== */
  {
    const api3=makeApp(); await api3.Store.init();
    const salt=await api3.Store.getSalt();
    const recs=[];
    for(let i=0;i<105;i++){
      const date='2026'+String(1+Math.floor(i/28)).padStart(2,'0')+String(1+i%28).padStart(2,'0');
      const rx=api3.parseJahis(RX(HEAD_A,date,28,['AMLO25']));
      recs.push({id:api3.Store.randomHex(32), keys:api3.recordKeys(rx,salt), cand:'', date, savedAt:Date.now(), text:api3.stripForStorage(rx.raw)});
    }
    await api3.Store.putMany(recs);
    const h=await api3.search('');
    ok(h.length===100 && api3.doc.getElementById('searchCount').textContent.includes('105件'), 'S5-1. 表示は新しい100件まで・総件数は表示');
    ok((await api3.search('4月')).every(e=>e.rec.date.slice(4,6)==='04'), 'S5-2. 「4月」で月を絞れる');
  }

  process.exit(fail?1:0);
})().catch(e=>{ console.error('EXEC ERROR', e); process.exit(1); });
