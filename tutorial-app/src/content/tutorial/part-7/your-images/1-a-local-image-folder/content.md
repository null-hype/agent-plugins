---
type: lesson
title: Check a folder of images
editor: false
previews: false
terminal: false
---

# Check a folder of images

The same image check, run over a small folder of five files:

| File | What it is | Findings |
| --- | --- | --- |
| `rails-canary.png` | The canary from the previous chapter | 2 |
| `control.png` | A freshly encoded 2×2 black PNG, the local control | none |
| `badge.svg` | An SVG with active-content patterns | 3 |
| `excalidraw-export.png` | A real upstream Excalidraw export | none |
| `scene-missing-asset.png` | An Excalidraw export whose scene references an image it doesn't contain | 1 |

The local control is not the PNG the Rails runs used; it only shows what an
ordinary PNG looks like to this check.

<figure class="sketch-frames">
  <a href="/sketches/image-claims/problems.svg"><img src="/sketches/image-claims/problems.svg" alt="Recorded checker findings: conflicting MATLAB headers and a PNG signature mismatch in the canary, three SVG patterns, and one missing Excalidraw asset." /></a>
  <figcaption>Recorded output of image-claims 0.2.0 on the five files; <code>image-claims:check</code> fails if it no longer matches a fresh run.</figcaption>
</figure>

Start with one finding: `scene-missing-asset.png:1`. An Excalidraw export can
embed its scene, and the scene names the images it uses. The check reads that
scene, legacy JSON or compressed, and reports any image the scene names but the
file doesn't contain. It does not decode the images that are present. A scene
it cannot decode is reported as an incomplete check, not a pass.

The `badge.svg` findings are pattern matches for scripts, event handlers and
remote references. This is not an XML sanitizer, and it can miss other active
content.

The two files with no findings show the limit of a clean result. A PNG
signature does not prove the image is valid, and the check makes no claim that
an embedded scene matches the rendered pixels; export scale, origin and padding
differ. **No finding means only that these particular checks found nothing.**
It is not permission to trust or share a file without further review.

These checks separate two concerns from the original Excalidraw discussion:
keeping a library's assets together, which the missing-asset check helps with,
and handling their contents safely, which neither check resolves.
