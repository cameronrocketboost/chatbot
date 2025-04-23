# 1. Base Image
# Use an official Node.js runtime as a parent image (choose a version suitable for your project)
FROM node:20-slim AS base

# Set environment variables 
# Let Node.js know we're in production
ENV NODE_ENV=production
# Prevent prompts during installations
ENV DEBIAN_FRONTEND=noninteractive

# 2. Dependencies
FROM base AS deps

# Set the working directory in the container
WORKDIR /app

# Copy root package.json and lock file (needed for Yarn workspaces)
COPY package.json yarn.lock* ./ 
# If you have a .yarnrc.yml for workspaces, copy it too
# COPY .yarnrc.yml ./

# Copy backend package.json 
COPY backend/package.json ./backend/

# Install dependencies using Yarn workspaces
# This command might vary depending on your exact monorepo setup
# --frozen-lockfile ensures we use the exact versions from the lock file
RUN yarn install --frozen-lockfile --production

# 3. Build Stage
FROM base AS builder
WORKDIR /app

# Copy installed dependencies from the previous stage
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/package.json ./package.json
COPY --from=deps /app/yarn.lock* ./
# COPY --from=deps /app/.yarnrc.yml ./
COPY --from=deps /app/backend ./backend

# Copy the rest of the backend source code
COPY backend/src ./backend/src
COPY backend/tsconfig.json ./backend/

# Build the TypeScript code
# Assuming your backend's build script is named 'build' in backend/package.json
RUN yarn workspace backend build

# 4. Final Production Stage
FROM base AS final
WORKDIR /app

# Copy necessary files from the builder stage
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
# Copy backend package.json (might be needed for start script)
COPY --from=builder /app/backend/package.json ./backend/package.json 
# Copy the compiled JavaScript output (assuming it's in backend/dist)
COPY --from=builder /app/backend/dist ./backend/dist
# Copy the root .env file (adjust path if needed)
# Note: It's often better to manage secrets via Render's environment variables
# COPY .env ./.env 

# Expose the port the app runs on 
# Render provides the PORT env var, your app should listen on it
# No need to EXPOSE here usually, as Render handles mapping.

# Define the command to run the application
# Use the PORT environment variable provided by Render
# Assumes your start script in backend/package.json handles $PORT correctly
# Or directly run the compiled JS file
# Option A: Use start script (if it respects $PORT)
# CMD ["yarn", "workspace", "backend", "start"] 
# Option B: Run compiled JS directly (adjust path if needed)
CMD ["node", "backend/dist/server.js"] 