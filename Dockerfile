FROM drewzh/printnode@sha256:babaa9a05ddd79e0bd16362822065d69160f2f4039fe3b5ae2261fe3a3fd7c27

ENV DEBIAN_FRONTEND=noninteractive

# Install Node.js 20 repo and all required packages in one layer
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates gnupg \
 && mkdir -p /etc/apt/keyrings \
 && curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
    | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg \
 && echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main" \
    > /etc/apt/sources.list.d/nodesource.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends \
      nodejs \
      printer-driver-foo2zjs \
      libreoffice-writer \
      supervisor \
 && apt-get clean \
 && rm -rf /var/lib/apt/lists/*

# CUPS configuration
COPY cupsd.conf /etc/cups/cupsd.conf

# Supervisor configuration
COPY supervisord.conf /etc/supervisor/conf.d/better-cups.conf

# Portal application
COPY portal/ /app/portal/
WORKDIR /app/portal
RUN npm ci --omit=dev

# Entrypoint replaces the default PrintNode run.sh
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

WORKDIR /

HEALTHCHECK --interval=30s --timeout=10s --start-period=90s --retries=3 \
    CMD curl -sf http://localhost:631/ > /dev/null && \
        curl -sf http://localhost:8080/ > /dev/null || exit 1

ENTRYPOINT ["/entrypoint.sh"]
