# =============================================================================
# Castor marketing website — production Nginx image
#
# Tiny, multi-arch (linux/amd64 + linux/arm64) static-site container.
# Serves the landing page on :8080 (non-root / Azure App Service friendly).
#
# The served web root is the CONTENTS of this `website/` directory:
#   /usr/share/nginx/html/index.html
#   /usr/share/nginx/html/404.html
#   /usr/share/nginx/html/css/styles.css
#   /usr/share/nginx/html/js/main.js
#   /usr/share/nginx/html/assets/castor-logo.{jpg,webp}
#
# so the HTML's absolute references (/css, /js, /assets) resolve correctly.
# NOTE: website/public/ is the designer's source copy and is intentionally
# NOT copied (also excluded via .dockerignore) — do not serve from it.
# =============================================================================
FROM nginx:1.27-alpine

LABEL org.opencontainers.image.title="Castor marketing website" \
      org.opencontainers.image.description="Static landing page for Castor — open-source multi-orchestrator container management." \
      org.opencontainers.image.vendor="LEONARD-IT" \
      org.opencontainers.image.licenses="Apache-2.0" \
      org.opencontainers.image.source="https://github.com/Yannleonard/Castor"

# Remove the stock default site so only our server block is active.
RUN rm -f /etc/nginx/conf.d/default.conf

# Our server config (listen 8080, gzip, caching, security headers, 404).
COPY nginx.conf /etc/nginx/conf.d/castor.conf

# --- Static site -> web root -------------------------------------------------
# Copy ONLY the served assets so the image stays minimal and the root matches
# the HTML's absolute paths. (public/, .claude/, CONTENT.md, Docker files, etc.
# are excluded here and in .dockerignore.)
COPY index.html 404.html /usr/share/nginx/html/
COPY css/    /usr/share/nginx/html/css/
COPY js/     /usr/share/nginx/html/js/
COPY assets/ /usr/share/nginx/html/assets/

# Make the served tree owned by / readable to the nginx worker user, and drop
# the .gitkeep placeholder that ships in assets/screenshots/.
RUN rm -f /usr/share/nginx/html/assets/screenshots/.gitkeep \
 && chown -R nginx:nginx /usr/share/nginx/html

# The stock nginx.conf binds the master to :80; switch the embedded default
# server to :8080 is handled by our conf.d server block, but the stock conf
# still references /var/run/nginx.pid and listens via conf.d only — we expose
# 8080. (We do NOT need a custom main nginx.conf: the default has no server{}.)
EXPOSE 8080

# Container-level health check (image runs wget via busybox in nginx:alpine).
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q --spider http://127.0.0.1:8080/healthz || exit 1

# nginx:alpine's default CMD runs `nginx -g 'daemon off;'`.
STOPSIGNAL SIGQUIT
CMD ["nginx", "-g", "daemon off;"]
