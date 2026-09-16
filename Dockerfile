FROM node:22-bookworm AS fe
WORKDIR /fe
COPY frontend/package.json ./
RUN npm install
COPY frontend ./
RUN npm run build

FROM python:3.12-slim-bookworm
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends curl ca-certificates gnupg \
  && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
  && apt-get install -y --no-install-recommends nodejs \
  && npm install -g @anthropic-ai/claude-code \
  && apt-get purge -y gnupg \
  && rm -rf /var/lib/apt/lists/*

COPY *.py ./
COPY prompts ./prompts
COPY --from=fe /fe/dist ./frontend/dist

ENV LIFE_KGI_HOST=0.0.0.0
EXPOSE 8787
CMD ["python3", "kgi.py", "--serve", "--port", "8787"]
