const fs=require('fs'), vm=require('vm'), crypto=require('crypto');
const html=fs.readFileSync(require('path').join(__dirname,'..','index.html'),'utf8');
const app=html.slice(html.lastIndexOf('<script>')+8, html.lastIndexOf('</script>'));
const cut=app.indexOf('4. 画面描画');
const core=app.slice(0, app.lastIndexOf('/* ===', cut));
const ctx={console,TextDecoder,TextEncoder,crypto:{getRandomValues:a=>crypto.randomFillSync(a)},indexedDB:undefined,localStorage:undefined};
vm.createContext(ctx); vm.runInContext(core, ctx);
const {sha256hex, recordKeys, chooseRecord, parseJahis}=ctx;

let fail=0; const ok=(c,m)=>{console.log((c?'PASS':'FAIL')+'  '+m); if(!c)fail++;};

// --- SHA-256 が正しいか（Nodeの実装と突き合わせ） ---
const vec=['','abc','日薬 太郎|19600606|1','a'.repeat(55),'a'.repeat(56),'a'.repeat(64),'あ'.repeat(200)];
let allMatch=true;
for(const v of vec){
  const mine=sha256hex(v), ref=crypto.createHash('sha256').update(v,'utf8').digest('hex');
  if(mine!==ref){ allMatch=false; console.log('   mismatch for '+JSON.stringify(v.slice(0,20))+': '+mine+' != '+ref); }
}
ok(allMatch, 'SHA-256 が Node の実装と完全一致（長さ境界・日本語を含む'+vec.length+'ケース）');
ok(sha256hex('abc')==='ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', 'SHA-256("abc") が既知の値と一致');
ok(sha256hex('x').length===64, '出力は64桁の16進');

// --- 患者鍵 ---
const mk=(name,kana,birth,sex)=>parseJahis(['JAHIS10','1,1,1234567,13,Ｔ病院',`11,,${name},${kana}`,`12,${sex}`,`13,${birth}`,'51,20260313',
  '101,1,1,,28','111,1,1,,１日１回朝食後,1','201,1,1,1,2,612170709,ノルバスク錠２．５ｍｇ,1,1,錠'].join('\r\n'));
const S='saltsalt';
const A=recordKeys(mk('日薬 太郎','ﾆﾁﾔｸ ﾀﾛｳ','19600606','1'), S);
ok(A.length===2, 'カナ・漢字の両方から鍵を作る（'+A.length+'件）');

// 和暦/西暦、全半角、空白の揺れを吸収して同じ鍵になること
ok(JSON.stringify(recordKeys(mk('日薬 太郎','ﾆﾁﾔｸ ﾀﾛｳ','3350606','1'),S))===JSON.stringify(A), '生年月日が和暦でも同じ鍵（昭和35年=1960年）');
ok(JSON.stringify(recordKeys(mk('日薬　太郎','ニチヤク タロウ','19600606','1'),S))===JSON.stringify(A), '全角空白・全角カナでも同じ鍵');

// 別人は別の鍵
const B=recordKeys(mk('日薬 太郎','ﾆﾁﾔｸ ﾀﾛｳ','19600607','1'), S);
ok(A[0]!==B[0], '生年月日が1日違えば別の鍵');
const C=recordKeys(mk('日薬 花子','ﾆﾁﾔｸ ﾊﾅｺ','19600606','2'), S);
ok(A[0]!==C[0], '氏名・性別が違えば別の鍵');

// 片方しか記録しない医療機関でも一致する
const kanaOnly=recordKeys(mk('','ﾆﾁﾔｸ ﾀﾛｳ','19600606','1'), S);
const kanjiOnly=recordKeys(mk('日薬 太郎','','19600606','1'), S);
ok(kanaOnly.length===1 && A.includes(kanaOnly[0]), 'カナのみ記録の処方せんも、両方記録の鍵と一致する');
ok(kanjiOnly.length===1 && A.includes(kanjiOnly[0]), '漢字のみ記録の処方せんも、両方記録の鍵と一致する');

// 塩が違えば鍵も違う（端末をまたいだ突き合わせを防ぐ）
ok(recordKeys(mk('日薬 太郎','ﾆﾁﾔｸ ﾀﾛｳ','19600606','1'),'other')[0]!==A[0], '塩が違えば別の鍵になる');

// 生年月日がなければ照合しない
ok(recordKeys(parseJahis(['JAHIS10','11,,日薬 太郎,','12,1','51,20260313','101,1,1,,1','111,1,1,,毎食後,3','201,1,1,1,1,,ノルバスク,1,1,錠'].join('\r\n')),S).length===0,
   '生年月日がない処方せんは鍵を作らない（人違いを避ける）');

// 鍵から氏名が復元できないこと
ok(!A[0].includes('日薬') && /^[0-9a-f]{64}$/.test(A[0]), '鍵は64桁の16進で、氏名を含まない');

// --- どちらを保存に残すか ---
ok(chooseRecord(null,'20260313')==='save', '保存がなければ保存する');
ok(chooseRecord({date:'20260213'},'20260313')==='save', '今回の方が新しければ上書きする');
ok(chooseRecord({date:'20260313'},'20260213')==='keep', '前回処方をあとから読んでも上書きしない');
ok(chooseRecord({date:'20260313'},'20260313')==='save', '同じ交付日なら読み直しを反映する');
ok(chooseRecord({date:''},'20260313')==='keep', '保存側に交付日がなければ置き換えない（新旧判定不能・監査修正2）');

/* --- 医療機関×診療科でキーが分かれる --- */
const mkRx=(extra)=>parseJahis(['JAHIS10', ...extra,
  '11,,日薬 太郎,ﾆﾁﾔｸ ﾀﾛｳ','12,1','13,19600606','51,20260313',
  '101,1,1,,28','111,1,1,,１日１回朝食後,1',
  '201,1,1,1,2,612170709,ノルバスク錠２．５ｍｇ,1,1,錠'].join('\r\n'));
const kNaika   = recordKeys(mkRx(['1,1,1234567,13,Ａ病院','4,2,01,内科']), S);
const kNaika2  = recordKeys(mkRx(['1,1,1234567,13,Ａ病院','4,2,01,内科']), S);
const kCodeOnly= recordKeys(mkRx(['1,1,1234567,13,Ａ病院','4,2,01,']), S);
const kSeikei  = recordKeys(mkRx(['1,1,1234567,13,Ａ病院','4,2,09,整形外科']), S);
const kNoDept  = recordKeys(mkRx(['1,1,1234567,13,Ａ病院']), S);
const kNoDept2 = recordKeys(mkRx(['1,1,1234567,13,Ａ病院']), S);
const kHospB   = recordKeys(mkRx(['1,1,7654321,13,Ｂ病院','4,2,01,内科']), S);
const kShika   = recordKeys(mkRx(['1,3,1234567,13,Ａ病院','4,2,01,内科']), S);
ok(kNaika[0]===kNaika2[0], '同一機関・同一診療科は同じ鍵');
ok(kNaika[0]===kCodeOnly[0], '科名省略でも診療科コードが同じなら同じ鍵');
ok(kNaika[0]!==kSeikei[0], '同一機関でも診療科が違えば別の鍵');
ok(kNaika[0]!==kNoDept[0], '診療科レコードなしは「診療科なし」の独立キー（内科と混同しない）');
ok(kNoDept[0]===kNoDept2[0], '診療科なし同士は一致する');
ok(kNaika[0]!==kHospB[0], '医療機関が違えば別の鍵');
ok(kNaika[0]!==kShika[0], '同一機関コードでも種別（医科/歯科）が違えば別の鍵');

process.exit(fail?1:0);
