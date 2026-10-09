FROM node:22-alpine AS builder
WORKDIR /app

# Copy root manifests
COPY package.json package-lock.json tsconfig.json ./
COPY packages/contracts/package.json packages/contracts/
COPY packages/domain/package.json packages/domain/
COPY packages/db/package.json packages/db/
COPY packages/classifier/package.json packages/classifier/

RUN npm ci

# Copy source
COPY packages/contracts packages/contracts
COPY packages/domain packages/domain
COPY packages/db packages/db
COPY packages/classifier packages/classifier

# Build
RUN npm run build --workspace=@andx/contracts && \
    npm run build --workspace=@andx/domain && \
    npm run build --workspace=@andx/db && \
    npm run build --workspace=@andx/classifier

FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NODE_OPTIONS="--max-old-space-size=1024"

COPY --from=builder /app ./

CMD ["node", "packages/classifier/dist/index.js"]
