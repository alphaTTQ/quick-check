// 再読取まわりの挙動
// 1. 読取済みQR（分割QRの同一シンボル）では画面フラッシュを出さない
// 2. 読取完了後はカメラのフレーム処理を止める（余分なフラッシュを出さない）
// 3. 保存済みとまったく同じ処方せんは「すでに登録済み」で取り込まない
const fs=require('fs'), vm=require('vm'), crypto=require('crypto');
const path=require('path');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');

let fail=0; const ok=(c,m)=>{console.log((c?'PASS':'FAIL')+'  '+m); if(!c)fail++;};

const flashes=[];   // flash() が呼ばれた種別を記録する
function mkEl(){ const el={
  innerHTML:'', textContent:'', className:'', value:'', open:false,
  style:{}, dataset:{}, offsetWidth:0,
  classList:{
    add(c){ if(c==='go' && /flash/.test(el.className)) flashes.push(el.className.replace('flash','').trim()); },
    remove(){}, toggle(){}, contains:()=>false },
  addEventListener(){}, appendChild(){}, insertAdjacentElement(){}, remove(){},
  querySelector:()=>null, querySelectorAll:()=>[],
  showModal(){el.open=true;}, close(){el.open=false;},
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
const api=vm.runInContext(
  '({processScanned,parseJahis,Store,feedSymbol,handleScan,beep,cam,sessions,getMeta:()=>compareMeta})', ctx);

const PATIENT=['11,,日薬 太郎,ﾆﾁﾔｸ ﾀﾛｳ','12,1','13,19600606'];
const RX=(date,drug)=>['JAHIS10','1,1,1234567,13,Ａ病院','4,2,01,内科',...PATIENT,
  '51,'+date,'101,1,1,,28','111,1,1,,１日１回朝食後,1',
  drug||'201,1,1,1,2,612170709,ノルバスク錠２．５ｍｇ,1,1,錠'].join('\r\n');
// 分割QRの1シンボル分を模した jsQR 結果
const sym=(idx,total,parity,bytes)=>({binaryData:bytes||[74,65,72,73,83,49,48],
  chunks:[{type:'structuredappend',currentSequence:idx,totalSequence:total-1,parity:parity}]});

(async()=>{

  /* ===== 1. 読取済みQRはフラッシュしない ===== */
  {
    flashes.length=0;
    api.beep('part'); ok(flashes.length===1 && flashes[0]==='part', 'part（新しいQRを読んだ）はフラッシュする');
    flashes.length=0;
    api.beep('ok');   ok(flashes.length===1 && flashes[0]==='ok',   'ok（読取完了）はフラッシュする');
    flashes.length=0;
    api.beep('err');  ok(flashes.length===1 && flashes[0]==='err',  'err（エラー）はフラッシュする');
    flashes.length=0;
    api.beep('dup');  ok(flashes.length===0, '1-1. dup（読取済みQR）はフラッシュしない');
  }

  /* ===== 1b. 分割QRを順にかざす間、同じQRの再検出で光らない ===== */
  {
    await api.Store.init();
    api.cam.target='scan'; api.cam.done=false;
    api.sessions.scan={parts:new Map(), total:null, parity:null, lastIdx:null};
    flashes.length=0;
    api.handleScan(sym(0,3,7));            // 1番目を読む → 光る
    const afterFirst=flashes.length;
    api.handleScan(sym(0,3,7));            // 同じQRを再検出（かざし続けている状態）
    api.handleScan(sym(0,3,7));
    api.handleScan(sym(0,3,7));
    ok(afterFirst===1, '1-2. 新しいQRの読取では1回光る');
    ok(flashes.length===1, '1-3. 同じQRを何度検出しても光らない（点滅しない）');
    ok(api.sessions.scan.parts.size===1, '1-4. 二重取り込みもされない');
  }

  /* ===== 2. 読取完了後はフレーム処理を止める ===== */
  {
    api.cam.target='scan'; api.cam.done=false;
    api.sessions.scan={parts:new Map(), total:null, parity:null, lastIdx:null};
    // 2分割QRを両方読んで完了させる
    api.handleScan(sym(0,2,0,[74,65,72,73,83,49,48,13,10]));
    flashes.length=0;
    api.handleScan(sym(1,2,0,[49,44,49,44,49,44,49,44,65,13,10]));
    const afterDone=flashes.length;
    ok(api.cam.done===true, '2-1. 完了後は done フラグが立つ');
    // 閉じるまでの間に再検出されても何も起きない
    api.handleScan(sym(0,2,0,[74,65,72,73,83,49,48,13,10]));
    api.handleScan(sym(1,2,0,[49,44,49,44,49,44,49,44,65,13,10]));
    ok(flashes.length===afterDone, '2-2. 完了後のフレームでは光らない（新しい読取も始まらない）');
  }

  /* ===== 3. すでに登録済みの処方せんは取り込まない ===== */
  {
    await api.Store.clear(); await api.Store.init();
    const rx1=api.parseJahis(RX('20260313'));
    await api.processScanned(rx1);
    ok(api.getMeta().mode==='first', '3-0. 初回として登録される');
    const before=await api.Store.all();
    ok(before.length===1, '3-1. 保存1件');

    // まったく同じ処方せんをもう一度読む
    flashes.length=0;
    await api.processScanned(api.parseJahis(RX('20260313')));
    ok(api.getMeta().mode==='already', '3-2. 「すでに登録済み」と判定される');
    ok(doc.getElementById('msg-scan').textContent.includes('すでに登録済み'),
       '3-3. 「すでに登録済みです」とメッセージが出る');
    ok(doc.getElementById('result').innerHTML.includes('取り込みませんでした'),
       '3-4. 取り込まなかったことを画面に明示');
    ok(flashes.length===0, '3-5. 登録済みの再読取では画面が光らない');
    const after=await api.Store.all();
    ok(after.length===1 && after[0].savedAt===before[0].savedAt,
       '3-6. 保存はまったく変更されない（保存日時も変わらない）');
    ok(api.getMeta().mode!=='compare', '3-7. 自分自身との比較（全て継続）を表示しない');

    // 同じ交付日でも内容が違えば通常どおり取り込む（訂正・差し替えの処方せん）
    await api.processScanned(api.parseJahis(RX('20260313',
      '201,1,1,1,2,612170710,ノルバスク錠５ｍｇ,1,1,錠')));
    ok(api.getMeta().mode==='compare',
       '3-8. 同じ交付日でも内容が違えば取り込んで比較する（訂正処方せん）');
    ok((await api.Store.all())[0].text!==before[0].text, '3-9. 保存が新しい内容に更新される');

    // 別の日の処方せんは通常どおり比較
    await api.processScanned(api.parseJahis(RX('20260413')));
    ok(api.getMeta().mode==='compare', '3-10. 別の交付日は通常どおり比較される');
  }

  process.exit(fail?1:0);
})().catch(e=>{ console.error('EXEC ERROR', e); process.exit(1); });
