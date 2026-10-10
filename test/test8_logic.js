// 判定ロジックの純関数テスト
// 日付計算・処方日数・中止判定の期限・90日purge。
// 履歴突合（compareHistory）のシナリオは test16_history.js。
const fs=require('fs'), vm=require('vm'), crypto=require('crypto');
const path=require('path');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const app=html.slice(html.lastIndexOf('<script>')+8, html.lastIndexOf('</script>'));
const core=app.slice(0, app.lastIndexOf('/* ===', app.indexOf('4. 画面描画')));
const ctx={console,TextDecoder,TextEncoder,crypto:{getRandomValues:a=>crypto.randomFillSync(a)}};
vm.createContext(ctx); vm.runInContext(core, ctx);
const {addDays, supplyDays, stopWatchUntil, purgeDue, mdText, STOP_GRACE_MIN}=
  vm.runInContext('({addDays, supplyDays, stopWatchUntil, purgeDue, mdText, STOP_GRACE_MIN})', ctx);

let fail=0; const ok=(c,m)=>{console.log((c?'PASS':'FAIL')+'  '+m); if(!c)fail++;};

/* ---------- addDays ---------- */
ok(addDays('20260213',28)==='20260313', '2/13 + 28日 = 3/13');
ok(addDays('20260227',5)==='20260304', '2/27 + 5日 = 3/4（月またぎ）');
ok(addDays('20240228',1)==='20240229', '閏年: 2024/2/28 + 1日 = 2/29');
ok(addDays('20251231',1)==='20260101', '年またぎ');
ok(addDays('20260313',0)==='20260313', '0日は同日');

/* ---------- supplyDays（内服の日数） ---------- */
ok(supplyDays({剤形区分:'1', 調剤数量:'28'})===28, '内服28日分');
ok(supplyDays({剤形区分:'4', 調剤数量:'14'})===14, '内服滴剤14日分');
ok(supplyDays({剤形区分:'2', 調剤数量:'10'})===null, '頓服は日数として扱わない（回数）');
ok(supplyDays({剤形区分:'3', 調剤数量:'1'})===null, '外用は日数として扱わない');
ok(supplyDays({剤形区分:'1', 調剤数量:''})===null, '日数が読めなければ null');

/* ---------- stopWatchUntil（中止とみなす期限 = 最終服用日 + 猶予） ---------- */
// 28日分: 最終服用日 3/12、猶予 max(7, 14)=14日 → 3/26
ok(stopWatchUntil('20260213',{剤形区分:'1',調剤数量:'28'})==='20260326', '定期28日分(2/13): 3/26まで中止を見張る');
// 5日分: 最終服用日 3/3、猶予 max(7, 3)=7日 → 3/10
ok(stopWatchUntil('20260227',{剤形区分:'1',調剤数量:'5'})==='20260310', '臨時5日分(2/27): 3/10まで');
ok(stopWatchUntil('20260227',{剤形区分:'1',調剤数量:'5'})<'20260313', '臨時5日分は3/13の来局時には期限切れ（中止に出ない）');
ok(stopWatchUntil('20260213',{剤形区分:'1',調剤数量:'28'})>='20260323', '定期28日分は10日遅れの来局(3/23)でも見張り中');
ok(stopWatchUntil('20260213',{剤形区分:'2',調剤数量:'10'})===null, '頓服は期限を出さない（直前の処方で判定）');
ok(STOP_GRACE_MIN===7, '猶予の下限は7日');

/* ---------- mdText ---------- */
ok(mdText('20260213')==='2/13' && mdText('')==='不明', '日付の短縮表示');

/* ---------- purgeDue: 90日purge対象判定 ---------- */
const DAY=86400000, now=1770000000000;
ok(purgeDue({savedAt: now-89*DAY}, now, 90)===false, '89日前 → 残す');
ok(purgeDue({savedAt: now-90*DAY}, now, 90)===false, 'ちょうど90日 → 残す（90日「で」削除は91日目から）');
ok(purgeDue({savedAt: now-90*DAY-1}, now, 90)===true, '90日+1ms → 削除');
ok(purgeDue({savedAt: now-365*DAY}, now, 90)===true, '1年前 → 削除');
ok(purgeDue({}, now, 90)===true, 'savedAt記録なし → 安全側で削除');
ok(purgeDue({savedAt: now}, now, 90)===false, 'いま保存したもの → 残す');

process.exit(fail?1:0);
