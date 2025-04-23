# 1. Base Image
# Use an official Node.js runtime as a parent image (choose a version suitable for your project)
FROM node:22-slim AS base

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

# Copy necessary package manager files for a full install
COPY package.json yarn.lock* ./
# COPY .yarnrc.yml ./ # Uncomment if you have this file
COPY backend/package.json ./backend/

# Install ALL dependencies (prod + dev) from scratch in this stage
RUN yarn install --frozen-lockfile

# Now copy the backend source code
# Note: Copying after install prevents needing to reinstall if only source code changes
COPY backend/src ./backend/src
COPY backend/tsconfig.json ./backend/

# Build the TypeScript code
RUN yarn workspace backend build

# 4. Final Production Stage
FROM base AS final
WORKDIR /app

# Copy necessary files from the builder stage
# We need the production node_modules from the *deps* stage, 
# not the potentially larger ones from the builder stage.
COPY --from=deps /app/node_modules ./node_modules 
COPY --from=deps /app/package.json ./package.json
COPY --from=deps /app/backend/package.json ./backend/package.json 
# Copy the compiled JavaScript output from the builder stage
COPY --from=builder /app/backend/dist ./backend/dist

# Expose the port the app runs on 
# Render provides the PORT env var, your app should listen on it
# No need to EXPOSE here usually, as Render handles mapping.

# Define the command to run the application
CMD ["node", "backend/dist/server.js"] 