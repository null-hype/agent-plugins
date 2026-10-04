# CIT-294: live MATLAB/HDF5 file-read path and blocking controls.
#
# Reuses CIT-278's precedent (same Rails 7.0.10 app lineage from
# cit-277/generated-apps/after, same libvips 8.13.0 pin, same
# VIPS_BLOCK_UNTRUSTED control, same strace-based external detection) but on
# Debian bookworm instead of CIT-272/277/278's bullseye. This is a deliberate,
# evidenced deviation, not a drift: bullseye's HDF5 (1.10.6+repack-4+deb11u1)
# cannot resolve an HDF5 External File List dataset through the exact
# info-reading call libvips' matload makes (Mat_VarReadNextInfo -> class_type
# comes back 0/MAT_C_EMPTY) regardless of libmatio version -- confirmed by
# building libmatio 1.5.23 from source against bullseye's HDF5 and seeing the
# same failure matdump itself doesn't hit (matdump's -d/-f whos path is a
# full read, not an info-only probe). Debian bookworm's HDF5
# (1.10.8+repack1-1) does not have this problem; see ../CIT-294.md "Why
# bookworm, not bullseye" for the isolation steps (inline-data vs.
# external-storage dataset, same attribute/structure, on both HDF5 versions).
#
# Build from docs/investigations/CIT-265 (the context needs cit-277/):
#   docker build -f cit-294/Dockerfile -t cit294:live .
FROM ruby:3.1-bookworm

# Same build-dep shape as cit-272/Dockerfile, plus libmatio-dev (pulls in
# libhdf5-dev on both bullseye and bookworm; bookworm's pairing is the one
# that works -- see above), strace for canary detection (cit-278's method),
# and python3+h5py to craft the canary file at build time (no payload-
# generating code ships in the image beyond this one inert fixture script).
RUN apt-get update && apt-get install -y --no-install-recommends \
    sqlite3 libsqlite3-dev \
    imagemagick libmagickcore-6.q16-dev \
    build-essential pkg-config curl ca-certificates strace \
    libglib2.0-dev libexpat1-dev \
    libjpeg62-turbo-dev libpng-dev libgif-dev libtiff-dev libwebp-dev \
    libexif-dev liblcms2-dev libheif-dev libopenjp2-7-dev \
    librsvg2-dev libpoppler-glib-dev libpango1.0-dev \
    libcfitsio-dev libmatio-dev libopenslide-dev libopenexr-dev \
    libfftw3-dev liborc-0.4-dev libgsf-1-dev libimagequant-dev \
    python3 python3-pip python3-venv \
    && rm -rf /var/lib/apt/lists/*
RUN pip3 install --break-system-packages h5py==3.* numpy

WORKDIR /app
# cit-277's `after` app tree (Rails 7.0.10, load_defaults 7.0, image_processing
# + mini_magick + ruby-vips), same as CIT-272/278 reuse. One deviation from
# the committed Gemfile, documented here rather than silently: its `ruby
# "3.0.7"` pin is dropped so bundler runs on this image's Ruby 3.1 (no ruby
# 3.0.x bookworm image is published). Nothing in the CVE's mechanism depends
# on the Ruby interpreter minor version; Rails/Active Storage/ruby-vips/
# libvips/libmatio stay pinned to the same versions CIT-278 used.
COPY cit-277/generated-apps/after/ /app/
RUN sed -i "/^ruby '3.0.7'/d" Gemfile
ENV DISABLE_SPRING=1
RUN bundle install

# libvips 8.13.0 from source, same tarball/sha256 CIT-272 pinned (the release
# that first ships VIPS_BLOCK_UNTRUSTED). Unlike CIT-272/278 this needs no
# extra CPPFLAGS/LDFLAGS for HDF5: bookworm's libhdf5-dev registers its
# pkg-config alias cleanly, where bullseye's does not resolve a bare -lhdf5
# at link time without manual -L.
WORKDIR /tmp
RUN curl -fsSLO https://github.com/libvips/libvips/releases/download/v8.13.0/vips-8.13.0.tar.gz \
    && echo "b7e1d50dcf571165beecd36adece6eca6701c2a9e131c675143d8b9418dbdd81  vips-8.13.0.tar.gz" | sha256sum -c - \
    && tar xzf vips-8.13.0.tar.gz
WORKDIR /tmp/vips-8.13.0
RUN ./configure > /tmp/vips-configure.log 2>&1 || (tail -200 /tmp/vips-configure.log && false)
RUN make -j"$(nproc)" > /tmp/vips-make.log 2>&1 || (tail -200 /tmp/vips-make.log && false)
RUN make install > /tmp/vips-install.log 2>&1 && ldconfig
WORKDIR /app
RUN bin/rails db:prepare

# Record the pinned configuration for the write-up, from inside the image
# that actually runs the three arms (not transcribed by hand).
RUN { \
      echo "ruby: $(ruby -v)"; \
      echo "rails: $(bin/rails runner 'puts Rails.version')"; \
      echo "activestorage: $(bin/rails runner 'puts ActiveStorage.gem_version')"; \
      echo "ruby-vips gem: $(bin/rails runner 'puts Vips::VERSION rescue puts %x(gem list ruby-vips).strip')"; \
      echo "libvips: $(vips --version)"; \
      vips --vips-config | grep -i matlab; \
      echo "libmatio: $(dpkg -s libmatio11 | grep ^Version)"; \
      echo "hdf5: $(dpkg -s libhdf5-103-1 | grep ^Version)"; \
    } > /app/versions.txt && cat /app/versions.txt

# The canary: a test-owned dummy file (not a real secret) and the crafted
# MAT5.0/HDF5-7.3 file whose External File List entry points at it. Built at
# image-build time so the committed craft_mat_canary.py is the literal code
# that produced the file the runner loads -- no payload generator ships
# separate from its output.
COPY cit-294/craft_mat_canary.py /work/craft_mat_canary.py
RUN mkdir -p /work \
    && printf 'KR2S-CANARY-CIT294-0123456789abcdef!!##' > /work/dummy-canary.txt \
    && python3 /work/craft_mat_canary.py /work/canary.mat /work/dummy-canary.txt --length 32

# Ordinary PNG control fixture: a real, valid 2x2 PNG (not synthesized pixel
# bytes standing in for a render -- an actual libpng-encoded file), to
# exercise arm 3 (normal processing continues under both blocking states).
RUN printf 'control image, not part of the canary' > /work/control-source.txt \
    && vips black /work/control.v 2 2 \
    && vips copy /work/control.v /work/control.png

COPY cit-294/canary_runner.rb /work/canary_runner.rb
WORKDIR /app
