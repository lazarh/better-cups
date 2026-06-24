#!/bin/bash
set -euo pipefail

# ---------------------------------------------------------------------------
# Admin username is fixed as 'admin'.
# Password is read from Docker Swarm secret /run/secrets/cups_pass (required).
# ---------------------------------------------------------------------------
CUPS_USER="admin"

if [ ! -f /run/secrets/cups_pass ]; then
  echo "[entrypoint] ERROR: /run/secrets/cups_pass secret is missing." >&2
  exit 1
fi
CUPS_PASSWORD="$(cat /run/secrets/cups_pass)"

# ---------------------------------------------------------------------------
# Create a regular (non-system) user so PAM authentication works correctly
# ---------------------------------------------------------------------------
if ! id "$CUPS_USER" &>/dev/null; then
  useradd -m -G lpadmin -s /usr/sbin/nologin "$CUPS_USER"
fi

# Ensure lpadmin membership (idempotent on restarts)
usermod -aG lpadmin "$CUPS_USER" 2>/dev/null || true

# Set the Linux account password (CUPS Basic auth uses PAM → /etc/shadow)
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
