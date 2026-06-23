# better-cups 🖨️

A fully self-hosted, 100% local print server. Drop a file at `print.your-server.com` from any phone or laptop — it prints instantly on the default CUPS printer. No cloud, no PrintNode, no subscriptions.

## Architecture

```
Browser → Nginx Proxy Manager (print.your-server.com)
              ↓
       Node.js portal :8080  (Express, drag-drop upload)
              ↓
       CUPS (cupsd) :631     (Ubuntu 20.04, foo2zjs driver)
              ↓
       Xerox WorkCentre 3045NI  (discovered via mDNS / avahi)
```

Deployed as a single Docker Swarm service on `your-server.home` (x86-64) with host networking so CUPS can reach the LAN printer via mDNS.

## Prerequisites

- Docker Swarm cluster with `immich` node in **Ready** state
- `avahi-daemon` running on the `immich` host (provides mDNS for CUPS)
- Gitea container registry access at `git.lazarh.work`

```bash
# Verify on the immich node
ssh your-server.home "systemctl is-active avahi-daemon && docker node ls"
```

## 1. Create Swarm secrets

Run these on any Swarm **manager** node:

```bash
printf 'cupsadmin' | docker secret create cups_user -
printf 'YOUR_STRONG_PASSWORD' | docker secret create cups_pass -
```

> ⚠️ Replace `YOUR_STRONG_PASSWORD` with a real password. Stored encrypted in the Swarm raft log.

## 2. Log in to the Gitea registry on immich

```bash
ssh your-server.home \
  "echo 'YOUR_GITEA_TOKEN' | docker login git.lazarh.work -u d3f --password-stdin"
```

## 3. Deploy the stack

```bash
docker stack deploy -c docker-stack.yml better-cups
```

Verify the service starts on the `immich` node:

```bash
docker service ps better-cups_app
```

The container takes ~90 seconds to become healthy (CUPS needs time to start).

## 4. Configure Nginx Proxy Manager

Add a **Proxy Host** in NPM:

| Field | Value |
|---|---|
| Domain | `print.your-server.com` |
| Scheme | `http` |
| Forward Hostname / IP | `your-server.home` (or its LAN IP) |
| Forward Port | `8080` |

Make sure your local DNS resolves `print.your-server.com` to your NPM instance IP.

## 5. CUPS first-run: add the Xerox WorkCentre 3045NI

1. Open `http://your-server.home:631` in a browser
2. Go to **Administration → Add Printer** and log in with your admin credentials
3. Select **Xerox WorkCentre 3045NI** from the discovered network printers list
4. Choose driver: **Xerox WorkCentre 3045** (foo2hbpl2) — installed via `printer-driver-foo2zjs`
5. Click **Set As Default** so the upload portal prints to it automatically

## 6. Using the portal

Visit `http://print.your-server.com` (or `http://your-server.home:8080`).

| File type | Conversion |
|---|---|
| `.pdf` | Direct → `lp` |
| `.jpg`, `.png`, `.gif`, `.tiff` | Direct → `lp` |
| `.docx`, `.doc` | LibreOffice Writer → PDF → `lp` |

## 7. CI/CD — automated image builds

Add a Gitea **Repository Secret** (`Settings → Actions → Secrets`):

| Name | Value |
|---|---|
| `GITEA_TOKEN` | Gitea access token for `d3f` with `package:write` permission |

Every push to `main` builds and pushes `git.your-gitea.com/your-username/better-cups:latest`.

To roll out a new image:

```bash
docker service update --image git.your-gitea.com/your-username/better-cups:latest better-cups_app
```

## Troubleshooting

```bash
# Container logs
docker service logs -f better-cups_app

# Shell into the running container
docker exec -it $(docker ps -qf label=com.docker.swarm.service.name=better-cups_app) bash

# Check CUPS printers
lpstat -v

# Manual test print
echo "Test" | lp
```
