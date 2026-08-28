// UI変更の確認
// 1. 見出し・説明文の整理（Quick-check / 90日で自動削除されます。のみ）
// 2. ライトボタンの削除
// 3. 読み取り途中で「閉じる」を押すと分割QRの読取状況がリセットされる
const fs=require('fs'), vm=require('vm'), crypto=require('crypto');
const path=require('path');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');

let fail=0; const ok=(c,m)=>{console.log((c?'PASS':'FAIL')+'  '+m); if(!c)fail++;};

/* ===== 1・2: マークアップ ===== */
ok(/<title>Quick-check<\/title>/.test(html), '1-1. タイトルが Quick-check');
ok(/<h1>Quick-check<\/h1>/.test(html), '1-2. 見出しが Quick-check');
ok(!html.includes('前回・今回 処方比較'), '1-3. 見出しの「前回・今回 処方比較」が削除されている');
ok(!html.includes('院外処方せん2次元シンボル（JAHIS'), '1-4. 「院外処方せん2次元シンボル〜」の説明が削除されている');
ok(!html.includes('通信しない設計です'), '1-5. 「通信しない設計です〜」が削除されている');
ok(/class="privacy">90日で自動削除されます。<\/span>/.test(html), '1-6. 「90日で自動削除されます。」のみ残っている');
ok(!html.includes('torchBtn') && !html.includes('toggleTorch'), '2-1. ライトボタンのコードが残っていない');
ok(!/>ライト</.test(html), '2-2. ライトボタンが画面に無い');
ok(html.includes('id="verbadge"') && html.includes('>Ver 1.0<'), '2-3. 右下にVer 1.0の表示がある');

/* ===== 3: 閉じるでのリセット ===== */
function mkEl(){ const el={
  innerHTML:'', textContent:'', className:'', value:'', open:false,
  style:{}, dataset:{}, offsetWidth:0, _listeners:{},
  classList:{add(){},remove(){},toggle(){},contains:()=>false},
  addEventListener(t,f){ (el._listeners[t]=el._listeners[t]||[]).push(f); },
  fire(t){ (el._listeners[t]||[]).forEach(f=>f({target:el})); },
  appendChild(){}, insertAdjacentElement(){}, remove(){},
  querySelector:()=>null, querySelectorAll:()=>[],
  showModal(){el.open=true;},
  close(){ el.open=false; el.fire('close'); },      // 実DOM同様、closeイベントを発火
  select(){}, focus(){}, click(){},
}; return el; }
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
const api=vm.runInContext('({handleScan,closeCamera,cam,sessions,newSession,processScanned,parseJahis,Store,goScan,getView:()=>currentView})', ctx);

const sym=(idx,total,parity)=>({binaryData:[74,65,72,73,83,49,48],
  chunks:[{type:'structuredappend',currentSequence:idx,totalSequence:total-1,parity:parity}]});

// 3分割QRのうち2つだけ読んだ状態で閉じる
api.cam.target='scan'; api.cam.done=false;
api.sessions.scan=api.newSession();
doc.getElementById('camDlg').open=true;
api.handleScan(sym(0,3,7));
api.handleScan(sym(1,3,7));
ok(api.sessions.scan.parts.size===2, '3-0. 3分割QRのうち2つを読取済み');
api.closeCamera();
ok(api.sessions.scan.parts.size===0, '3-1. 閉じると読取途中の分割QRが破棄される');
ok(api.sessions.scan.total===null, '3-2. 読取状況（総数）もリセットされる');
ok(doc.getElementById('msg-scan').textContent.includes('リセット'), '3-3. リセットしたことを利用者に通知');

// 閉じたあとに別の処方せんを読み始めても、前の断片と混ざらない
api.cam.target='scan'; api.cam.done=false;
doc.getElementById('camDlg').open=true;
api.handleScan(sym(0,2,99));      // 別のパリティ＝別の処方せん
ok(api.sessions.scan.parts.size===1 && api.sessions.scan.parity===99,
   '3-4. リセット後は別の処方せんを最初から読める（mismatchにならない）');

// 完了して閉じた場合はメッセージを出さない（正常終了）
api.sessions.scan=api.newSession();
doc.getElementById('msg-scan').textContent='';
api.cam.done=true;
doc.getElementById('camDlg').open=true;
api.closeCamera();
ok(doc.getElementById('msg-scan').textContent==='', '3-5. 読取完了後の自動クローズでは中止メッセージを出さない');

/* ===== 5: 2画面構成 ===== */
ok(html.includes('id="view-scan"') && html.includes('id="view-result"'), '5-1. 読み取り画面と結果画面が分かれている');
ok(html.includes('>テストモード<'), '5-2. ヘッダーに小さなテストモードボタン');
ok(!html.includes('>デモデータ<'), '5-3. デモデータボタンは無い');
{
  const header=html.slice(html.indexOf('<header>'), html.indexOf('</header>'));
  ok(!header.includes('結果を印刷') && !header.includes('画面をクリア'), '5-4. ヘッダーから印刷・クリアを撤去');
  const vr=html.slice(html.indexOf('id="view-result"'), html.indexOf('<input type="file"'));
  ok(vr.includes('次の処方せんを読む') && vr.includes('読み取り画面へ') && vr.includes('>印刷<'),
     '5-5. 結果画面に［次の処方せんを読む］［読み取り画面へ］［印刷］');
  const scanView=html.slice(html.indexOf('id="view-scan"'), html.indexOf('id="view-result"'));
  ok(!scanView.includes('id="result"'), '5-6. 読み取り画面に結果表示が無い');
}

/* ===== 6: 画面遷移の動作 ===== */
(async()=>{
  await api.Store.init();
  ok(api.getView()==='scan', '6-1. 起動時は読み取り画面');
  const RX=['JAHIS10','1,1,1234567,13,Ａ病院','4,2,01,内科','11,,日薬 太郎,ﾆﾁﾔｸ ﾀﾛｳ','12,1','13,19600606',
    '51,20260313','101,1,1,,28','111,1,1,,１日１回朝食後,1',
    '201,1,1,1,2,612170709,ノルバスク錠２．５ｍｇ,1,1,錠'].join('\r\n');
  await api.processScanned(api.parseJahis(RX));
  ok(api.getView()==='result', '6-2. 読取成立で結果画面へ自動遷移');
  api.goScan();
  ok(api.getView()==='scan', '6-3. ［読み取り画面へ］で戻れる');
  await api.processScanned(api.parseJahis(RX));
  ok(api.getView()==='result', '6-4. 登録済み判定でも結果画面に遷移する');
  process.exit(fail?1:0);
})().catch(e=>{ console.error('EXEC ERROR', e); process.exit(1); });

/* ===== 4: カメラ画面の並び順（QR番号がボタンより上） ===== */
{
  const d=html.slice(html.indexOf('<dialog id="camDlg">'), html.indexOf('</dialog>', html.indexOf('<dialog id="camDlg">')));
  const iVideo=d.indexOf('id="video"'), iSlots=d.indexOf('id="slots-cam"');
  const iSound=d.indexOf('音の確認'), iClose=d.indexOf('閉じる');
  ok(iVideo<iSlots, '4-1. QR番号は映像の下にある');
  ok(iSlots<iSound && iSlots<iClose, '4-2. QR番号は［音の確認］［閉じる］より上にある');
}
