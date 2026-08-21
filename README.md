# quick-check — 処方せん監査（前回・今回 処方比較）

院外処方せんの2次元シンボル（JAHIS規約 Ver.1.10 / QRコード・Shift-JIS）を読み取り、
保存済みの前回処方と自動比較する薬局向けツール。
比較の単位は「患者×医療機関×診療科」で、保存は各キーの直近1回分・90日で自動削除。

- 公開URL: https://alphattq.github.io/quick-check/ （GitHub Pages）
- 単一HTML・完全オフライン動作・CSPで外部送信を遮断。読み取った処方・保存データは
  端末（IndexedDB）から出ない。患者氏名・生年月日等は保存せず、SHA-256の照合鍵に変換して持つ

## 構成

```
index.html    配信物（生成物。直接編集しない）
src/
  app_src.html   アプリ本体のソース（編集はこちら）
  jsQR.min.js    QRデコーダ（分割QR対応の自前パッチ済み。差し替え注意）
  build.pl       ビルドスクリプト
data/
  drug-master-raw.js        医薬品コード表（レセ電算/YJ/一般名→名称）
  drug-master-manifest.json 生成メタ情報
test/           回帰テスト（node test/testN_*.js）
```

## ビルド

```bash
perl src/build.pl && for t in test/test*_*.js; do node "$t" || break; done
```

`src/app_src.html` の3つのプレースホルダ（`/*__JSQR__*/`・`/*__MASTER__*/`・
`/*__MANIFEST__*/null`）に埋め込んで `index.html` を生成する。push すると数分で
Pages に反映される。**URL（オリジン）を変えると全端末の保存データが失われるので、
リポジトリ名・配信元は変更しないこと。**

## 医薬品コード表の更新

`data/` の2ファイルは **zaikokanri-saas の `npm run export:quickcheck` が生成する**。
手編集しない。薬価改定時はコア側でマスタ更新→export→本リポジトリでビルド→push。

## 注意

- `src/jsQR.min.js` は jsQR 1.4.0 に分割QR（Structured Append）対応を追加した改造版。
  素の jsQR に差し替えると分割QRの処方せんが読めなくなる
- QRの文字コードは Shift-JIS。`code.data` ではなく `binaryData` を
  `TextDecoder('shift_jis')` に通す（`code.data` は文字化けする）
- test2 は Shift-JIS 変換に `iconv` コマンドを使う（Git Bash 環境で動作）
