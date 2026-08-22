// 読取音の実装確認（iOS対策）
// WAVを生成して <audio> 要素1つを使い回す方式。WebAudioは予備。
const fs=require('fs'), vm=require('vm'), crypto=require('crypto');
const path=require('path');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');

let fail=0; const ok=(c,m)=>{console.log((c?'PASS':'FAIL')+'  '+m); if(!c)fail++;};

// Audio要素の呼び出しを記録するスタブ
const audioLog=[];
function FakeAudio(){
  const a={ _src:'', preload:'', currentTime:0,
    get src(){ return a._src; },
    set src(v){ a._src=v; audioLog.push({type:'src', head:String(v).slice(0,22), len:String(v).length}); },
    play(){ audioLog.push({type:'play', src:a._src.slice(0,22)}); return Promise.resolve(); },
    pause(){ audioLog.push({type:'pause'}); },
  };
  audioLog.push({type:'new'});
  return a;
}
// WebAudio（予備）の呼び出しも記録
const waLog=[];
function FakeCtx(){
  return { state:'running', currentTime:0, sampleRate:44100,
    createBuffer:()=>({}), createBufferSource:()=>({buffer:null,connect(){},start(){}}),
    createOscillator:()=>{ waLog.push('osc'); return {frequency:{},connect(){},start(){},stop(){}}; },
    createGain:()=>({gain:{setValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){}}),
    destination:{}, resume(){ return Promise.resolve(); } };
}
function mkEl(){ const el={ innerHTML:'', textContent:'', className:'', value:'', open:false,
  style:{}, dataset:{}, offsetWidth:0,
  classList:{add(){},remove(){},toggle(){},contains:()=>false},
  addEventListener(){}, appendChild(){}, insertAdjacentElement(){}, remove(){},
  querySelector:()=>null, querySelectorAll:()=>[],
  showModal(){el.open=true;}, close(){el.open=false;}, select(){}, focus(){}, click(){} }; return el; }
const els=new Map();
const doc={ getElementById:id=>{ if(!els.has(id)) els.set(id, mkEl()); return els.get(id); },
  querySelector:()=>mkEl(), querySelectorAll:()=>[], createElement:()=>mkEl(),
  addEventListener(){}, dispatchEvent(){}, body:mkEl(), documentElement:mkEl() };
const ctx={ console, TextDecoder, TextEncoder, setTimeout, clearTimeout, document:doc,
  location:{protocol:'https:', hostname:'example.test', host:'example.test'},
  navigator:{}, matchMedia:()=>({matches:false, addEventListener(){}}),
  addEventListener(){}, confirm:()=>true, requestAnimationFrame:()=>0, cancelAnimationFrame(){},
  crypto:{getRandomValues:a=>crypto.randomFillSync(a)},
  URL:{createObjectURL:()=>'', revokeObjectURL(){}}, Image:function(){},
  Audio:FakeAudio, AudioContext:FakeCtx,
  btoa:s=>Buffer.from(s,'binary').toString('base64'),
  ArrayBuffer, DataView, Uint8Array, Float32Array, Math, isFinite };
ctx.window=ctx; ctx.globalThis=ctx;
vm.createContext(ctx);
const mm=html.match(/var DRUG_MASTER_RAW ?= ?[\s\S]*?;\r?\n/);
vm.runInContext(mm?mm[0]:'var DRUG_MASTER_RAW="";', ctx);
vm.runInContext('var DRUG_MASTER_INFO=null;', ctx);
vm.runInContext(html.slice(html.lastIndexOf('<script>')+8, html.lastIndexOf('</script>')), ctx);
const api=vm.runInContext('({Sound, beep})', ctx);

/* ===== 解除（unlock） ===== */
audioLog.length=0;
api.Sound.unlock();
ok(audioLog.some(x=>x.type==='new'), '1. <audio>要素を生成する');
const sil=audioLog.find(x=>x.type==='src');
ok(sil && sil.head.startsWith('data:audio/wav;base64'), '2. 無音WAVをdata URIとして設定する');
ok(audioLog.some(x=>x.type==='play'), '3. 解除のため実際にplay()する（iOSの自動再生制限対策）');
const firstNewCount=audioLog.filter(x=>x.type==='new').length;
api.Sound.unlock(); api.Sound.unlock();
ok(audioLog.filter(x=>x.type==='new').length===firstNewCount,
   '4. 要素は1つだけ使い回す（iOSの制限は要素ごとに掛かるため）');

/* ===== 再生 ===== */
for(const kind of ['part','ok','dup','err']){
  audioLog.length=0;
  api.Sound.play(kind);
  const src=audioLog.find(x=>x.type==='src');
  ok(src && src.head.startsWith('data:audio/wav;base64') && src.len>1000,
     `5. ${kind}: WAVを設定して再生する（${src?src.len:0}文字）`);
  ok(audioLog.some(x=>x.type==='play'), `6. ${kind}: play()が呼ばれる`);
}

/* ===== 音の中身 ===== */
audioLog.length=0; api.Sound.play('ok');
const okLen=audioLog.find(x=>x.type==='src').len;
audioLog.length=0; api.Sound.play('part');
const partLen=audioLog.find(x=>x.type==='src').len;
ok(okLen>partLen, '7. 完了音（2音）は1つ読取音より長い');
ok(api.Sound._spec.ok.length===3 && api.Sound._spec.part.length===1, '8. 完了音は2音＋間、読取音は1音');

/* ===== beep経由でも鳴る ===== */
audioLog.length=0;
api.beep('part');
ok(audioLog.some(x=>x.type==='play'), '9. beep()から音が再生される');
audioLog.length=0;
api.beep('dup');
ok(audioLog.some(x=>x.type==='play'), '10. dup（フラッシュしない種別）でも音は鳴る');

/* ===== <audio>が使えない環境ではWebAudioに落ちる ===== */
{
  const ctx2=Object.assign({}, ctx);
  const c2={...ctx, Audio:function(){ throw new Error('no audio element'); }};
  c2.window=c2; c2.globalThis=c2;
  const els2=new Map();
  c2.document={ getElementById:id=>{ if(!els2.has(id)) els2.set(id, mkEl()); return els2.get(id); },
    querySelector:()=>mkEl(), querySelectorAll:()=>[], createElement:()=>mkEl(),
    addEventListener(){}, dispatchEvent(){}, body:mkEl(), documentElement:mkEl() };
  vm.createContext(c2);
  vm.runInContext('var DRUG_MASTER_RAW="";var DRUG_MASTER_INFO=null;', c2);
  vm.runInContext(html.slice(html.lastIndexOf('<script>')+8, html.lastIndexOf('</script>')), c2);
  const a2=vm.runInContext('({Sound})', c2);
  waLog.length=0;
  a2.Sound.unlock();
  a2.Sound.play('part');
  ok(waLog.length>0, '11. <audio>が使えない環境ではWebAudioで鳴らす（予備経路）');
}

process.exit(fail?1:0);
