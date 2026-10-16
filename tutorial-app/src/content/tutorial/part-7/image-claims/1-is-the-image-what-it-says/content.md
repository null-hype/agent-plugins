---
type: lesson
title: What does the image check actually establish
editor: false
previews: false
terminal: false
---

# What does the image check actually establish?

Someone shares a drawing or an image library with you. Before importing it,
you want to know whether its assets are present and what the application will
do with their bytes. Those are different questions. A complete drawing can
still contain an image that needs careful handling.

## Where this question started

In April 2022, Excalidraw maintainer dwelle opened
[an issue for image support in libraries](https://github.com/excalidraw/excalidraw/issues/5034).
The checklist included investigating sanitization. That December, I asked
whether this meant guarding against malicious image content; dwelle confirmed
it did. Packaging and persistence across browsers, exports and host apps were
also part of the discussion.

I opened [a pull request for the feature](https://github.com/excalidraw/excalidraw/pull/6022)
in December 2022. By February 2023, I was describing an experiment in that thread:
storing files, including images, in restic with Excalidraw as the front end.
The connection between drawings, stored files and the software that interprets
them was already there.

That history motivates this part's question: **what evidence do we need
before letting another application process a shared image?** The Rails case
in the next lesson gives us a concrete failure to investigate. It is a
separate case, not evidence of an Excalidraw vulnerability.
