---
type: lesson
title: What can an image check establish
editor: false
previews: false
terminal: false
---

# What can an image check establish?

Someone shares an image with you through an encrypted folder. Before another
application opens it, what can you establish about it, and what can't you?

This part follows one file through that question: a file named
`rails-canary.png` that is not a PNG. You will inspect two kinds of evidence
and keep them apart:

- **The image check** reads local file bytes and reports format
  disagreements, active-content patterns and missing embedded assets. It
  doesn't render the file or pass it to an application's image loader. No
  finding means only that these checks found nothing.
- **Retained execution evidence** records what an application actually did
  with the same bytes in a specific configuration. Here that is a Rails
  experiment recorded in an earlier investigation and checked by its own Pkl
  files (Pkl is a configuration language used here to check recorded results).

Nothing in this part runs in your browser. Every output shown is recorded, and
the last lesson's Proton Drive upload and download is a recorded round trip,
not one you perform here. The commands to run the image check yourself are in
*Run it on your files*.

## Background

The question comes from Excalidraw. In April 2022 its maintainer dwelle opened
[an issue for image support in libraries](https://github.com/excalidraw/excalidraw/issues/5034),
whose checklist included sanitization; dwelle later confirmed that meant
guarding against malicious image content. I opened
[a pull request for the feature](https://github.com/excalidraw/excalidraw/pull/6022)
that December, and by February 2023 was storing drawings' files in restic with
Excalidraw as the front end. The Rails case that follows is separate: it is not
evidence of an Excalidraw vulnerability.
