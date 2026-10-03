# CIT-272: libvips before/after the first release containing libvips commit
# eba9ec0 ("Add a way to disable less well tested operations", 2022-04-11).
# `git tag --contains eba9ec0` starts at v8.13.0-rc1/v8.13.0; it is not an
# ancestor of v8.12.2 -- so before = 8.12.2 (last 8.12), after = 8.13.0.
#
# One Dockerfile, two builds (--build-arg LIBVIPS_VERSION=8.12.2 / 8.13.0),
# same pattern as CIT-270: everything except libvips lives in shared layers
# built *before* the ARG, so both images reuse them byte-for-byte from the
# build cache and the restic diff isolates the libvips change. The shared
# layers carry CIT-277's upgraded Rails 7.0.10 app (Gemfile.lock copied, not
# re-resolved), so the after image is also the environment CIT-278 needs:
# libvips >= 8.13, ruby-vips 2.3.0, unpatched Active Storage 7.0.10.
#
# Build from docs/investigations/CIT-265 (the context needs cit-277/):
#   docker build -f cit-272/Dockerfile --build-arg LIBVIPS_VERSION=8.12.2 -t libvips-cit272:8.12.2 .
#   docker build -f cit-272/Dockerfile --build-arg LIBVIPS_VERSION=8.13.0 -t libvips-cit272:8.13.0 .
# See ../CIT-272.md for results.
FROM ruby:3.0-bullseye

# Same bullseye-security removal as CIT-270/277. Unlike CIT-277 there is no
# apt libvips (libvips-tools/libvips-dev, 8.10.5) here: the only libvips in
# either image is the source build below, so ruby-vips can't load a
# different one. The -dev packages are the optional loader/saver backends
# libvips' configure probes for; the list is identical for both builds and
# neither widened nor narrowed per version.
RUN sed -i '/security/d' /etc/apt/sources.list && \
    apt-get update && apt-get install -y --no-install-recommends \
    sqlite3 libsqlite3-dev \
    imagemagick libmagickcore-6.q16-dev \
    build-essential pkg-config \
    libglib2.0-dev libexpat1-dev \
    libjpeg62-turbo-dev libpng-dev libgif-dev libtiff-dev libwebp-dev \
    libexif-dev liblcms2-dev libheif-dev libopenjp2-7-dev \
    librsvg2-dev libpoppler-glib-dev libpango1.0-dev \
    libcfitsio-dev libmatio-dev libopenslide-dev libopenexr-dev \
    libfftw3-dev liborc-0.4-dev libgsf-1-dev libimagequant-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# CIT-277's `after` app tree (Rails 7.0.10, load_defaults 7.0,
# image_processing + mini_magick + ruby-vips), installed from its committed
# Gemfile.lock. ruby-vips binds libvips through ffi at runtime, so nothing in
# this layer depends on which libvips gets installed below.
COPY cit-277/generated-apps/after/ /app/
ENV DISABLE_SPRING=1
RUN bundle install
# No `bin/rails db:prepare` here, unlike CIT-277: Bundler.require loads
# ruby-vips at boot, which dlopens libvips.so.42 -- absent until the layer
# below. Running it after the libvips layer instead would put a per-build
# db/development.sqlite3 into the diff; CIT-278 runs it at container start.

# ---- everything above is shared; everything below differs per build ----

ARG LIBVIPS_VERSION
# Release tarballs, not git tags: both ship a pre-generated autotools
# `configure` (8.13.0 also ships meson.build, but 8.12.2 has no meson
# support), so both are built the same way with default configure options
# and default `make install` -- no docs stripped or added.
RUN set -eux; \
    case "$LIBVIPS_VERSION" in \
      8.12.2) sha=565252992aff2c7cd10c866c7a58cd57bc536e03924bde29ae0f0cb9e074010b ;; \
      8.13.0) sha=b7e1d50dcf571165beecd36adece6eca6701c2a9e131c675143d8b9418dbdd81 ;; \
      *) echo "no pinned sha256 for $LIBVIPS_VERSION" >&2; exit 1 ;; \
    esac; \
    cd /tmp; \
    curl -fsSLO "https://github.com/libvips/libvips/releases/download/v${LIBVIPS_VERSION}/vips-${LIBVIPS_VERSION}.tar.gz"; \
    echo "$sha  vips-${LIBVIPS_VERSION}.tar.gz" | sha256sum -c -; \
    tar xzf "vips-${LIBVIPS_VERSION}.tar.gz"; \
    cd "vips-${LIBVIPS_VERSION}"; \
    ./configure; \
    make -j"$(nproc)" > /dev/null; \
    make install > /dev/null; \
    ldconfig; \
    cd /; rm -rf /tmp/vips-*

CMD ["true"]
