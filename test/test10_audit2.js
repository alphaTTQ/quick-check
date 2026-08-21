// 第2回外部監査（HOLD）指摘の再現経路テスト
// 1. 保存領域の実障害（IndexedDB abort / localStorage容量超過）で fail-closed になる
// 2. バックアップ検証の強化（実在日付・未来savedAt・キー横断重複・text整合・id形式・期限切れ除外）
// 3. 交付日の厳格検証（非実在日付は「交付日不明」扱い）
// 4. 候補ボタンにインラインonclickを使わない（id注入の遮断）
// 5. Store.init() 完了前は保存・自動比較をしない（readyガード）
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
    '({processScanned, parseJahis, Store, strictDateKey, validateBackup, bakImport, stripForStorage, getState:()=>state, getMeta:()=>compareMeta, getPending:()=>pendingScan})', ctx);
  api._doc=doc;
  return api;
}

const PATIENT=['11,,日薬 太郎,ﾆﾁﾔｸ ﾀﾛｳ','12,1','13,19600606'];
const KANA_ONLY=['11,,,ﾆﾁﾔｸ ﾀﾛｳ','12,1','13,19600606'];
const KANJI_ONLY=['11,,日薬 太郎,','12,1','13,19600606'];
const RX=(patient,date,drug)=>['JAHIS10','1,1,1234567,13,Ａ病院','4,2,01,内科',...patient,
  '51,'+date,'101,1,1,,28','111,1,1,,１日１回朝食後,1',
  drug||'201,1,1,1,2,612170709,ノルバスク錠２．５ｍｇ,1,1,錠'].join('\r\n');

