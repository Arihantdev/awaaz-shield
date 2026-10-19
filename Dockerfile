# Awaaz Shield: one image that serves the web app, the API and the call sockets from a single address.
#   docker build -t awaaz-shield .
#   docker run -p 8000:8000 --env-file backend/.env awaaz-shield      (then open http://localhost:8000)

# ---- 1) build the web app (talks to the page's own address, so no CORS or cross-site cookies are needed)
FROM node:22-slim AS web
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
# Firebase web-app settings (public identifiers, not secrets) are built into the page. Pass them as build args:
#   docker build --build-arg VITE_FIREBASE_API_KEY=... --build-arg VITE_FIREBASE_AUTH_DOMAIN=... \
#                --build-arg VITE_FIREBASE_PROJECT_ID=... --build-arg VITE_FIREBASE_APP_ID=... .
ARG VITE_FIREBASE_API_KEY=""
ARG VITE_FIREBASE_AUTH_DOMAIN=""
ARG VITE_FIREBASE_PROJECT_ID=""
ARG VITE_FIREBASE_APP_ID=""
ENV VITE_SAME_ORIGIN=true
RUN npm run build

# ---- 2) the backend, with the built web app next to it
FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 PORT=8000
WORKDIR /app
COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt
COPY backend/ backend/
COPY --from=web /app/frontend/dist frontend/dist
RUN useradd --create-home app && mkdir -p /app/backend/data && chown -R app /app/backend/data
USER app
WORKDIR /app/backend
EXPOSE 8000
# --proxy-headers: behind Render/Fly/nginx the request arrives as http; this makes the app see the original https
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT} --proxy-headers --forwarded-allow-ips='*'"]
