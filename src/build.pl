# quick-check のビルド: src/app_src.html に jsQR・医薬品コード表・マニフェストを
# 埋め込んで index.html を生成する。
#   使い方: perl src/build.pl   （リポジトリのルートで実行）
# 医薬品コード表 data/drug-master-raw.js は zaikokanri-saas の
# `npm run export:quickcheck` が生成する（手編集しない）。
use strict; use warnings;
local $/;
sub slurp { my $p=shift; open(my $f,'<:raw',$p) or die "$p: $!"; my $c=<$f>; close $f; $c }
my $html   = slurp('src/app_src.html');
my $lib    = slurp('src/jsQR.min.js');
my $master = slurp('data/drug-master-raw.js');
my $mani   = slurp('data/drug-master-manifest.json');
$mani =~ s/\s+$//;
for my $pair (['/*__JSQR__*/',$lib], ['/*__MASTER__*/',$master], ['/*__MANIFEST__*/null',$mani]) {
  my ($tok,$val) = @$pair;
  my $i = index($html,$tok);
  die "placeholder $tok not found\n" if $i < 0;
  $html = substr($html,0,$i) . $val . substr($html,$i+length($tok));
}
open(my $o,'>:raw','index.html') or die "index.html: $!";
print $o $html; close $o;
printf "built index.html (%.0f KB)\n", (-s 'index.html')/1024;
