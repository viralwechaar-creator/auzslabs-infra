#!/usr/bin/env bash
# AUZlabs VPS bootstrap — run once, as root, on a fresh Ubuntu 24.04 server.
set -euo pipefail

echo "==> Updating system packages"
apt update && apt upgrade -y

echo "==> Installing Docker + Compose plugin"
curl -fsSL https://get.docker.com | sh
apt install -y docker-compose-plugin

echo "==> Firewall: only SSH, HTTP, HTTPS allowed in"
apt install -y ufw
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

echo "==> Creating a non-root 'deploy' user"
if ! id -u deploy >/dev/null 2>&1; then
  adduser --disabled-password --gecos "" deploy
  usermod -aG docker deploy
  echo "    Created 'deploy'. Copy your SSH public key to it, then disable root SSH login."
fi

read -rp "Git repo URL for auzlabs-infra: " REPO_URL
if [ ! -d /opt/auzlabs-infra ]; then
  echo "==> Cloning $REPO_URL"
  git clone "$REPO_URL" /opt/auzlabs-infra
fi
cd /opt/auzlabs-infra

if [ ! -f .env ]; then
  cp .env.example .env
  echo ""
  echo "==> Created .env from template. Edit it now with real values:"
  echo "    nano /opt/auzlabs-infra/.env"
  echo "    Then re-run this script to start the stack."
  exit 0
fi

echo "==> Starting the stack"
docker compose up -d --build

echo ""
echo "==> Done. Useful commands:"
echo "    docker compose ps            # check everything is running"
echo "    docker compose logs -f app   # tail app logs"
