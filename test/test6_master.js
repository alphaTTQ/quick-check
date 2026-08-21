// コード表による名称補完のテスト（納品HTMLから抽出して実行）
const fs=require('fs'), vm=require('vm'), crypto=require('crypto');
const html=fs.readFileSync(require('path').join(__dirname,'..','index.html'),'utf8');
// マスタデータのスクリプトを取り出す
const mm=html.match(/var DRUG_MASTER_RAW ?= ?[\s\S]*?;\r?\n/);
const app=html.slice(html.lastIndexOf('<script>')+8, html.lastIndexOf('</script>'));
const core=app.slice(0, app.lastIndexOf('/* ===', app.indexOf('4. 画面描画')));
const ctx={console,TextDecoder,TextEncoder,crypto:{getRandomValues:a=>crypto.randomFillSync(a)}};
vm.createContext(ctx);
vm.runInContext(mm[0], ctx);
vm.runInContext(core, ctx);
const {parseJahis, DrugDict, compare}=vm.runInContext('({parseJahis, DrugDict, compare})', ctx);
let fail=0; const ok=(c,m)=>{console.log((c?'PASS':'FAIL')+'  '+m); if(!c)fail++;};

ok(DrugDict.loaded, 'コード表がロードできる');
ok(DrugDict.lookup('2','610406079')==='ガスター散２％', 'レセ電算9桁→名称（種別2）');
ok(DrugDict.lookup('4','2325003B2029')==='ガスター散２％', 'YJコード→名称（種別4）');
ok(DrugDict.lookup('3','2325003B2029')==='ガスター散２％', '厚生省コード→名称（種別3）');
ok(DrugDict.lookup('7','2325003B2ZZZ')==='【般】ファモチジン散２％', '一般名コード→一般名称（種別7）');
ok(DrugDict.lookup('2','999999999')===null, '未知のコードは null');
ok(DrugDict.lookup('2','')===null, '空コードは null');

// 名称省略の処方せんが補完されて表示・突合に使えること
const rx=parseJahis(['JAHIS10','51,20260313','101,1,1,,28','111,1,1,,１日１回朝食後,1',
  '201,1,1,1,2,610406079,,2,1,ｇ'].join('\r\n'));
ok(rx.drugs[0].名称==='ガスター散２％', '名称省略レコードがマスタで補完される');
ok(rx.drugs[0].名称補完===true, '補完フラグが立つ');

const rx2=parseJahis(['JAHIS10','51,20260213','101,1,1,,28','111,1,1,,１日１回朝食後,1',
  '201,1,1,1,2,610406079,ガスター散２％,2,1,ｇ'].join('\r\n'));
const r=compare(rx2, rx);
ok(r.counts.same===1 && r.counts.chg===0, '名称あり（前回）と名称省略（今回）が同一薬として突合される');

// 名称が記録されている場合はそれを優先（マスタで上書きしない）
const rx3=parseJahis(['JAHIS10','51,20260313','101,1,1,,28','111,1,1,,毎食後,3',
  '201,1,1,1,2,610406079,ガスター散２％〈院内表記〉,2,1,ｇ'].join('\r\n'));
ok(rx3.drugs[0].名称==='ガスター散２％〈院内表記〉' && !rx3.drugs[0].名称補完, '記録済みの名称はそのまま使う');

process.exit(fail?1:0);
