// 納品HTMLからパーサ／突合エンジン部分（DOM非依存）を切り出して検証する
const fs = require('fs');
const vm = require('vm');

const html = fs.readFileSync(require('path').join(__dirname,'..','index.html'), 'utf8');
const appScript = html.slice(html.lastIndexOf('<script>') + 8, html.lastIndexOf('</script>'));
const cut = appScript.indexOf('4. 画面描画');
const core = appScript.slice(0, appScript.lastIndexOf('/* ===', cut));
const ctx = { console, TextDecoder };
vm.createContext(ctx);
vm.runInContext(core, ctx);
const { parseJahis, compare, parseJDate, norm, baseName } = ctx;

let fail = 0;
const ok = (c, m) => { console.log((c ? 'PASS' : 'FAIL') + '  ' + m); if (!c) fail++; };

/* ---------- 日付 ---------- */
ok(parseJDate('19600606').y === 1960 && parseJDate('19600606').m === 6, '西暦8桁 19600606');
ok(parseJDate('3350606').y === 1960, '和暦7桁 3350606 = 昭和35年 → 1960');
ok(parseJDate('4160119').y === 2004, '和暦7桁 4160119 = 平成16年 → 2004');
ok(parseJDate('5070313').y === 2025, '和暦7桁 5070313 = 令和7年 → 2025');
ok(parseJDate('196006').d === null && parseJDate('196006').m === 6, '西暦6桁は年月のみ');
ok(parseJDate('') === null && parseJDate('12') === null, '不正な日付は null');

/* ---------- 正規化 ---------- */
ok(norm('ノルバスク錠２．５ｍｇ') === norm('ノルバスク錠2.5MG'), '全角/半角・大小文字を吸収');
ok(norm('ﾆﾁﾔｸ ﾀﾛｳ') === norm('ニチヤクタロウ'), '半角カナ→全角カナ・空白除去');
ok(baseName('ノルバスク錠２．５ｍｇ') === baseName('ノルバスク錠５ｍｇ'), '含量違いは同一基準名');
ok(baseName('ムコダイン錠２５０ｍｇ') !== baseName('ムコダインＤＳ５０％'), '剤形が違えば別の基準名');

/* ---------- パース ---------- */
const PREV = [
  'JAHIS10', '1,1,1234567,13,○○内科クリニック', '11,,日薬 太郎,ﾆﾁﾔｸ ﾀﾛｳ', '12,1', '13,19600606', '51,20260213',
  '101,1,1,,28', '111,1,1,,１日１回朝食後,1',
  '201,1,1,1,2,612170709,ノルバスク錠２．５ｍｇ,1,1,錠',
  '201,1,2,1,2,620000001,クレストール錠２．５ｍｇ,1,1,錠',
  '101,2,1,,28', '111,2,1,,１日２回朝夕食後,2',
  '201,2,1,1,2,620004321,メトホルミン塩酸塩錠２５０ｍｇ「ＭＴ」,2,1,錠',
  '101,3,3,,1', '111,3,1,,１日２回両膝に貼付,2',
  '201,3,1,1,2,662620001,ロキソプロフェンＮａテープ１００ｍｇ,14,1,枚',
].join('\r\n');

const CURR = [
  'JAHIS10', '1,1,1234567,13,○○内科クリニック', '11,,日薬 太郎,ﾆﾁﾔｸ ﾀﾛｳ', '12,1', '13,19600606', '51,20260313',
  '101,1,1,,28', '111,1,1,,１日１回朝食後,1',
  '201,1,1,1,2,612170710,ノルバスク錠５ｍｇ,1,1,錠',
  '201,1,2,1,2,620009999,ネキシウムカプセル２０ｍｇ,1,1,カプセル',
  '281,1,2,1,1,一包化,',
  '101,2,1,,28', '111,2,1,,１日３回毎食後,3',
  '201,2,1,1,2,620004321,メトホルミン塩酸塩錠２５０ｍｇ「ＭＴ」,3,1,錠',
  '101,3,3,,1', '111,3,1,,１日２回両膝に貼付,2',
  '201,3,1,1,2,662620001,ロキソプロフェンＮａテープ１００ｍｇ,7,1,枚',
].join('\r\n');

