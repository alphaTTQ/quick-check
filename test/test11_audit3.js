// 第3回外部監査（HOLD）指摘の再現経路テスト
// 1. localStorage保存失敗時にメモリへ反映しない（copy-on-write）／実行中失敗でdegraded
// 2. degraded中のバックアップ取込を拒否
// 3. 和暦の元号年・開始日・終了日の検証
const fs=require('fs'), vm=require('vm'), crypto=require('crypto');
const path=require('path');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');

let fail=0; const ok=(c,m)=>{console.log((c?'PASS':'FAIL')+'  '+m); if(!c)fail++;};

function mkEl(){ return {
  innerHTML:'', textContent:'', className:'', value:'', open:false,
  style:{}, dataset:{}, offsetWidth:0,
  classList:{add(){},remove(){},toggle(){},contains:()=>false},
  addEventListener(){}, appendChild(){}, insertAdjacentElement(){}, remove(){},
  querySelector:()=>null, querySelectorAll:()=>[],
  showModal(){this.open=true;}, close(){this.open=false;},
  select(){}, focus(){}, click(){},
};}
function makeCtx(extra){
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
    navigator:{}, matchMedia:()=>({matches:false, addEventListener(){}}),
    addEventListener(){}, confirm:()=>true,
    requestAnimationFrame:()=>0, cancelAnimationFrame(){},
    crypto:{getRandomValues:a=>crypto.randomFillSync(a)},
    URL:{createObjectURL:()=>'', revokeObjectURL(){}}, Image:function(){},
    ...extra,
  };
  ctx.window=ctx; ctx.globalThis=ctx;
  vm.createContext(ctx);
  const mm=html.match(/var DRUG_MASTER_RAW ?= ?[\s\S]*?;\r?\n/);
  vm.runInContext(mm?mm[0]:'var DRUG_MASTER_RAW="";', ctx);
  vm.runInContext('var DRUG_MASTER_INFO=null;', ctx);
  vm.runInContext(html.slice(html.lastIndexOf('<script>')+8, html.lastIndexOf('</script>')), ctx);
  const api=vm.runInContext(
    '({processScanned, parseJahis, Store, strictDateKey, validateBackup, bakImport, getState:()=>state, getMeta:()=>compareMeta})', ctx);
  api._doc=doc;
  return api;
}
/** 任意のタイミングで書き込みを失敗させられる localStorage */
function makeLS(state){
  return {
    _s:{},
    getItem(k){ return this._s[k]===undefined?null:this._s[k]; },
    setItem(k,v){
      if(k==='__t'){ this._s[k]=v; return; }          // 可用性チェックは常に成功
      if(state.fail) throw new Error('QuotaExceededError');
      this._s[k]=v;
    },
    removeItem(k){ delete this._s[k]; },
  };
}
const PATIENT=['11,,日薬 太郎,ﾆﾁﾔｸ ﾀﾛｳ','12,1','13,19600606'];
const RX=(date,drug)=>['JAHIS10','1,1,1234567,13,Ａ病院','4,2,01,内科',...PATIENT,
  '51,'+date,'101,1,1,,28','111,1,1,,１日１回朝食後,1',
  drug||'201,1,1,1,2,612170709,ノルバスク錠２．５ｍｇ,1,1,錠'].join('\r\n');

