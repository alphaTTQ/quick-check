// 取り込み1本化フローの検証: 初回→新→旧→同日→別診療科→診療科なし→purge
// アプリ全体のスクリプトを DOM スタブ上で実行する
const fs=require('fs'), vm=require('vm'), crypto=require('crypto');
const path=require('path');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');

// DOMスタブ
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
  navigator:{},
  matchMedia:()=>({matches:false, addEventListener(){}}),
  addEventListener(){},
  confirm:()=>true,
  requestAnimationFrame:()=>0, cancelAnimationFrame(){},
  crypto:{getRandomValues:a=>crypto.randomFillSync(a)},
  URL:{createObjectURL:()=>'', revokeObjectURL(){}},
  Image:function(){},
};
ctx.window=ctx; ctx.globalThis=ctx;
vm.createContext(ctx);

// マスタ行（ビルド済みindex.htmlのもの）とアプリ本体スクリプトを実行
const mm=html.match(/var DRUG_MASTER_RAW ?= ?[\s\S]*?;\r?\n/);
vm.runInContext(mm?mm[0]:'var DRUG_MASTER_RAW="";', ctx);
vm.runInContext('var DRUG_MASTER_INFO=null;', ctx);
const app=html.slice(html.lastIndexOf('<script>')+8, html.lastIndexOf('</script>'));
vm.runInContext(app, ctx);

const api=vm.runInContext('({processScanned, parseJahis, Store, getState:()=>state, getMeta:()=>compareMeta})', ctx);
const {processScanned, parseJahis, Store}=api;

let fail=0; const ok=(c,m)=>{console.log((c?'PASS':'FAIL')+'  '+m); if(!c)fail++;};
const result=()=>doc.getElementById('result').innerHTML;
const scanMsg=()=>doc.getElementById('msg-scan').textContent;

const RX=(hosp,dept,date,drug)=>['JAHIS10',hosp,...(dept?[dept]:[]),
  '11,,日薬 太郎,ﾆﾁﾔｸ ﾀﾛｳ','12,1','13,19600606','51,'+date,
  '101,1,1,,28','111,1,1,,１日１回朝食後,1',drug].join('\r\n');
const A='1,1,1234567,13,Ａ病院', NAIKA='4,2,01,内科', SEIKEI='4,2,09,整形外科';
const dA='201,1,1,1,2,612170709,ノルバスク錠２．５ｍｇ,1,1,錠';
const dB='201,1,1,1,2,612170710,ノルバスク錠５ｍｇ,1,1,錠';

(async()=>{
  await Store.init();
  ok(Store.mode==='memory', 'Node環境ではメモリ保存にフォールバックする（動作確認用）');

  // 1) 初回
  await processScanned(parseJahis(RX(A,NAIKA,'20260213',dA)));
  ok(api.getMeta().mode==='first', '1. 初回は first モード');
  ok(result().includes('初回（比較対象なし）'), '1. 「初回（比較対象なし）」を明示');
  ok(result().includes('Ａ病院') && result().includes('内科'), '1. どのキーの初回かを表示');
  ok((await Store.all()).length===1, '1. 保存1件');

  // 2) 新しい処方を読む → 比較・保存更新
  await processScanned(parseJahis(RX(A,NAIKA,'20260313',dB)));
  ok(api.getMeta().mode==='compare' && api.getMeta().storedSide==='prev', '2. 新→旧: 保存分が前回側');
  ok(result().includes('比較対象') && result().includes('保存から自動取得'), '2. 比較対象と出所を明示');
  ok((await Store.all()).length===1 && (await Store.all())[0].date==='20260313', '2. 保存が新しい方に置き換わる');

  // 3) 古い紙をあとから読む → 前回側として比較・保存は最新のまま
  await processScanned(parseJahis(RX(A,NAIKA,'20260213',dA)));
  ok(api.getMeta().storedSide==='curr', '3. 旧→新: 読んだ方が前回側になる');
  ok(result().includes('保存分より古いため'), '3. 逆転の説明を表示');
  ok((await Store.all())[0].date==='20260313', '3. 保存は最新のまま上書きされない');

  // 4) 同日・内容違い（訂正処方せん）→ 読んだ方が今回
  //    ※ 同日・内容も同一の場合は「すでに登録済み」となり取り込まない（test12_rescan）
  const dC='201,1,1,1,2,612170711,ノルバスク錠１０ｍｇ,1,1,錠';
  await processScanned(parseJahis(RX(A,NAIKA,'20260313',dC)));
  ok(api.getMeta().storedSide==='prev', '4. 同日交付（内容違い）は読んだ方を「今回」とする');

  // 5) 同一患者・同一機関でも診療科が違えば初回
  await processScanned(parseJahis(RX(A,SEIKEI,'20260313',dA)));
  ok(api.getMeta().mode==='first', '5. 別診療科は比較されず初回になる');

  // 6) 診療科なしも独立キー
  await processScanned(parseJahis(RX(A,null,'20260313',dA)));
  ok(api.getMeta().mode==='first', '6. 診療科なしは内科と混同されず初回になる');
  ok((await Store.all()).length===3, '6. 保存は3キー分（内科・整形外科・診療科なし）');

  // 7) 患者情報が保存に残らない
  const dump=JSON.stringify(await Store.all());
  ok(!['日薬','ﾆﾁﾔｸ','19600606'].some(x=>dump.includes(x)), '7. 保存に氏名・生年月日が残らない');

  // 8) 90日purge
  await Store.putRec({id:'old', keys:['oldkey'], date:'20250101',
                      savedAt:Date.now()-91*86400000, text:'JAHIS10\r\n'});
  ok((await Store.all()).length===4, '8. 91日前の擬似レコードを投入');
  await Store.init();   // 起動時のhousekeepingを再実行
  const after=await Store.all();
  ok(after.length===3 && !after.some(r=>r.id==='old'), '8. 90日を過ぎた保存が自動削除される');

  // 9) 患者情報なしのQRは保存しない
  await processScanned(parseJahis(['JAHIS10',A,'51,20260313','101,1,1,,28',
    '111,1,1,,毎食後,3',dA].join('\r\n')));
  ok(api.getMeta().mode==='first' && api.getMeta().noSave===true, '9. 患者情報なしは表示のみ（noSave）');
  ok((await Store.all()).length===3, '9. 保存件数は増えない');

  process.exit(fail?1:0);
})().catch(e=>{ console.error('EXEC ERROR', e); process.exit(1); });
