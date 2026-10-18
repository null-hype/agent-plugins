FROM golang:1.25 AS build
# jq lets TestHostScript run host.sh against a fake devpod.
RUN apt-get update && apt-get install -y --no-install-recommends jq && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY *.go host.sh ./
RUN go test ./... && CGO_ENABLED=0 go build -ldflags '-s -w' -o /out/toolbox .

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/toolbox /toolbox
ENTRYPOINT ["/toolbox"]
