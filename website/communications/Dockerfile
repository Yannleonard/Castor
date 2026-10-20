ARG WEBSITE_IMAGE=castor-website-communications:2026-10-12-site-v1
FROM ${WEBSITE_IMAGE} AS website

FROM golang:1.26-alpine AS build
WORKDIR /src
COPY website/communications/go.mod website/communications/go.sum ./
RUN go mod download
COPY website/communications/ ./website/communications/
RUN cd website/communications && go test ./...
RUN mkdir -p /out && cd website/communications && CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/castor-comms .

FROM alpine:3.22
RUN apk add --no-cache ca-certificates
RUN addgroup -S -g 10001 comms && adduser -S -D -H -u 10001 -G comms comms \
 && mkdir -p /data && chown 10001:10001 /data
COPY --from=build --chown=10001:10001 /out/castor-comms /usr/local/bin/castor-comms
COPY --from=website --chown=10001:10001 /site/ /site/
COPY --from=build --chown=10001:10001 /src/website/communications/account.html /src/website/communications/account.js /src/website/communications/customers-admin.html /site/
USER 10001:10001
WORKDIR /data
EXPOSE 8099
HEALTHCHECK --interval=30s --timeout=3s --start-period=3s --retries=3 CMD wget -q --spider http://127.0.0.1:8099/healthz || exit 1
ENTRYPOINT ["/usr/local/bin/castor-comms"]
