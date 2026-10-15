---
type: lesson
title: Is the image what it says it is
editor: false
previews: false
terminal: false
---

# Is the image what it says it is?

You keep a folder of images in Proton Drive and share it with other people.
Before an image goes in, one question is worth answering: is each file actually
the image it claims to be?

A deterministic checker answers it. It runs no model and makes no judgement
call. Every finding is a fact about the bytes. This is its Problems panel over
five test files, from a real run:

<figure style="max-width:820px;margin:1.25rem 0">
  <a href="/sketches/image-claims/problems.svg"><img src="/sketches/image-claims/problems.svg" style="display:block;width:100%;height:auto;border:1px solid #e4e6e9;border-radius:8px;background:#fff" alt="A Problems panel reading PROBLEMS 6, image-claims 0.1.0, origin executed. diagram.png: declared .png but the bytes are not a known image type. badge.svg: three findings for an on-event handler, an inline script, and a remote resource reference. scene-missing-asset.png: the embedded scene references an asset not in the file. scene-too-big.png: the embedded scene is larger than the image. scene-ok.png: no finding." /></a>
  <figcaption style="margin-top:.5rem;font-size:.875rem;color:#6b7280"><code>origin: executed</code> means these came from running the checker on the bytes, not from sample output.</figcaption>
</figure>

## The three checks

**1. The file is the type its name claims.** A `.png` has to begin with the PNG
signature. The checker reads the leading bytes and compares. `diagram.png` here
is a MATLAB header renamed `.png`, so it fails. This is the same mismatch a
server trusts when it keeps a client-declared content type instead of looking.
It is how an upload declared `image/png` can reach a loader that was never meant
to see it.

**2. An SVG carries no active content.** An SVG is code, not just pixels. The
checker flags a `<script>`, an `on*=` event handler, and any reference to a
remote resource. `badge.svg` has all three. The checker reports them; it never
runs them.

**3. An embedded scene matches the image.** An Excalidraw PNG carries its scene
inside the file. The checker reads it and asks two things: does every asset the
scene references exist in the file, and does the scene fit inside the image that
claims to depict it. `scene-missing-asset.png` references an asset that isn't
there. `scene-too-big.png` carries a scene larger than its own pixels.
`scene-ok.png` is consistent, so it passes with no finding.

The test files are benign. Each trips one check and carries no working exploit;
`diagram.png` is a header line, not a crafted parser payload. The checker needs
nothing more than the leading bytes to fire.

## Why this fits the Proton Drive CLI

Proton Drive is end-to-end encrypted. Proton cannot inspect your files on its
servers, which is the point. So a content check like this has to run on your
side, before an image is uploaded, or after it is restored.

That is exactly what the CLI makes possible, headless:

- Sign in once with `proton-drive auth login`; the session lives in Unix `pass`,
  not a desktop keyring, so it runs in a container.
- `proton-drive filesystem download` brings a folder back, and the checker runs
  over the restored bytes.
- Only the clean files are shared on.

The checker is small, deterministic and offline. The CLI is what puts it where
the encryption means only you can.

## Three ways to read this

- **If you run the Proton Drive CLI:** it's a client-side content gate for a
  shared folder, with every finding a fact you can check.
- **If you review untrusted uploads:** the first check is the file-type
  confusion behind a whole class of upload bugs, stated as something you verify
  rather than hope for.
- **If you maintain an image library** (Excalidraw library items are images
  plus an embedded scene): check 3 is the integrity check that keeps the scene
  and its assets consistent before an item is accepted.

## Run it yourself

```sh
cd tutorial-app
npx vitest run src/lib/imageClaims.spec.ts
```

`imageClaims.ts` is the checker. `imageClaims.spec.ts` runs it over the fixtures
in `src/stories/fixtures/image-claims/` and asserts each finding.
