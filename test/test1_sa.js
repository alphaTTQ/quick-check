require('./jsQR.test.js');
const decodeBits = globalThis.__decodeBits;
let fail = 0;
const ok = (c, m) => { console.log((c ? 'PASS' : 'FAIL') + '  ' + m); if (!c) fail++; };

class W {
  constructor(){ this.b = []; }
  put(v, n){ for (let i = n - 1; i >= 0; i--) this.b.push((v >> i) & 1); return this; }
  bytes(){ const o = []; for (let i = 0; i < this.b.length; i += 8) { let v = 0; for (let j = 0; j < 8; j++) v = (v << 1) | (this.b[i + j] || 0); o.push(v); } return o; }
}

// --- Structured Append: 2symbol中の1つ目, payload "ABC" ---
const payload = [65, 66, 67];
const parity = payload.reduce((a, b) => a ^ b, 0);
const w = new W();
w.put(3, 4);          // mode = StructuredAppend
w.put(0, 4);          // symbol index (0-based)
w.put(1, 4);          // total - 1  -> 2 symbols
w.put(parity, 8);     // parity
w.put(4, 4);          // mode = Byte
w.put(payload.length, 8);
payload.forEach(b => w.put(b, 8));
w.put(0, 4);          // terminator

const r = decodeBits(w.bytes(), 1);
ok(!!r, 'SA付きシンボルがデコードできる');
const sa = r && r.chunks.find(c => c.type === 'structuredappend');
ok(!!sa, 'structuredappend チャンクが返る');
ok(sa && sa.currentSequence === 0, 'currentSequence = 0  (実際: ' + (sa && sa.currentSequence) + ')');
ok(sa && sa.totalSequence === 1, 'totalSequence = 1 → 全2シンボル (実際: ' + (sa && sa.totalSequence) + ')');
ok(sa && sa.parity === parity, 'parity = ' + parity + ' (実際: ' + (sa && sa.parity) + ')');
ok(r && JSON.stringify(r.bytes) === JSON.stringify(payload), 'SAヘッダを飛ばして本体バイトが取れる: ' + JSON.stringify(r && r.bytes));

// --- 非SA（従来どおり）が壊れていないこと ---
const w2 = new W();
w2.put(4, 4).put(payload.length, 8);
payload.forEach(b => w2.put(b, 8));
w2.put(0, 4);
const r2 = decodeBits(w2.bytes(), 1);
ok(r2 && JSON.stringify(r2.bytes) === JSON.stringify(payload), '通常のバイトモードは従来どおり');
ok(r2 && !r2.chunks.some(c => c.type === 'structuredappend'), '通常シンボルにSAチャンクは付かない');

// --- 2シンボル目 (index 1 / total 2) ---
const w3 = new W();
w3.put(3, 4).put(1, 4).put(1, 4).put(parity, 8).put(4, 4).put(2, 8).put(88, 8).put(89, 8).put(0, 4);
const r3 = decodeBits(w3.bytes(), 1);
const sa3 = r3 && r3.chunks.find(c => c.type === 'structuredappend');
ok(sa3 && sa3.currentSequence === 1 && sa3.totalSequence === 1, '2シンボル目 index=1/total=2');

process.exit(fail ? 1 : 0);
