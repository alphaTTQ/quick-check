// 比較ロジックの純関数テスト（引き継ぎ完了条件5）
// キー一致判定は test4_store.js、フロー統合は test7_flow.js。
// ここでは「この2枚ならこの判定」を関数単体で固定する。
const fs=require('fs'), vm=require('vm'), crypto=require('crypto');
const path=require('path');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const app=html.slice(html.lastIndexOf('<script>')+8, html.lastIndexOf('</script>'));
const core=app.slice(0, app.lastIndexOf('/* ===', app.indexOf('4. 画面描画')));
const ctx={console,TextDecoder,TextEncoder,crypto:{getRandomValues:a=>crypto.randomFillSync(a)}};
vm.createContext(ctx); vm.runInContext(core, ctx);
const {scannedIsCurrent, decideScan, purgeDue, chooseRecord}=
  vm.runInContext('({scannedIsCurrent, decideScan, purgeDue, chooseRecord})', ctx);

let fail=0; const ok=(c,m)=>{console.log((c?'PASS':'FAIL')+'  '+m); if(!c)fail++;};

/* ---------- scannedIsCurrent: 新旧判定 ---------- */
ok(scannedIsCurrent('20260213','20260313')===true,  '読んだ方が新しい → 今回');
ok(scannedIsCurrent('20260313','20260213')===false, '読んだ方が古い → 前回');
ok(scannedIsCurrent('20260313','20260313')===true,  '同日 → 読んだ方が今回');
ok(scannedIsCurrent('','20260313')===true,          '保存側の日付不明 → 読んだ方が今回');
ok(scannedIsCurrent('20260313','')===true,          '読んだ方の日付不明 → 読んだ方が今回');
ok(scannedIsCurrent('','')===true,                  '両方不明 → 読んだ方が今回');

/* ---------- decideScan: 画面の役割分担と保存の置き換え ---------- */
ok(decideScan(null,'20260313').mode==='first', '保存なし → 初回');
let d=decideScan({date:'20260213'},'20260313');
ok(d.mode==='compare' && d.scannedRole==='curr' && d.replaceStored===true,
   '新しい紙: 読んだ方=今回・保存を置き換える');
d=decideScan({date:'20260313'},'20260213');
ok(d.mode==='compare' && d.scannedRole==='prev' && d.replaceStored===false,
   '古い紙: 読んだ方=前回・保存は置き換えない');
d=decideScan({date:'20260313'},'20260313');
ok(d.scannedRole==='curr' && d.replaceStored===true, '同日: 読んだ方=今回・読み直しを反映');
d=decideScan({date:''},'20260313');
ok(d.scannedRole==='curr' && d.replaceStored===true, '保存側日付なし: 読んだ方=今回');

/* ---------- 画面の役割と保存の置き換えが常に一致する（食い違い禁止の不変条件） ---------- */
const dates=['','20250101','20260213','20260313','20261231'];
let consistent=true;
for(const s of dates) for(const c of dates){
  const dd=decideScan({date:s}, c);
  const save=chooseRecord({date:s}, c)==='save';
  if(dd.replaceStored!==save) consistent=false;
  if((dd.scannedRole==='curr')!==dd.replaceStored) consistent=false;
}
ok(consistent, '全date組合せで「画面の今回扱い」⇔「保存の置き換え」が一致する（25通り）');

/* ---------- purgeDue: 90日purge対象判定 ---------- */
const DAY=86400000, now=1770000000000;
ok(purgeDue({savedAt: now-89*DAY}, now, 90)===false, '89日前 → 残す');
ok(purgeDue({savedAt: now-90*DAY}, now, 90)===false, 'ちょうど90日 → 残す（90日「で」削除は91日目から）');
ok(purgeDue({savedAt: now-90*DAY-1}, now, 90)===true, '90日+1ms → 削除');
ok(purgeDue({savedAt: now-365*DAY}, now, 90)===true, '1年前 → 削除');
ok(purgeDue({}, now, 90)===true, 'savedAt記録なし → 安全側で削除');
ok(purgeDue({savedAt: now}, now, 90)===false, 'いま保存したもの → 残す');

process.exit(fail?1:0);
