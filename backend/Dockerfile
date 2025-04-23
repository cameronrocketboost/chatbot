########################
# 0. Shared arguments  #
########################
ARG NODE_VERSION=22

###################
# 1. Base layer   #
###################
FROM node:${NODE_VERSION}-slim AS base
WORKDIR /app

# Do **NOT** set NODE_ENV here – leave it to the dedicated stages
ENV TZ=UTC
# Enable the native package-manager cache
RUN corepack enable

#########################
# 2. Dependencies layer #
#########################
FROM base AS deps
COPY package.json yarn.lock ./
COPY backend/package.json ./backend/

#  --production installs only prod deps (good for final layer)
RUN yarn install --frozen-lockfile --production

#######################
# 3. Builder layer    #
#######################
FROM base AS builder

# 👇 Override NODE_ENV so that dev-deps (typescript, eslint …) are installed
ENV NODE_ENV=development

COPY package.json yarn.lock ./
COPY backend/package.json ./backend/
RUN yarn install --frozen-lockfile --production=false

# Now add source code **after** deps to maximise Docker cache hits
COPY backend/tsconfig.json ./backend/
COPY backend/src ./backend/src

# Transpile TS ➜ JS
RUN yarn workspace backend build

#########################
# 4. Runtime (tiny)     #
#########################
FROM base AS runtime
# Re-enable production mode in the final image
ENV NODE_ENV=production

# Copy only what the app needs
COPY --from=deps    /app/node_modules     ./node_modules
COPY --from=builder /app/backend/dist     ./backend/dist
COPY --from=deps    /app/package.json     ./package.json
COPY --from=deps    /app/backend/package.json  ./backend/package.json

# Render injects $PORT at runtime; your server should `listen(process.env.PORT)`
EXPOSE 8000
CMD ["node", "backend/dist/server.js"]
