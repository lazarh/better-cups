#!/bin/bash
set -euo pipefail

CUPS_USER="${CUPS_USER:-admin}"

if [ -f /run/secrets/cups_pass ]; then
  CUPS_PASSWORD="$(cat /run/secrets/cups_pass)"
elif [ -n "${CUPS_PASSWORD:-}" ]; then
  :
else
  echo "[entrypoint] ERROR: set CUPS_PASSWORD env var or mount /run/secrets/cups_pass" >&2
  exit 1
fi

# Generate cupsd.conf from template
CUPS_ALLOW_CIDR="${CUPS_ALLOW_CIDR:-192.168.0.0/16}"
sed "s|{{CUPS_ALLOW_CIDR}}|${CUPS_ALLOW_CIDR}|g" /etc/cups/cupsd.conf > /etc/cups/cupsd.conf.tmp
mv /etc/cups/cupsd.conf.tmp /etc/cups/cupsd.conf

if ! id "$CUPS_USER" &>/dev/null; then
  useradd -m -G lpadmin -s /usr/sbin/nologin "$CUPS_USER"
fi

usermod -aG lpadmin "$CUPS_USER" 2>/dev/null || true

echo "${CUPS_USER}:${CUPS_PASSWORD}" | chpasswd
mkdir -p /var/spool/cups/tmp /var/log/cups /run/cups /run/dbus
chmod 755 /run/dbus

chown -R root:lp /var/spool/cups
chmod 0710 /var/spool/cups
chmod 1770 /var/spool/cups/tmp

echo "[entrypoint] CUPS admin user: ${CUPS_USER}"
echo "[entrypoint] CUPS allow CIDR: ${CUPS_ALLOW_CIDR}"
echo "[entrypoint] Starting supervisord..."

exec /usr/bin/supervisord -n -c /etc/supervisor/conf.d/better-cups.conf
