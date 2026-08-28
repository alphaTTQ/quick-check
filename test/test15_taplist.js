// 突合結果の件数タップ → 薬品一覧ポップアップ
// 変更ありは名前＋相違点、中止・新規・継続は名前のみ
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
const els=new Map();
const doc={ getElementById:id=>{ if(!els.has(id)) els.set(id, mkEl()); return els.get(id); },
  querySelector:()=>mkEl(), querySelectorAll:()=>[], createElement:()=>mkEl(),
  addEventListener(){}, dispatchEvent(){}, body:mkEl(), documentElement:mkEl() };
const ctx={ console, TextDecoder, TextEncoder, setTimeout, clearTimeout, document:doc,
  location:{protocol:'https:', hostname:'example.test', host:'example.test'},
  navigator:{}, matchMedia:()=>({matches:false, addEventListener(){}}),
  addEventListener(){}, confirm:()=>true, requestAnimationFrame:()=>0, cancelAnimationFrame(){},
  crypto:{getRandomValues:a=>crypto.randomFillSync(a)},
  URL:{createObjectURL:()=>'', revokeObjectURL(){}}, Image:function(){} };
ctx.window=ctx; ctx.globalThis=ctx;
vm.createContext(ctx);
const mm=html.match(/var DRUG_MASTER_RAW ?= ?[\s\S]*?;\r?\n/);
vm.runInContext(mm?mm[0]:'var DRUG_MASTER_RAW="";', ctx);
vm.runInContext('var DRUG_MASTER_INFO=null;', ctx);
vm.runInContext(html.slice(html.lastIndexOf('<script>')+8, html.lastIndexOf('</script>')), ctx);
const api=vm.runInContext('({processScanned,parseJahis,Store,showKindList})', ctx);

/* ===== マークアップ ===== */
ok(html.includes('data-kind="del"') && html.includes('data-kind="add"') &&
   html.includes('data-kind="chg"') && html.includes('data-kind="same"'),
   '1. 4つの件数タイルがタップ可能（data-kind付き）');
ok(html.includes('id="listDlg"') && html.includes('id="listBody"'), '2. 一覧ダイアログがある');
ok(html.includes('件数をタップすると薬品の一覧を表示します'), '3. タップできることの案内がある');

/* ===== 動作 ===== */
const P=['11,,日薬 太郎,ﾆﾁﾔｸ ﾀﾛｳ','12,1','13,19600606'];
const RX=(date,drugs)=>['JAHIS10','1,1,1234567,13,Ａ病院','4,2,01,内科',...P,'51,'+date,
  '101,1,1,,28','111,1,1,,１日１回朝食後,1',...drugs].join('\r\n');
// 前回: クレストール(中止予定)・メトホルミン(変更予定)・アムロジピン(継続予定)
const PREV=RX('20260213',[
  '201,1,1,1,2,620000001,クレストール錠２．５ｍｇ,1,1,錠',
  '201,1,2,1,2,620004321,メトホルミン塩酸塩錠２５０ｍｇ,2,1,錠',
  '201,1,3,1,2,612170709,ノルバスク錠２．５ｍｇ,1,1,錠']);
// 今回: ネキシウム(新規)・メトホルミン増量(変更)・アムロジピン(継続)
const CURR=RX('20260313',[
  '201,1,1,1,2,620009999,ネキシウムカプセル２０ｍｇ,1,1,カプセル',
  '201,1,2,1,2,620004321,メトホルミン塩酸塩錠２５０ｍｇ,3,1,錠',
  '201,1,3,1,2,612170709,ノルバスク錠２．５ｍｇ,1,1,錠']);

(async()=>{
  await api.Store.init();
  await api.processScanned(api.parseJahis(PREV));
  await api.processScanned(api.parseJahis(CURR));

  const body=()=>doc.getElementById('listBody').innerHTML;
  const title=()=>doc.getElementById('listTitle').textContent;
  const dlg=doc.getElementById('listDlg');

  api.showKindList('del');
  ok(dlg.open===true, '4. タップでダイアログが開く');
  ok(title().includes('中止')&&title().includes('1件'), '5. 中止: タイトルに区分と件数');
  ok(body().includes('クレストール'), '6. 中止: 薬品名が出る');
  ok(!body().includes('chg-list') && !body().includes('錠 ×'), '7. 中止: 名前のみ（相違点・用量は出さない）');

  api.showKindList('add');
  ok(body().includes('ネキシウム') && !body().includes('chg-list'), '8. 新規: 名前のみ');

  api.showKindList('same');
  ok(body().includes('ノルバスク') && !body().includes('chg-list'), '9. 継続: 名前のみ');
  ok(!body().includes('メトホルミン'), '10. 継続に変更ありの薬品は混ざらない');

  api.showKindList('chg');
  ok(body().includes('メトホルミン'), '11. 変更あり: 薬品名が出る');
  ok(body().includes('chg-list') && body().includes('用量') && body().includes('2錠') && body().includes('3錠'),
     '12. 変更あり: 相違点（用量 2錠→3錠）が出る');
  ok(!body().includes('クレストール') && !body().includes('ネキシウム'), '13. 変更ありに中止・新規は混ざらない');

  // 0件の区分
  api.showKindList('chg');           // まず内容を入れてから
  const before=body();
  await api.processScanned(api.parseJahis(RX('20260413',[
    '201,1,1,1,2,620009999,ネキシウムカプセル２０ｍｇ,1,1,カプセル',
    '201,1,2,1,2,620004321,メトホルミン塩酸塩錠２５０ｍｇ,3,1,錠',
    '201,1,3,1,2,612170709,ノルバスク錠２．５ｍｇ,1,1,錠'])));
  api.showKindList('del');
  ok(body().includes('該当する薬品はありません'), '14. 0件の区分は「該当なし」を表示');

  process.exit(fail?1:0);
})().catch(e=>{ console.error('EXEC ERROR', e); process.exit(1); });