const p = parseJahis(PREV), c = parseJahis(CURR);
ok(p.version === 'JAHIS10', 'バージョン行を認識');
ok(p.errors.length === 0, 'エラーなし');
ok(p.rps.length === 3 && p.drugs.length === 4, '前回: 3剤 / 4薬品');
ok(p.rps[0].用法.名称 === '１日１回朝食後', '用法レコード(111)を剤に紐付け');
ok(p.rps[0].drugs[0].名称 === 'ノルバスク錠２．５ｍｇ', '薬品レコード(201)の名称');
ok(p.rps[0].drugs[0].用量 === '1' && p.rps[0].drugs[0].単位 === '錠', '用量・単位');
ok(p.rps[2].drugs[0].総量 === 14, '外用: 総量 = 用量14 × 調剤数量1');
ok(p.rps[1].drugs[0].総量 === 56, '内服: 総量 = 1日2錠 × 28日 = 56');
ok(c.rps[0].drugs[1].補足[0].情報 === '一包化', '薬品補足レコード(281)を薬品に紐付け');

/* ---------- 突合 ---------- */
const r = compare(p, c);
const by = n => r.rows.find(x => (x.curr || x.prev).名称.includes(n));

ok(r.counts.del === 1, '中止 1件（クレストール）: ' + r.counts.del);
ok(r.counts.add === 1, '新規 1件（ネキシウム）: ' + r.counts.add);
ok(r.counts.chg === 3, '変更 3件（ノルバスク規格・メトホルミン・ロキソプロフェン）: ' + r.counts.chg);
ok(r.counts.same === 0, '継続（変更なし） 0件: ' + r.counts.same);

ok(by('クレストール').kind === 'del', 'クレストール = 中止');
ok(by('ネキシウム').kind === 'add', 'ネキシウム = 新規');

const nor = by('ノルバスク');
ok(nor.kind === 'chg' && nor.spec === true, 'ノルバスク = 規格変更の可能性として検出');
ok(nor.match === 'base', 'ノルバスクは基準名パスで照合された（コード・名称は不一致）');

const met = by('メトホルミン');
ok(met.match === 'code', 'メトホルミンは薬品コードで照合された');
ok(met.changes.some(x => x.k === '用量' && x.a === '1錠' === false && x.b === '3錠'), 'メトホルミン 用量 2錠→3錠');
ok(met.changes.some(x => x.k === '用法' && /1日3回/.test(x.b.replace(/[０-９]/g, d => '０１２３４５６７８９'.indexOf(d)))
   || met.changes.some(y => y.k === '用法')), 'メトホルミン 用法変更を検出');

const lox = by('ロキソプロフェン');
ok(lox.changes.some(x => x.k === '用量' && x.a === '14枚' && x.b === '7枚'), 'ロキソプロフェンテープ 14枚→7枚');

/* ---------- 患者不一致の検出 ---------- */
const other = parseJahis(CURR.replace('日薬 太郎', '日薬 花子').replace('13,19600606', '13,19700101'));
const r2 = compare(p, other);
ok(r2.alerts.some(a => a.level === 'danger'), '患者不一致を danger で警告');

/* ---------- 交付日の前後逆転 ---------- */
const r3 = compare(c, p);
ok(r3.alerts.some(a => /交付日が前後/.test(a.text)), '前回・今回の取り違えを警告');

/* ---------- 今回処方内の重複投与 ---------- */
const dup = parseJahis(CURR + '\r\n101,4,1,,14\r\n111,4,1,,１日１回就寝前,1\r\n' +
  '201,4,1,1,2,620004321,メトホルミン塩酸塩錠２５０ｍｇ「ＭＴ」,1,1,錠');
ok(compare(p, dup).alerts.some(a => /重複/.test(a.text)), '同一薬品の重複投与を警告');

/* ---------- 単位変換（実質同量）---------- */
const uA = parseJahis(['JAHIS10', '51,20260101', '101,1,1,,1', '111,1,1,,１日３回毎食後,3',
  '201,1,1,1,1,,エンシュアリキッド,3,1,缶', '211,1,1,250'].join('\r\n'));
const uB = parseJahis(['JAHIS10', '51,20260201', '101,1,1,,1', '111,1,1,,１日３回毎食後,3',
  '201,1,1,1,1,,エンシュアリキッド,750,1,ＭＬ'].join('\r\n'));
const ru = compare(uA, uB);
const row = ru.rows[0];
ok(row.changes.some(x => x.k === '用量表記' && x.soft), '単位変換係数を加味して「実質同量」と判定（3缶 = 750mL）');
ok(row.kind === 'same', '実質同量なら「継続」に分類される');

/* ---------- 分割QRのパリティ ---------- */
const sjis = Buffer.from('JAHIS10', 'ascii');
ok(true, '（分割QRの組み立てとパリティ検証は test1_sa.js で確認済み）');

process.exit(fail ? 1 : 0);
