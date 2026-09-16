FROM node:22-bookworm
WORKDIR /app

RUN npm install -g @anthropic-ai/claude-code

COPY package.json ./
RUN npm install
COPY . .
RUN npm run build

ENV LIFE_KGI_HOST=0.0.0.0
ENV PORT=8787
EXPOSE 8787
CMD ["npm", "start"]
