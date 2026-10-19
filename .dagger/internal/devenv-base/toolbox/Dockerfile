FROM golang:1.25 AS build
# jq lets TestHostScript run host.sh against a fake devpod.
RUN apt-get update && apt-get install -y --no-install-recommends jq && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY *.go host.sh ./
RUN go test ./... && CGO_ENABLED=0 go build -ldflags '-s -w' -o /out/toolbox .

# gh rebuilds codespaces for codespace_rebuild: GitHub's REST API cannot.
FROM debian:12-slim AS gh
ARG GH_VERSION=2.102.0
ARG GH_SHA256=bb766f710eef8ede859c18578c72c327597cd4c8a85b06001b1f3843c6019386
ADD https://github.com/cli/cli/releases/download/v${GH_VERSION}/gh_${GH_VERSION}_linux_amd64.tar.gz /gh.tgz
RUN echo "${GH_SHA256}  /gh.tgz" | sha256sum -c - && tar -xzf /gh.tgz --strip-components=2 -C /usr/local/bin gh_${GH_VERSION}_linux_amd64/bin/gh

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/toolbox /toolbox
COPY --from=gh /usr/local/bin/gh /usr/local/bin/gh
ENTRYPOINT ["/toolbox"]
