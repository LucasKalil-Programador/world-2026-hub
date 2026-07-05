# World Cup 2026 Hub — static-site image for Dokploy (nginx).
#
# There is NO build step: the app is plain HTML/CSS/ES-module JS + JSON data.
# Files are copied under the /worldcup2026 subpath so the container path matches
# the public URL (app.lucaskalil.com/worldcup2026) 1:1. See nginx.conf for the
# routing/cache policy and the required Dokploy domain settings.
FROM nginx:1.27-alpine

# Server config (serves the app under /worldcup2026, sets cache + MIME policy).
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Ship ONLY the real app — no docs, specs, .agents/ or CI files reach the image.
COPY index.html manifest.json favicon.ico /usr/share/nginx/html/worldcup2026/
COPY assets/ /usr/share/nginx/html/worldcup2026/assets/
COPY data/   /usr/share/nginx/html/worldcup2026/data/

EXPOSE 80

# Container-level health probe (busybox wget ships with nginx:alpine).
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1/healthz || exit 1

# nginx:alpine's default CMD already runs nginx in the foreground.
