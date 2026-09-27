# Stock Caddy has no DNS provider plugins built in -- the wildcard
# certificate (*.$DOMAIN, one cert covering every client subdomain)
# needs a DNS-01 challenge, which needs the registrar-specific plugin
# baked into the binary at build time (Caddy doesn't support loading
# plugins at runtime). This builds a Caddy binary with just the GoDaddy
# DNS plugin added, nothing else changes vs the stock image.
FROM caddy:2-builder-alpine AS builder
RUN xcaddy build --with github.com/caddy-dns/godaddy

FROM caddy:2-alpine
COPY --from=builder /usr/bin/caddy /usr/bin/caddy
