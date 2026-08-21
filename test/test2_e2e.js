// 実際のQR画像を生成 → jsQR で光学デコード → Shift-JIS 復号 までの通し試験
const { execFileSync } = require('child_process');
try{ execFileSync('iconv',['--version']); }
catch(e){ console.log('SKIPPED: iconv が無いためこのテストは実行しません（Shift-JIS変換に必要）'); process.exit(0); }
const jsQR = require('../src/jsQR.min.js');
const qrcode = require('./qrgen.js');

let fail = 0;
const ok = (c, m) => { console.log((c ? 'PASS' : 'FAIL') + '  ' + m); if (!c) fail++; };

function toShiftJIS(text) {
  return execFileSync('iconv', ['-f', 'UTF-8', '-t', 'CP932'], { input: Buffer.from(text, 'utf8'), maxBuffer: 1 << 24 });
}

// QR行列を RGBA ピクセル配列に展開（quiet zone 4モジュール）
function raster(qr, scale = 6, quiet = 4) {
  const n = qr.getModuleCount(), size = (n + quiet * 2) * scale;
  const d = new Uint8ClampedArray(size * size * 4).fill(255);
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    if (!qr.isDark(r, c)) continue;
    for (let y = 0; y < scale; y++) for (let x = 0; x < scale; x++) {
      const px = ((r + quiet) * scale + y) * size + ((c + quiet) * scale + x);
      d[px * 4] = d[px * 4 + 1] = d[px * 4 + 2] = 0;
    }
  }
  return { data: d, width: size, height: size };
}

function encodeQR(bytes) {
  const latin1 = Array.from(bytes, b => String.fromCharCode(b)).join('');
  const qr = qrcode(0, 'L');          // typeNumber 0 = 自動, 誤り訂正 L（規約は L7%以上）
  qr.addData(latin1, 'Byte');
  qr.make();
  return qr;
}

const JAHIS = [
  'JAHIS10',
  '1,1,1234567,13,○○内科クリニック',
  '5,,,工業会 次郎',
  '11,,日薬 太郎,ﾆﾁﾔｸ ﾀﾛｳ',
  '12,1',
  '13,19600606',
  '51,20260313',
  '101,1,1,,28',
  '111,1,1,,１日１回朝食後,1',
  '201,1,1,1,2,612170709,ノルバスク錠２．５ｍｇ,1,1,錠',
  '281,1,1,1,3,後発品変更不可,',
].join('\r\n') + '\r\n';

const sjisBytes = toShiftJIS(JAHIS);
ok(sjisBytes.length > 0, 'JAHISテキストを Shift-JIS(CP932) にエンコード: ' + sjisBytes.length + ' バイト');
ok(sjisBytes.includes(0x83) || sjisBytes.includes(0x8e), 'Shift-JIS の2バイト文字が含まれる（UTF-8ではない）');

const qr = encodeQR(sjisBytes);
const img = raster(qr);
ok(true, 'QRコード生成: version ' + ((qr.getModuleCount() - 17) / 4) + ' / ' + img.width + 'px');

const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' });
ok(!!code, 'jsQR が QR を検出できる');
ok(code && code.binaryData.length === sjisBytes.length,
   'binaryData のバイト数が一致 (' + (code && code.binaryData.length) + ' / ' + sjisBytes.length + ')');
ok(code && Buffer.from(code.binaryData).equals(sjisBytes), 'binaryData が元の Shift-JIS バイト列と完全一致');

// ここが要点：code.data（文字列）は化けるが、binaryData からの Shift-JIS 復号は正しい
const viaText = code.data;
const viaBytes = new TextDecoder('shift_jis').decode(new Uint8Array(code.binaryData));
ok(viaBytes === JAHIS, 'binaryData → TextDecoder("shift_jis") で原文を復元できる');
ok(viaText !== JAHIS, 'code.data（文字列そのまま）は原文と一致しない＝文字化けする');
console.log('      code.data 冒頭 : ' + JSON.stringify(viaText.slice(0, 46)));
console.log('      復号後   冒頭 : ' + JSON.stringify(viaBytes.slice(0, 46)));

process.exit(fail ? 1 : 0);
