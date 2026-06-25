# better-cups 🖨️

A fully self-hosted, 100% local print server. Drop a file at `print.your-server.com` from any phone or laptop — it prints instantly on the default CUPS printer. No cloud, no PrintNode, no subscriptions.

## Quick start (docker compose)

```bash
curl -O https://raw.githubusercontent.com/lazarh/better-cups/main/docker-compose.yml
CUPS_PASSWORD=your_password docker compose up -d
```

Open `http://localhost:631` to add your printer via the CUPS web UI, then visit `http://localhost:8080` to print.

## Architecture

```
Browser → Nginx Proxy Manager (print.your-server.com)
              ↓
       Node.js portal :8080  (Express, drag-drop upload)
              ↓
        CUPS (cupsd) :631     (Ubuntu 20.04)
               ↓
        Network printer  (discovered via mDNS / avahi)
```

## Prerequisites

- Docker with `compose` plugin (or Swarm mode)
- `avahi-daemon` running on the host for mDNS printer discovery

## Deployment

### docker compose (single host)

```bash
# 1. Create a directory and download the compose file
mkdir -p better-cups && cd better-cups
curl -O https://raw.githubusercontent.com/lazarh/better-cups/main/docker-compose.yml

# 2. Start the service
export CUPS_PASSWORD=your_strong_password
docker compose up -d
```

The container takes ~90 seconds to become healthy (CUPS needs time to start).

### Docker Swarm

Create the password secret and deploy the stack:

```bash
printf 'your_strong_password' | docker secret create cups_pass -
docker stack deploy -c docker-stack.yml better-cups
```

> ⚠️ Use a real password. Swarm secrets are encrypted in the raft log.

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `CUPS_PASSWORD` | *(required)* | Admin password for the CUPS web UI |
| `CUPS_USER` | `admin` | Admin username for the CUPS web UI |
| `CUPS_ALLOW_CIDR` | `192.168.0.0/16` | Subnet allowed to access the CUPS web UI |

## Nginx Proxy Manager (optional)

Add a **Proxy Host** in NPM:

| Field | Value |
|---|---|
| Domain | `print.your-server.com` |
| Scheme | `http` |
| Forward Hostname / IP | your server's LAN IP |
| Forward Port | `8080` |

## CUPS first-run: add your printer

1. Open `http://your-server:631` in a browser
2. Log in with the admin credentials (`CUPS_USER` / `CUPS_PASSWORD`)
3. Go to **Administration → Add Printer**
4. Select your printer from the discovered network printers list
5. Choose the appropriate driver
6. Click **Set As Default** so the upload portal prints to it automatically

## Using the portal

Visit `http://your-server:8080`.

| File type | Conversion |
|---|---|
| `.pdf` | Direct → `lp` |
| `.jpg`, `.png`, `.gif`, `.tiff` | Direct → `lp` |
| `.docx`, `.doc` | LibreOffice Writer → PDF → `lp` |

## Troubleshooting

```bash
# Container logs
docker logs -f better-cups_app

# Shell into the running container
docker exec -it better-cups_app bash

# Check CUPS printers
lpstat -v

# Manual test print
echo "Test" | lp
```

## Image

Pre-built images are available on Docker Hub:

```
docker pull lazarh/better-cups
```

Every push to `main` builds and pushes `lazarh/better-cups:latest` via GitHub Actions.
