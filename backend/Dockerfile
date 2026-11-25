# Node API image (document admin, calendar, chat relay). The RAG service has its own image
# (backend/python/Dockerfile).
#
#   docker build -t campus-api backend
#   docker run --rm -p 5000:5000 --env-file <your secrets env file> campus-api
#
# Secrets are never copied into the image: pass them at run time.
FROM node:22-slim

ENV NODE_ENV=production \
    PORT=5000

WORKDIR /app

# Dependencies first so this layer is reused until the lockfile changes.
# --ignore-scripts: nothing in the dependency tree runs code at install time.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

COPY . .

# An unprivileged user (the node image ships one)
USER node

EXPOSE 5000

# /healthz does not touch the database, so checking it often costs nothing
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||5000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "index.js"]