(async()=>{

  /* ===== 3. strictDateKey ===== */
  {
    const api=makeCtx({});
    const k=api.strictDateKey;
    ok(k('20260213')==='20260213', '実在日付は通る');
    ok(k('20269999')==='', '非実在日付(20269999)は拒否');
    ok(k('20260231')==='', '2月31日は拒否');
    ok(k('20240229')==='20240229', '閏年の2月29日は通る');
    ok(k('20230229')==='', '非閏年の2月29日は拒否');
    ok(k('5070313')==='20250313', '和暦(令和7年3月13日)は西暦キーに変換');
    ok(k('202603')==='' && k('2026')==='', '年月のみ・年のみは交付日として拒否');
    ok(k('19250101')==='' && k('21010101')==='', '範囲外の年は拒否');
    // 非実在交付日のQRは「交付日不明」として保存されない
    await api.Store.init();
    await api.processScanned(api.parseJahis(RX(PATIENT,'20269999')));
    ok(api.getMeta().mode==='first' && api.getMeta().noSave===true, '非実在交付日は保存しない（汚染防止）');
    ok((await api.Store.all()).length===0, '保存件数0のまま');
  }

  /* ===== 5. readyガード: init完了前の読取は完了を待ってから正しく処理される ===== */
  {
    // openが80ms遅れて成功する遅いIndexedDB（書き込みは成功する）
    function slowIDB(){
      const mkStore=()=>({
        put(){}, delete(){}, clear(){}, createIndex(){},
        get(){ const r={}; setTimeout(()=>r.onsuccess&&r.onsuccess(),0); return r; },
        getAll(){ const r={result:[]}; setTimeout(()=>r.onsuccess&&r.onsuccess(),0); return r; },
        index(){ return { get(){ const r={}; setTimeout(()=>r.onsuccess&&r.onsuccess(),0); return r; } }; },
      });
      const db={ createObjectStore(){ return mkStore(); },
        transaction(){ const tx={ objectStore(){ return mkStore(); } };
          setTimeout(()=>{ tx.oncomplete&&tx.oncomplete(); },10); return tx; } };
      return { open(){ const rq={result:db};
        setTimeout(()=>{ rq.onupgradeneeded&&rq.onupgradeneeded(); rq.onsuccess&&rq.onsuccess(); },80);
        return rq; } };
    }
    const api=makeCtx({indexedDB:slowIDB()});
    // アプリ読み込み時に起動された init は80ms後に完了する。待たずに即読取:
    await api.processScanned(api.parseJahis(RX(PATIENT,'20260213')));
    // ガードが無ければ未初期化ストア(db=null)へのアクセスで storeOK=false になるところ、
    // ready() が init 完了を待つため正常に保存まで到達する
    ok(api.getMeta().mode==='first' && !api.getMeta().noSave, 'init完了前の読取は完了を待って正常処理される');
    ok(api._doc.getElementById('msg-scan').textContent.includes('初回として保存'), '保存まで到達する');
    ok(api.Store.mode==='idb', '初期化はIndexedDBモードで完了している');
  }

  /* ===== 1a. localStorage容量超過（実書き込み失敗）で fail-closed ===== */
  {
    let failLS=true;
    const api=makeCtx({
      localStorage:{
        _s:{},
        getItem(k){ return this._s[k]===undefined?null:this._s[k]; },
        setItem(k,v){ if(k==='__t'){ this._s[k]=v; return; }
                      if(failLS) throw new Error('QuotaExceededError'); this._s[k]=v; },
        removeItem(k){ delete this._s[k]; },
      },
      indexedDB:undefined,   // idbを失敗させ localStorage モードに落とす
    });
    await api.Store.init();
    ok(api.Store.mode==='local', 'localStorageモードで初期化');
    ok(!!api.Store.degraded, '書き込み失敗（容量超過相当）で degraded になる');
    await api.processScanned(api.parseJahis(RX(PATIENT,'20260213')));
    ok(api.getMeta().noSave===true, 'degraded中は保存・自動比較をしない');
    ok(api._doc.getElementById('msg-scan').textContent.includes('停止'), '停止を通知');
    failLS=false;
    await api.Store.init();
    ok(!api.Store.degraded, '書き込みが直れば復旧する');
  }

  /* ===== 1b. IndexedDBトランザクションのabortで fail-closed ===== */
  {
    // 読み取りは成功・書き込みtrans はabortする最小のIndexedDB偽実装
    function fakeIDB(){
      const mkStore=()=>({
        put(){}, delete(){}, clear(){}, createIndex(){},
        get(){ const r={}; setTimeout(()=>r.onsuccess&&r.onsuccess(),0); return r; },
        getAll(){ const r={result:[]}; setTimeout(()=>r.onsuccess&&r.onsuccess(),0); return r; },
        index(){ return { get(){ const r={}; setTimeout(()=>r.onsuccess&&r.onsuccess(),0); return r; } }; },
      });
      const db={
        createObjectStore(){ return mkStore(); },
        transaction(_, rwmode){
          const tx={ objectStore(){ return mkStore(); } };
          if(rwmode==='readwrite')
            setTimeout(()=>{ tx.error=new Error('QuotaExceededError'); tx.onabort&&tx.onabort(); },10);
          else
            setTimeout(()=>{ tx.oncomplete&&tx.oncomplete(); },10);
          return tx;
        },
      };
      return { open(){ const rq={result:db};
        setTimeout(()=>{ rq.onupgradeneeded&&rq.onupgradeneeded(); rq.onsuccess&&rq.onsuccess(); },0);
        return rq; } };
    }
    const api=makeCtx({indexedDB:fakeIDB()});
    await api.Store.init();
    ok(api.Store.mode==='idb', 'IndexedDBモードで初期化');
    ok(!!api.Store.degraded, '書き込みトランザクションのabortを検出して degraded になる');
    await api.processScanned(api.parseJahis(RX(PATIENT,'20260213')));
    ok(api.getMeta().noSave===true, 'abort検出中は保存・自動比較をしない');
  }

  /* ===== 2. バックアップ検証の強化 ===== */
  {
    const api=makeCtx({});
    await api.Store.init();
    const {validateBackup, stripForStorage}=api;
    const salt='0123456789abcdef0123456789abcdef';
    const now=1770000000000;
    const text=(date)=>'JAHIS10\r\n1,1,1234567,13,Ａ病院\r\n51,'+date+'\r\n'+
      '101,1,1,,28\r\n111,1,1,,１日１回朝食後,1\r\n201,1,1,1,2,612170709,ノルバスク錠２．５ｍｇ,1,1,錠\r\n';
    const hex=c=>c.repeat(64);
    const rec=(over)=>Object.assign(
      {id:hex('a'), keys:[hex('a')], cand:'', date:'20260313', savedAt:now-1000, text:text('20260313')}, over);
    const bk=(...records)=>({format:'shohousen-kansa/1', salt, records});

    ok(validateBackup(bk(rec()), now).ok===true, '正常レコードは通る');
    ok(validateBackup(bk(rec({date:'20261399'})), now).ok===false, '非実在交付日(20261399)は拒否');
    ok(validateBackup(bk(rec({savedAt:now+3600000})), now).ok===false, '未来のsavedAtは拒否');
    ok(validateBackup(bk(rec(), rec({id:hex('b'), keys:[hex('a')], text:text('20260313')})), now).ok===false,
       'レコード間の照合キー重複は拒否（別処方の誤比較防止）');
    ok(validateBackup(bk(rec({date:'20260101'})), now).ok===false,
       '処方テキストの交付日とdateの不一致は拒否');
    const evilId="');alert(document.title);//";
    ok(validateBackup(bk(rec({id:evilId})), now).ok===false,
       'スクリプト文字列のidは拒否（64桁16進のみ）');
    ok(validateBackup(bk(rec({id:'r1'})), now).ok===false, '短いidも拒否');
    const v=validateBackup(bk(rec({savedAt:now-91*86400000})), now);
    ok(v.ok===true && v.records.length===0 && v.skippedExpired===1,
       '保存期限切れレコードは取込から除外される');
  }

  /* ===== 4. 候補ボタンの注入対策 ===== */
  {
    const api=makeCtx({});
    await api.Store.init();
    await api.processScanned(api.parseJahis(RX(KANA_ONLY,'20260213')));
    await api.processScanned(api.parseJahis(RX(KANJI_ONLY,'20260313')));
    ok(api.getMeta().mode==='candidates', '候補提示になる');
    const htmlOut=api._doc.getElementById('result').innerHTML;
    ok(!htmlOut.includes('onclick'), '候補カードにインラインonclickが無い');
    ok(htmlOut.includes('data-cand-idx') && htmlOut.includes('data-cand-reject'),
       'data属性＋委譲リスナー方式になっている');
    ok(!htmlOut.includes((api.getPending().candidates[0]||{}).id||'@@none@@'),
       '保存レコードのidがHTMLに埋め込まれない');
  }

  process.exit(fail?1:0);
})().catch(e=>{ console.error('EXEC ERROR', e); process.exit(1); });
