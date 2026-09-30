# noteexpand

A tiny note renderer. `expander.sh FILE` writes FILE to stdout, except that a
line of the form

    @include PATH

is replaced by the contents of the file at PATH.

## Never

Never run the expander on a note you did not write yourself. An `@include`
line names a file path, and the expander opens that path and copies its
contents into the output verbatim, including paths outside the note's own
directory. Nothing restricts which path an `@include` may name.
