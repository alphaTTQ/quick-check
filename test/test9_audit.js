// 第1回外部監査（HOLD）指摘の再現経路テスト（引き継ぎ_監査対応_第1回.md）
// 修正1〜6それぞれについて、監査で再現された経路が塞がっていることを固定する。
const fs=require('fs'), vm=require('vm'), crypto=require('crypto');
const path=require('path');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');

function mkEl(){ return {
  innerHTML:'', textContent:'', className:'', value:'', open:false,
  style:{}, dataset:{}, offsetWidth:0,
  classList:{add(){},remove(){},toggle(){},contains:()=>false},
  addEventListener(){}, appendChild(){}, insertAdjacentElement(){}, remove(){},
  querySelector:()=>null, querySelectorAll:()=>[],
  showModal(){this.open=true;}, close(){this.open=false;},
  select(){}, focus(){}, click(){},
};}
const els=new Map();
const doc={
  getElementById:id=>{ if(!els.has(id)) els.set(id, mkEl()); return els.get(id); },
  querySelector:()=>null, querySelectorAll:()=>[], createElement:()=>mkEl(),
  addEventListener(){}, dispatchEvent(){}, body:mkEl(), documentElement:mkEl(),
};
const ctx={
  console, TextDecoder, TextEncoder, setTimeout, clearTimeout,
  document:doc,
  location:{protocol:'https:', hostname:'example.test', host:'example.test'},
  navigator:{}, matchMedia:()=>({matches:false, addEventListener(){}}),
  addEventListener(){}, confirm:()=>true,
  requestAnimationFrame:()=>0, cancelAnimationFrame(){},
  crypto:{getRandomValues:a=>crypto.randomFillSync(a)},
  URL:{createObjectURL:()=>'', revokeObjectURL(){}}, Image:function(){},
};
ctx.window=ctx; ctx.globalThis=ctx;
vm.createContext(ctx);
const mm=html.match(/var DRUG_MASTER_RAW ?= ?[\s\S]*?;\r?\n/);
vm.runInContext(mm?mm[0]:'var DRUG_MASTER_RAW="";', ctx);
vm.runInContext('var DRUG_MASTER_INFO=null;', ctx);
vm.runInContext(html.slice(html.lastIndexOf('<script>')+8, html.lastIndexOf('</script>')), ctx);
const api=vm.runInContext(
  '({processScanned, parseJahis, Store, recordKeys, candidateKey, bakImport, confirmCandidate, rejectCandidates, getState:()=>state, getMeta:()=>compareMeta, getPending:()=>pendingScan})', ctx);
const {processScanned, parseJahis, Store, recordKeys, candidateKey, bakImport}=api;

let fail=0; const ok=(c,m)=>{console.log((c?'PASS':'FAIL')+'  '+m); if(!c)fail++;};
const result=()=>doc.getElementById('result').innerHTML;
const scanMsg=()=>doc.getElementById('msg-scan').textContent;

const PATIENT=['11,,日薬 太郎,ﾆﾁﾔｸ ﾀﾛｳ','12,1','13,19600606'];
const KANA_ONLY=['11,,,ﾆﾁﾔｸ ﾀﾛｳ','12,1','13,19600606'];
const KANJI_ONLY=['11,,日薬 太郎,','12,1','13,19600606'];
const BODY=(date)=>['51,'+date,'101,1,1,,28','111,1,1,,１日１回朝食後,1',
  '201,1,1,1,2,612170709,ノルバスク錠２．５ｍｇ,1,1,錠'];
const RX=(hospLine, patient, date)=>['JAHIS10',hospLine,'4,2,01,内科',...patient,...BODY(date)].join('\r\n');

