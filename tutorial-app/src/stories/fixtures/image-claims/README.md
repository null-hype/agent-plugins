# image-claims fixtures

Original simplified test files for `src/lib/imageClaims.ts`. Each trips exactly one check
and carries no working exploit. They exist so the checker's tests run on real
bytes, not mocked ones.

| File | What it is | Which check it trips |
| --- | --- | --- |
| `diagram.png` | A MATLAB v5 **header line only** (text, no MAT payload, no HDF5), named `.png` | declared type vs magic bytes |
| `badge.svg` | An SVG with a `<script>`, an `onload=` handler and a remote `href` | active content in SVG |
| `scene-missing-asset.png` | A real PNG whose embedded Excalidraw scene references `img-GONE`, absent from the file | embedded scene references a missing asset |
| `scene-too-big.png` | A 120×80 PNG whose embedded scene spans 400×300 | no finding: dimensions alone are insufficient |
| `scene-ok.png` | A 220×140 PNG whose scene fits and whose one asset is present | none (passes) |

`diagram.png` demonstrates the declared-type check, which reads only the
leading bytes. It is **not** a crafted image-parser exploit: it is a plain text
header with a `.png` name. The check needs nothing more to fire.

## Rails/MATLAB foundation (0.2.0)

`rails-canary.png` is the actual CIT-294 MAT/HDF5 canary, regenerated using
`docs/investigations/CIT-265/cit-294/craft_mat_canary.py` with target
`/work/dummy-canary.txt`, offset 0, length 32. It is not an ordinary PNG and
must not be rendered with an untrusted loader. The checker only reads bytes.
Its SHA-256 is `f1c62ebc5fb7ab50655d505f3c30498713cdef232d3bdef585935024bd007fcc`,
identical to both retained MAT arm inputs. Regenerate from repository root:

```sh
python docs/investigations/CIT-265/cit-294/craft_mat_canary.py tutorial-app/src/stories/fixtures/image-claims/rails-canary.png /work/dummy-canary.txt --length 32
```

Requires Python, h5py and numpy, as does the original generator. No dummy file
is needed to generate or check the file: neither operation dereferences its
external storage entry. The live Rails reproduction remains in CIT-294.

`control.png` is a fresh Pillow-encoded 2×2 grayscale black PNG (`Image.new('L',
(2, 2), 0).save(...)`), not the historical libpng-encoded input. The retained
four-arm outcomes remain authoritative for that historical experiment.

`excalidraw-export.png` is the unmodified upstream compressed-scene fixture
`packages/excalidraw/tests/fixtures/smiley_embedded_v2.png` from Excalidraw
commit `4c37956ba5f04ec342a9d9d5891a38f22c5b7b4e` (MIT license):
https://github.com/excalidraw/excalidraw/blob/4c37956ba5f04ec342a9d9d5891a38f22c5b7b4e/packages/excalidraw/tests/fixtures/smiley_embedded_v2.png

The tests also encode a compressed scene independently with Node zlib, check it
with an actual PNG asset present, and remove only that asset to demonstrate the
finding. `scene-too-big.png` is now a negative regression: scene coordinates do
not establish a mismatch with PNG pixels. `diagram.png` is retained solely as
a header-only contrast; it no longer supplies the lesson's Rails example.
