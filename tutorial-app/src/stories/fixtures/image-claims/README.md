# image-claims fixtures

Benign test files for `src/lib/imageClaims.ts`. Each trips exactly one check
and carries no working exploit. They exist so the checker's tests run on real
bytes, not mocked ones.

| File | What it is | Which check it trips |
| --- | --- | --- |
| `diagram.png` | A MATLAB v5 **header line only** (text, no MAT payload, no HDF5), named `.png` | declared type vs magic bytes |
| `badge.svg` | An SVG with a `<script>`, an `onload=` handler and a remote `href` | active content in SVG |
| `scene-missing-asset.png` | A real PNG whose embedded Excalidraw scene references `img-GONE`, absent from the file | embedded scene references a missing asset |
| `scene-too-big.png` | A 120×80 PNG whose embedded scene spans 400×300 | scene larger than the image |
| `scene-ok.png` | A 220×140 PNG whose scene fits and whose one asset is present | none (passes) |

`diagram.png` demonstrates the declared-type check, which reads only the
leading bytes. It is **not** a crafted image-parser exploit: it is a plain text
header with a `.png` name. The check needs nothing more to fire.
