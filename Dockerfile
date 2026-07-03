# Build stage
FROM golang:1.26-alpine AS builder
WORKDIR /usr/src/app

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 go build -ldflags="-w -s" -o server main.go

# Run stage
FROM alpine:latest
WORKDIR /usr/src/app

RUN apk --no-cache add ca-certificates

COPY --from=builder /usr/src/app/server /usr/src/app/server

EXPOSE 3000

ENV PORT=3000
ENV CACHE_DIR=/usr/src/app/public/cache

CMD ["/usr/src/app/server"]
