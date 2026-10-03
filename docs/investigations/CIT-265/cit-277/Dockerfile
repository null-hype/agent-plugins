# CIT-277: complement to CIT-270. CIT-270 isolated the bare Rails-version
# bump on two *independent* fresh `rails new` apps and found that neither
# version installs image_processing/libvips/ImageMagick by default -- so the
# variant_processor default flip left no trace. This Dockerfile instead
# builds ONE app lineage that already has image_processing + mini_magick +
# ruby-vips wired up, ImageMagick and libvips both installed, at Rails 6.1.7
# (`before` stage), then performs a genuine in-place upgrade to 7.0.0
# (`after` stage, FROM before) -- bundle update, load_defaults bump, and an
# attempted `bin/rails app:update` -- so the diff is a real upgrade of an
# app that actually has an opinion about image processing, not a second
# independent fresh-app diff. See ../CIT-277.md for results.
FROM ruby:3.0-bullseye AS base

# Same bullseye-security removal as CIT-270's Dockerfile -- that suite is
# past its support window and its Packages index advertises versions its
# pool no longer serves.
RUN sed -i '/security/d' /etc/apt/sources.list && \
    apt-get update && apt-get install -y --no-install-recommends \
    sqlite3 libsqlite3-dev \
    imagemagick \
    libvips-tools libvips-dev \
    && rm -rf /var/lib/apt/lists/*

RUN gem install rails -v 6.1.7 --no-document

# Same concurrent-ruby incompatibility as CIT-270: newer concurrent-ruby
# dropped an implicit stdlib `logger` require that 6.1/7.0-era ActiveSupport
# depends on. Pinned globally here for the `rails new` invocation itself.
RUN gem uninstall concurrent-ruby --force --ignore-dependencies --all && \
    gem install concurrent-ruby -v 1.3.4 --no-document

WORKDIR /app

FROM base AS before

# --skip-javascript: same rationale as CIT-270 -- Webpacker vs. importmap
# default churn is unrelated to Active Storage/libvips. --skip-bundle: see
# the concurrent-ruby pin below, applied before the first bundle install.
RUN rails new . --skip-git --skip-test --skip-javascript --skip-bundle --database=sqlite3

# Same Gemfile-level concurrent-ruby pin as CIT-270 -- Bundler would
# otherwise resolve the unpinned `gem "rails"` dependency to a newer
# concurrent-ruby regardless of the system gem version.
RUN echo 'gem "concurrent-ruby", "1.3.4"' >> Gemfile

# The actual CIT-277 variable: this app already processes images before the
# upgrade, unlike CIT-270's fixtures. image_processing is Rails' documented
# variant-processing gem; it depends on mini_magick and/or ruby-vips as the
# actual backend bindings -- both are added explicitly so both native
# libraries installed above are genuinely exercised, not just present.
RUN { \
      echo 'gem "image_processing", "~> 1.2"'; \
      echo 'gem "mini_magick", "~> 4.11"'; \
      echo 'gem "ruby-vips", "~> 2.1"'; \
    } >> Gemfile
RUN bundle install

ENV DISABLE_SPRING=1
RUN bin/rails active_storage:install
RUN bin/rails db:prepare

FROM before AS after

# In-place upgrade: bump the Rails constraint and let bundler resolve
# companion gem versions itself (not hand-pinned, same as a real upgrade
# would do), then flip load_defaults, then run the actual generator-driven
# upgrade path Rails ships for this (`app:update`) non-interactively.
# rails new's generated Gemfile uses single quotes, not double -- match that;
# anchored to line-start so it doesn't also touch the commented-out "Bundle
# edge Rails instead:" line just above it, which contains the same substring.
RUN sed -i "s/^gem 'rails'.*/gem 'rails', '~> 7.0.0'/" Gemfile
# Naming individual dev-group gems for a --conservative update turned into
# whack-a-mole (web-console, then sass-rails/sassc-rails, ... each
# independently pins railties to the old snapshot version) -- every default
# Gemfile dev/asset gem transitively depends on railties, so a full
# `bundle update` is genuinely what's needed here, not a scoping bug to fix
# further. jobs=1 caps concurrent native-extension compilation (nokogiri,
# sqlite3, ffi) from spiking memory on this box's 7.8GB/no-swap budget; the
# resolution step itself is single-threaded regardless and is the part that
# takes real wall-clock time here (see ../CIT-277.md for how long).
RUN bundle config set --local jobs 1 && \
    bundle update
RUN sed -i 's/config.load_defaults 6.1/config.load_defaults 7.0/' config/application.rb
RUN yes a | bin/rails app:update || true
RUN bin/rails db:prepare

CMD ["true"]