(async()=>{
  await Store.init();

  /* ===== 修正1: 医療機関コード欠落 ===== */
  const noCodeA=parseJahis(['JAHIS10','1,1,,13,Ａ病院',...PATIENT,...BODY('20260213')].join('\r\n'));
  const noCodeB=parseJahis(['JAHIS10','1,1,,13,Ｂ病院',...PATIENT,...BODY('20260313')].join('\r\n'));
  ok(recordKeys(noCodeA,'salt').length===0, '1-1. 機関コード欠落では照合キーを作らない');
  ok(candidateKey(noCodeA,'salt')==='', '1-2. 候補キーも作らない');
  await processScanned(noCodeA);
  ok(api.getMeta().mode==='first' && api.getMeta().noSave===true, '1-3. コード欠落Ａ病院: 保存対象外');
  ok(scanMsg().includes('医療機関コード'), '1-4. 理由（医療機関コード）を明示');
  ok((await Store.all()).length===0, '1-5. 保存されない');
  await processScanned(noCodeB);
  ok(api.getMeta().mode==='first', '1-6. コード欠落Ｂ病院がＡ病院と比較されない（別病院合流の遮断）');

  /* ===== 修正2: 交付日不明 ===== */
  await processScanned(parseJahis(RX('1,1,1234567,13,Ａ病院', PATIENT, '20260313')));
  ok((await Store.all()).length===1 && (await Store.all())[0].date==='20260313', '2-0. 基準となる保存を作成');
  const noDate=parseJahis(['JAHIS10','1,1,1234567,13,Ａ病院','4,2,01,内科',...PATIENT,
    '101,1,1,,28','111,1,1,,１日１回朝食後,1',
    '201,1,1,1,2,612170710,ノルバスク錠５ｍｇ,1,1,錠'].join('\r\n'));   // 51レコードなし
  await processScanned(noDate);
  ok(api.getMeta().mode==='compare' && api.getMeta().dateUnknown===true, '2-1. 交付日不明: 比較は表示するが新旧判定しない');
  ok(result().includes('新しい処方か判定できません'), '2-2. 判定不能を画面に明示');
  ok((await Store.all())[0].date==='20260313', '2-3. 既存保存は置換されない');
  // 初回で交付日不明 → 保存しない
  await Store.clear();
  await processScanned(noDate);
  ok(api.getMeta().mode==='first' && api.getMeta().noSave===true, '2-4. 初回でも交付日不明は保存しない');
  ok((await Store.all()).length===0, '2-5. 保存件数0のまま');

  /* ===== 修正6: 自由記述の保存除外 ===== */
  await Store.clear();
  const freeText=parseJahis(['JAHIS10','1,1,1234567,13,Ａ病院','4,2,01,内科',...PATIENT,
    '51,20260313','81,1,,患者Ｘ様 訪問時に手渡し',
    '101,1,1,,28','111,1,1,,１日１回朝食後,1','181,1,1,2,一包化,,',
    '201,1,1,1,2,612170709,ノルバスク錠２．５ｍｇ,1,1,錠','281,1,1,1,2,粉砕,'].join('\r\n'));
  await processScanned(freeText);
  const saved=(await Store.all())[0];
  ok(!!saved, '6-0. 保存はされる');
  ok(!saved.text.includes('患者Ｘ様') && !saved.text.includes('一包化') && !saved.text.includes('粉砕'),
     '6-1. 備考81・用法補足181・薬品補足281の自由記述が保存に含まれない');
  ok(!/^81,|\r\n81,|\r\n181,|\r\n281,/.test(saved.text), '6-2. レコード81/181/281自体が保存されない');
  // 保存分（補足なし）との比較で「指示の違い」を誤検出しない
  const withSupp=parseJahis(['JAHIS10','1,1,1234567,13,Ａ病院','4,2,01,内科',...PATIENT,
    '51,20260413','101,1,1,,28','111,1,1,,１日１回朝食後,1','181,1,1,2,一包化,,',
    '201,1,1,1,2,612170709,ノルバスク錠２．５ｍｇ,1,1,錠','281,1,1,1,2,粉砕,'].join('\r\n'));
  await processScanned(withSupp);
  ok(api.getMeta().mode==='compare', '6-3. 比較は成立する');
  ok(!result().includes('薬品への指示') && !result().includes('剤への指示'),
     '6-4. 保存分に無い指示を「変更」として誤表示しない');
  ok(result().includes('指示・備考は保存対象外'), '6-5. 指示を比較していない旨を明示');

  /* ===== 修正5: カナ⇔漢字の候補提示＋手動確認 ===== */
  await Store.clear();
  await processScanned(parseJahis(RX('1,1,1234567,13,Ａ病院', KANA_ONLY, '20260213')));
  ok((await Store.all()).length===1, '5-0. カナのみで初回保存');
  await processScanned(parseJahis(RX('1,1,1234567,13,Ａ病院', KANJI_ONLY, '20260313')));
  ok(api.getMeta().mode==='candidates', '5-1. 漢字のみ読取: 初回と断定せず候補提示');
  ok(result().includes('同一患者として比較') && result().includes('別人として初回扱い'),
     '5-2. 候補確認のUIが出る（自動で1件に決めない）');
  const candId=(api.getPending().candidates[0]||{}).id;
  await api.confirmCandidate(candId);
  ok(api.getMeta().mode==='compare', '5-3. 確認後は比較が表示される');
  ok((await Store.all()).length===1, '5-4. レコードが統合されている（分裂しない）');
  // 統合後は自動照合される
  await processScanned(parseJahis(RX('1,1,1234567,13,Ａ病院', KANJI_ONLY, '20260413')));
  ok(api.getMeta().mode==='compare' && api.getMeta().storedSide==='prev', '5-5. 以後は漢字のみでも自動比較');
  await processScanned(parseJahis(RX('1,1,1234567,13,Ａ病院', KANA_ONLY, '20260513')));
  ok(api.getMeta().mode==='compare', '5-6. カナのみでも自動比較（逆方向）');
  // 逆方向: 漢字のみ保存 → カナのみ読取
  await Store.clear();
  await processScanned(parseJahis(RX('1,1,1234567,13,Ａ病院', KANJI_ONLY, '20260213')));
  await processScanned(parseJahis(RX('1,1,1234567,13,Ａ病院', KANA_ONLY, '20260313')));
  ok(api.getMeta().mode==='candidates', '5-7. 漢字保存→カナ読取も候補提示になる');
  await api.rejectCandidates();
  ok(api.getMeta().mode==='first' && (await Store.all()).length===2, '5-8. 「別人」選択で独立レコードとして保存');

  /* ===== 修正3: バックアップ取込の検証・再strip ===== */
  await Store.clear();
  const salt='0123456789abcdef0123456789abcdef';
  const k1='a'.repeat(64);
  const rawWithName='JAHIS10\r\n1,1,1234567,13,Ａ病院\r\n11,,日薬 太郎,\r\n13,19600606\r\n51,20260313\r\n'+
    '101,1,1,,28\r\n111,1,1,,１日１回朝食後,1\r\n81,1,,患者メモ\r\n201,1,1,1,2,612170709,ノルバスク錠２．５ｍｇ,1,1,錠\r\n';
  const good={format:'shohousen-kansa/1', salt, records:[
    {id:'r1', keys:[k1], cand:'', date:'20260313', savedAt:Date.now(), text:rawWithName}]};
  doc.getElementById('bakArea').value=JSON.stringify(good);
  await bakImport();
  let recs=await Store.all();
  ok(recs.length===1, '3-1. 正常バックアップは取り込める');
  ok(!recs[0].text.includes('日薬') && !recs[0].text.includes('19600606') && !recs[0].text.includes('患者メモ'),
     '3-2. 取込時に再stripされ、氏名・生年月日・自由記述が保存に入らない');
  const bad=JSON.parse(JSON.stringify(good));
  bad.records.push({id:'r2', keys:['not-hex'], date:'20260101', savedAt:1, text:'JAHIS10\r\n'});
  doc.getElementById('bakArea').value=JSON.stringify(bad);
  await bakImport();
  recs=await Store.all();
  ok(recs.length===1 && recs[0].id==='r1', '3-3. 不正1件を含むバックアップは全体拒否（部分取込しない）');
  const old=JSON.parse(JSON.stringify(good));
  old.records[0]={id:'r3', keys:[k1], date:'', savedAt:Date.now(), text:'JAHIS10\r\n'};   // 旧形式(交付日なし)
  doc.getElementById('bakArea').value=JSON.stringify(old);
  await bakImport();
  ok((await Store.all())[0].id==='r1', '3-4. 交付日なしの旧形式レコードは拒否される');

  /* ===== 修正4: housekeeping失敗のfail-closed ===== */
  Store._test.failHousekeeping=true;
  await Store.init();
  ok(!!Store.degraded, '4-1. housekeeping失敗でdegraded状態になる');
  await processScanned(parseJahis(RX('1,1,1234567,13,Ａ病院', PATIENT, '20260313')));
  ok(api.getMeta().noSave===true, '4-2. degraded中は保存・自動比較をしない');
  ok(scanMsg().includes('停止'), '4-3. 停止中であることを利用者に通知');
  const before=(await Store.all()).length;
  ok(before===1, '4-4. 保存件数が増えていない（r1のみ）');
  Store._test.failHousekeeping=false;
  await Store.init();
  ok(!Store.degraded, '4-5. 復旧後はdegraded解除');

  process.exit(fail?1:0);
})().catch(e=>{ console.error('EXEC ERROR', e); process.exit(1); });
