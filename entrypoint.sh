#!/bin/bash
set -euo pipefail

# ---------------------------------------------------------------------------
# Read credentials from Docker Swarm secrets (preferred) or env vars (fallback)
# ---------------------------------------------------------------------------
CUPS_USER="${CUPS_USER:-cupsadmin}"
CUPS_PASSWORD="${CUPS_PASSWORD:-cupsadmin}"

if [ -f /run/secrets/cups_user ]; then
  CUPS_USER="$(cat /run/secrets/cups_user)"
fi
if [ -f /run/secrets/cups_pass ]; then
  CUPS_PASSWORD="$(cat /run/secrets/cups_pass)"
fi

# ---------------------------------------------------------------------------
# Create CUPS admin system user if it doesn't already exist
# ---------------------------------------------------------------------------
if ! id "$CUPS_USER" &>/dev/null; then
  useradd -r -G lpadmin -s /usr/sbin/nologin "$CUPS_USER"
fi

# Ensure the user is in the lpadmin group
usermod -aG lpadmin "$CUPS_USER" 2>/dev/null || true

# Set the Linux account password (required for CUPS Basic auth)
echo "${CUPS_USER}:${CUPS_PASSWORD}" | chpasswd

# ---------------------------------------------------------------------------
# Ensure CUPS runtime directories exist (volumes may be freshly mounted)
# ---------------------------------------------------------------------------
mkdir -p /var/spool/cups/tmp /var/log/cups /run/cups
chown -R root:lp /var/spool/cups
chmod 0710 /var/spool/cups
chmod 1770 /var/spool/cups/tmp

echo "[entrypoint] CUPS admin user: ${CUPS_USER}"
echo "[entrypoint] Starting supervisord..."

exec /usr/bin/supervisord -n -c /etc/supervisor/conf.d/better-cups.conf
