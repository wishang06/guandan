#!/usr/bin/env python3
"""Build the tiny brush-calligraphy font used for effect callouts and seals.

Ma Shan Zheng (SIL OFL 1.1) is ~5 MB as a full Chinese font. The game only needs a
few dozen glyphs, so this script pulls the unicode-range slices from the
@fontsource/ma-shan-zheng npm package, keeps just the characters listed in GLYPHS and
merges them into one small woff2.

Usage:
    npm pack @fontsource/ma-shan-zheng && tar xzf fontsource-ma-shan-zheng-*.tgz
    pip install fonttools brotli
    python3 client/scripts/subset-brush-font.py package/files client/src/assets/fonts/brush.woff2

Add characters to GLYPHS whenever a new callout needs them, then re-run.
"""
import glob
import io
import os
import sys

from fontTools import subset
from fontTools.merge import Merger
from fontTools.ttLib import TTFont

GLYPHS = (
    "掼蛋炸弹同花顺天王子木板钢三带二接风抗贡进还上游下头末"
    "胜利惜败升级双打本局配牌一四五六七八九十张连对报警春赢输平"
    "过要不你先出了到轮准备好开始发大小第名次结果队友方我家手剩余"
)


def main(src_dir: str, out_path: str) -> None:
    wanted = {ord(c) for c in GLYPHS}
    parts = []
    found = set()
    for path in sorted(glob.glob(os.path.join(src_dir, "*-400-normal.woff2"))):
        font = TTFont(path)
        have = wanted & set(font.getBestCmap().keys())
        if not have:
            continue
        found |= have
        options = subset.Options()
        options.layout_features = []
        options.name_IDs = [1, 2]
        options.notdef_outline = True
        options.glyph_names = False
        sub = subset.Subsetter(options)
        sub.populate(unicodes=sorted(have))
        sub.subset(font)
        buf = io.BytesIO()
        font.flavor = None
        font.save(buf)
        buf.seek(0)
        parts.append(buf)
    missing = wanted - found
    if missing:
        print("missing glyphs:", "".join(chr(c) for c in sorted(missing)), file=sys.stderr)
    merged = Merger().merge(parts) if len(parts) > 1 else TTFont(parts[0])
    merged.flavor = "woff2"
    merged.save(out_path)
    print(f"{out_path}: {os.path.getsize(out_path)} bytes, {len(found)} glyphs from {len(parts)} slices")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
