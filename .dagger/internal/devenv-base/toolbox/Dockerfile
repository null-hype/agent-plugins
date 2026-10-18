FROM golang:1.25 AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY *.go ./
RUN go test ./... && CGO_ENABLED=0 go build -ldflags '-s -w' -o /out/toolbox .

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/toolbox /toolbox
ENTRYPOINT ["/toolbox"]
