#!/usr/bin/env bash
# Copy deploy artifacts into place. Idempotent.
set -euo pipefail
cd "$(dirname "$0")/.."
install -m 644 deploy/nginx/mojomo.io /etc/nginx/sites-available/mojomo.io
install -m 644 deploy/www/sitemap.xml /var/www/mojomo/sitemap.xml
install -m 644 deploy/www/llms.txt   /var/www/mojomo/llms.txt
nginx -t && systemctl reload nginx
echo "deploy artifacts applied"