(async()=>{

  /* ===== 3. 和暦の元号境界 ===== */
  {
    const k=makeCtx({}).strictDateKey;
    ok(k('3350606')==='19600606', '昭和35年6月6日は通る');
    ok(k('4160119')==='20040119', '平成16年1月19日は通る');
    ok(k('5070313')==='20250313', '令和7年3月13日は通る');
    // 元号開始前
    ok(k('3010101')==='', '昭和元年1月1日は拒否（昭和は12月25日から）');
    ok(k('4010101')==='', '平成元年1月1日は拒否（平成は1月8日から）');
    ok(k('5010101')==='', '令和元年1月1日は拒否（令和は5月1日から）');
    // 元号終了後
    ok(k('3640108')==='', '昭和64年1月8日は拒否（昭和は1月7日まで）');
    ok(k('3640107')==='19890107', '昭和64年1月7日は通る（昭和最終日）');
    ok(k('4310501')==='', '平成31年5月1日は拒否（平成は4月30日まで）');
    ok(k('4310430')==='20190430', '平成31年4月30日は通る（平成最終日）');
    ok(k('5010501')==='20190501', '令和元年5月1日は通る（令和初日）');
    // 元号年00
    ok(k('3000101')==='' && k('5000501')==='', '元号年00は拒否');
    // 明治・大正は年範囲外（1926年以前）で弾かれる
    ok(k('1010123')==='' && k('2010730')==='', '明治・大正は交付日として拒否（年範囲外）');
  }

  /* ===== 1. localStorage copy-on-write ===== */
  {
    const st={fail:false};
    const api=makeCtx({localStorage:makeLS(st), indexedDB:undefined});
    await api.Store.init();
    ok(api.Store.mode==='local' && !api.Store.degraded, '正常時はlocalStorageモードで健全');

    // 1件目を正常に保存
    await api.processScanned(api.parseJahis(RX('20260213')));
    ok((await api.Store.all()).length===1, '正常時は保存できる');
    const firstText=(await api.Store.all())[0].text;

    // 以降の書き込みを失敗させる（実行中の容量超過）
    st.fail=true;
    await api.processScanned(api.parseJahis(RX('20260313',
      '201,1,1,1,2,612170710,ノルバスク錠５ｍｇ,1,1,錠')));
    const recs=await api.Store.all();
    ok(recs.length===1 && recs[0].text===firstText,
       '1-1. 保存失敗後もメモリ上の内容が書き換わらない（copy-on-write）');
    ok(!!api.Store.degraded, '1-2. 実行中のlocalStorage失敗でdegradedになる');

    // 次の読取が「未保存レコード」と比較されない
    await api.processScanned(api.parseJahis(RX('20260413')));
    ok(api.getMeta().noSave===true, '1-3. degraded中は自動比較・保存をしない');
    ok(api._doc.getElementById('msg-scan').textContent.includes('停止'), '1-4. 停止を通知');
    ok((await api.Store.all()).length===1, '1-5. 保存件数は増えない');

    // 復旧
    st.fail=false;
    await api.Store.init();
    ok(!api.Store.degraded, '1-6. 書き込みが直り再初期化すれば復旧する');
    await api.processScanned(api.parseJahis(RX('20260513')));
    ok(api.getMeta().mode==='compare', '1-7. 復旧後は保存済みレコードと比較される');
  }

  /* ===== 1b. 各更新操作の失敗でメモリが汚れない ===== */
  {
    const st={fail:false};
    const api=makeCtx({localStorage:makeLS(st), indexedDB:undefined});
    await api.Store.init();
    const S=api.Store;
    const rec=(id,date)=>({id, keys:[id], cand:'', date, savedAt:Date.now(),
      text:'JAHIS10\r\n1,1,1234567,13,Ａ病院\r\n51,'+date+'\r\n101,1,1,,28\r\n'+
           '111,1,1,,１日１回朝食後,1\r\n201,1,1,1,2,612170709,ノルバスク錠２．５ｍｇ,1,1,錠\r\n'});
    const A='a'.repeat(64), B='b'.repeat(64);
    await S.putRec(rec(A,'20260213'));
    const saltBefore=await S.getSalt();
    st.fail=true;
    let threw=0;
    try{ await S.putRec(rec(B,'20260313')); }catch(e){ threw++; }
    ok(threw===1 && (await S.all()).length===1, 'putRec失敗: 例外を投げ、レコードは増えない');
    try{ await S.delRec(A); }catch(e){ threw++; }
    ok(threw===2 && (await S.all()).length===1, 'delRec失敗: 例外を投げ、レコードは消えない');
    try{ await S.clear(); }catch(e){ threw++; }
    ok(threw===3 && (await S.all()).length===1, 'clear失敗: 例外を投げ、レコードは残る');
    try{ await S.setSalt('f'.repeat(32)); }catch(e){ threw++; }
    ok(threw===4 && (await S.getSalt())===saltBefore, 'setSalt失敗: 例外を投げ、塩は変わらない');
    try{ await S.replaceAll([rec(B,'20260313')], 'f'.repeat(32)); }catch(e){ threw++; }
    const after=await S.all();
    ok(threw===5 && after.length===1 && after[0].id===A,
       'replaceAll失敗: 例外を投げ、既存レコードが置き換わらない');
    ok((await S.getSalt())===saltBefore, 'replaceAll失敗: 塩も変わらない');
    ok(!!S.degraded, '各失敗でdegradedになっている');
  }

  /* ===== 2. degraded中のバックアップ取込拒否 ===== */
  {
    const st={fail:true};
    const api=makeCtx({localStorage:makeLS(st), indexedDB:undefined});
    await api.Store.init();
    ok(!!api.Store.degraded, '起動時の書き込み失敗でdegraded');
    // 容量制限が解除されても、再初期化せずには取り込めない
    st.fail=false;
    const salt='0123456789abcdef0123456789abcdef';
    const k1='a'.repeat(64);
    const text='JAHIS10\r\n1,1,1234567,13,Ａ病院\r\n51,20260313\r\n101,1,1,,28\r\n'+
      '111,1,1,,１日１回朝食後,1\r\n201,1,1,1,2,612170709,ノルバスク錠２．５ｍｇ,1,1,錠\r\n';
    api._doc.getElementById('bakArea').value=JSON.stringify({format:'shohousen-kansa/1', salt,
      records:[{id:k1, keys:[k1], cand:'', date:'20260313', savedAt:Date.now()-1000, text}]});
    await api.bakImport();
    ok((await api.Store.all()).length===0, '2-1. degraded中はバックアップを取り込まない');
    ok(api._doc.getElementById('bakMsg').textContent.includes('取り込めません'), '2-2. 拒否理由を表示');
    // 再初期化すれば取り込める
    await api.Store.init();
    ok(!api.Store.degraded, '2-3. 再初期化で復旧');
    api._doc.getElementById('bakArea').value=JSON.stringify({format:'shohousen-kansa/1', salt,
      records:[{id:k1, keys:[k1], cand:'', date:'20260313', savedAt:Date.now()-1000, text}]});
    await api.bakImport();
    ok((await api.Store.all()).length===1, '2-4. 復旧後は取り込める');
  }

  /* ===== 2b. IndexedDBの実行中abortでもdegradedになる ===== */
  {
    const st={abort:false};
    function idbWithSwitch(){
      const mkStore=()=>({
        put(){}, delete(){}, clear(){}, createIndex(){},
        get(){ const r={}; setTimeout(()=>r.onsuccess&&r.onsuccess(),0); return r; },
        getAll(){ const r={result:[]}; setTimeout(()=>r.onsuccess&&r.onsuccess(),0); return r; },
        index(){ return { get(){ const r={}; setTimeout(()=>r.onsuccess&&r.onsuccess(),0); return r; } }; },
      });
      const db={ createObjectStore(){ return mkStore(); },
        transaction(_, rw){
          const tx={ objectStore(){ return mkStore(); } };
          setTimeout(()=>{
            if(rw==='readwrite' && st.abort){ tx.error=new Error('QuotaExceededError'); tx.onabort&&tx.onabort(); }
            else tx.oncomplete&&tx.oncomplete();
          },10);
          return tx;
        } };
      return { open(){ const rq={result:db};
        setTimeout(()=>{ rq.onupgradeneeded&&rq.onupgradeneeded(); rq.onsuccess&&rq.onsuccess(); },0);
        return rq; } };
    }
    const api=makeCtx({indexedDB:idbWithSwitch()});
    await api.Store.init();
    ok(api.Store.mode==='idb' && !api.Store.degraded, '起動時は健全');
    st.abort=true;   // 起動後に容量超過が起きる
    await api.processScanned(api.parseJahis(RX('20260213')));
    ok(!!api.Store.degraded, '2b-1. 実行中のIndexedDB abortでdegradedになる');
    await api.processScanned(api.parseJahis(RX('20260313')));
    ok(api.getMeta().noSave===true, '2b-2. 以後は保存・自動比較をしない');
  }

  process.exit(fail?1:0);
})().catch(e=>{ console.error('EXEC ERROR', e); process.exit(1); });
