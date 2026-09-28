# CIT-270: one Dockerfile, two builds (--build-arg RAILS_VERSION=6.1.7 and
# =7.0.0), identical apt line in both -- the point is to isolate exactly the
# Rails-version bump and let a restic diff of the resulting root filesystems
# show what actually changes, rather than deciding in advance (e.g. by
# apt-installing libvips only in the 7.0.0 build) what the "upgrade" looks
# like. See ../CIT-270.md for why this stays a clean two-way diff and what a
# separate, explicitly-labeled third build would be for.
FROM ruby:3.0-bullseye

# bullseye-security's package pool no longer carries every version its own
# Packages index still advertises (it's past its normal support window) --
# drop that source rather than pin around it; this is a disposable fixture
# image, not something needing security patches.
RUN sed -i '/security/d' /etc/apt/sources.list && \
    apt-get update && apt-get install -y --no-install-recommends \
    sqlite3 libsqlite3-dev \
    && rm -rf /var/lib/apt/lists/*

ARG RAILS_VERSION
RUN gem install rails -v ${RAILS_VERSION} --no-document

# Same concurrent-ruby incompatibility as the Gemfile pin below, but for the
# global `rails new` invocation itself, which runs against the system gem
# set (no Gemfile exists yet at that point).
RUN gem uninstall concurrent-ruby --force --ignore-dependencies --all && \
    gem install concurrent-ruby -v 1.3.4 --no-document

WORKDIR /app

# --skip-javascript: Rails 6.1's default (Webpacker) and 7.0's default
# (importmap-rails) are a real but unrelated churn between these two
# versions -- isolating it keeps the diff about Active Storage/libvips, not
# the JS asset pipeline. --skip-bundle: see the concurrent-ruby pin below.
# --skip-git/--skip-test: irrelevant to either.
RUN rails new . --skip-git --skip-test --skip-javascript --skip-bundle --database=sqlite3

# 6.1/7.0-era ActiveSupport expects concurrent-ruby to still imply a stdlib
# `logger` require as a side effect; concurrent-ruby >= 1.3.5 dropped that,
# and Bundler resolves the Gemfile's unpinned `gem "rails"` dependency to the
# latest concurrent-ruby regardless of what's installed at the system gem
# level -- breaking even `bin/rails` itself with "uninitialized constant
# ActiveSupport::LoggerThreadSafeLevel::Logger". Pinned identically in both
# RAILS_VERSION builds' Gemfiles: a build-environment compatibility fix, not
# part of what the Rails-version diff below is measuring.
RUN echo 'gem "concurrent-ruby", "1.3.4"' >> Gemfile
RUN bundle install

# Spring (both versions' default Gemfile group :development) preloads the
# app in a background process; that model doesn't fit a one-shot `docker
# build` RUN layer and its stale-server detection throws unrelated errors
# here. Disabled identically for both builds -- a build-environment
# concession, not a Rails-version difference.
ENV DISABLE_SPRING=1

RUN bin/rails active_storage:install
RUN bin/rails db:prepare

CMD ["true"]
