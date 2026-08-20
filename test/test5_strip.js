const fs=require('fs'), vm=require('vm'), crypto=require('crypto');
const html=fs.readFileSync(require('path').join(__dirname,'..','index.html'),'utf8');
const app=html.slice(html.lastIndexOf('<script>')+8, html.lastIndexOf('</script>'));
const cut=app.indexOf('4. 画面描画');
const core=app.slice(0, app.lastIndexOf('/* ===', cut));
const ctx={console,TextDecoder,TextEncoder,crypto:{getRandomValues:a=>crypto.randomFillSync(a)}};
vm.createContext(ctx); vm.runInContext(core, ctx);
const {stripForStorage, parseJahis, compare}=ctx;
let fail=0; const ok=(c,m)=>{console.log((c?'PASS':'FAIL')+'  '+m); if(!c)fail++;};

const FULL=['JAHIS10',
 '1,1,1234567,13,○○内科クリニック','2,105-0004,東京都港区新橋1-11','3,03-1234-5678,,','4,2,01,内科','5,,ｺｳｷﾞｮｳｶｲ ｼﾞﾛｳ,工業会 次郎',
 '11,0001234,日薬 太郎,ﾆﾁﾔｸ ﾀﾛｳ','12,1','13,19600606','14,1',
 '21,1','22,06012345','23,０１－２３,１２３４５６,1,01','24,30,70','27,12345678,7654321',
 '51,20260313','52,20260320','61,,東京都港区新橋1丁目,03-1111-2222','62,2','63,3,1','64,3',
 '81,1,1,一包化','82,1,1234567890123456',
 '101,1,1,,28','111,1,1,,１日１回朝食後,1','181,1,1,2,一包化,,',
 '201,1,1,1,2,612170709,ノルバスク錠２．５ｍｇ,1,1,錠','281,1,1,1,3,後発品変更不可,',
 '211,1,1,250','221,1,1,1,2','231,1,1,,,,','241,1,1,1,1'].join('\r\n');

const s=stripForStorage(FULL);
const nos=s.split('\r\n').filter(Boolean).filter(l=>l.includes(',')).map(l=>l.split(',')[0]);

// 患者を特定しうる情報が残っていないこと
for(const [needle,what] of [['日薬','患者漢字氏名'],['ﾆﾁﾔｸ','患者カナ氏名'],['19600606','生年月日'],
  ['0001234','患者コード'],['06012345','保険者番号'],['１２３４５６','被保険者証番号'],
  ['12345678','公費負担者番号'],['東京都港区新橋1丁目','麻薬施用患者住所'],['1234567890123456','引換番号']]){
  ok(!s.includes(needle), '保存データに'+what+'が残らない');
}
for(const n of ['11','12','13','14','21','22','23','24','27','61','82'])
  ok(!nos.includes(n), 'レコード'+n+'を保存しない');
for(const n of ['1','4','5','51','52','62','63','64','81','101','111','181','201','211','221','231','241','281'])
  ok(nos.includes(n), 'レコード'+n+'は保存する（比較・監査に必要）');

// 保存データが比較に使えること
const saved=parseJahis(s);
ok(saved.errors.length===0, '保存データを読み戻してもエラーにならない');
ok(saved.rps.length===1 && saved.drugs.length===1, '処方内容が保たれている');
ok(saved.rps[0].用法.名称==='１日１回朝食後', '用法が保たれている');
ok(saved.drugs[0].補足[0].情報==='後発品変更不可', '薬品補足が保たれている');
ok((saved.hosp||{}).名称==='○○内科クリニック', '医療機関名は残す（監査時の確認用）');
ok(saved.交付年月日==='20260313', '交付年月日は残す（新旧判定に必要）');

const cur=parseJahis(FULL.replace('51,20260313','51,20260413').replace('ノルバスク錠２．５ｍｇ,1,1,錠','ノルバスク錠５ｍｇ,1,1,錠'));
const r=compare(saved, cur);
ok(r.rows.length>0, '保存データと今回処方で突合できる');
ok(!r.alerts.some(a=>a.level==='danger'), '前回側に患者情報が無くても患者不一致の誤警告を出さない');

const sj=s.replace(/[^\x00-\x7F]/g,'xx').length;
console.log('      保存サイズ: '+Buffer.byteLength(s,'utf8')+' B (UTF-8) / 元データ '+Buffer.byteLength(FULL,'utf8')+' B');
process.exit(fail?1:0);
