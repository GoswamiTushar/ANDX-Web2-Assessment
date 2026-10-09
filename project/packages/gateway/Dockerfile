FROM node:22-alpine AS builder
WORKDIR /app

# Copy root manifests
COPY package.json package-lock.json tsconfig.json ./
COPY packages/contracts/package.json packages/contracts/
COPY packages/domain/package.json packages/domain/
COPY packages/gateway/package.json packages/gateway/

RUN npm ci

# Copy source
COPY packages/contracts packages/contracts
COPY packages/domain packages/domain
COPY packages/gateway packages/gateway

# Build
RUN npm run build --workspace=@andx/contracts && \
    npm run build --workspace=@andx/domain && \
    npm run build --workspace=@andx/gateway

FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NODE_OPTIONS="--max-old-space-size=1024"

COPY --from=builder /app ./

EXPOSE 8080
CMD ["node", "packages/gateway/dist/index.js"]
