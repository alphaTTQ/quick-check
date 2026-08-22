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
const api=vm.runInContext('({handleScan,closeCamera,cam,sessions,newSession})', ctx);

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

process.exit(fail?1:0);
