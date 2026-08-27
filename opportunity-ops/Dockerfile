FROM node:22-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci

COPY tsconfig.json cloud-run.yaml README.md ./
COPY src ./src

RUN npm run typecheck

EXPOSE 8080
CMD ["npm", "run", "serve"]