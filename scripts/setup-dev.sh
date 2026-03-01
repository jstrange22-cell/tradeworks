#!/bin/bash
# TradeWorks Development Setup Script
set -e

echo "==================================="
echo "  TradeWorks Development Setup"
echo "==================================="
echo ""

# Check prerequisites
echo "Checking prerequisites..."

if ! command -v node &> /dev/null; then
  echo "ERROR: Node.js is required. Install from https://nodejs.org"
  exit 1
fi

if ! command -v pnpm &> /dev/null; then
  echo "Installing pnpm..."
  npm install -g pnpm@9
fi

if ! command -v docker &> /dev/null; then
  echo "WARNING: Docker is not installed. You'll need it for databases."
  echo "Install from https://www.docker.com/products/docker-desktop/"
fi

echo "Node.js: $(node --version)"
echo "pnpm: $(pnpm --version)"
echo ""

# Install dependencies
echo "Installing dependencies..."
pnpm install

# Copy env file
if [ ! -f .env ]; then
  echo "Creating .env from .env.paper..."
  cp .env.paper .env
fi

# Start Docker services
if command -v docker &> /dev/null; then
  echo "Starting Docker services (Postgres, ClickHouse, Redis)..."
  docker compose -f docker/docker-compose.yml up -d
  echo "Waiting for services to be healthy..."
  sleep 10
fi

# Build packages
echo "Building packages..."
pnpm build

echo ""
echo "==================================="
echo "  Setup Complete!"
echo "==================================="
echo ""
echo "Available commands:"
echo "  pnpm dev          - Start all services in dev mode"
echo "  pnpm build        - Build all packages"
echo "  pnpm test         - Run all tests"
echo "  pnpm typecheck    - Type check all packages"
echo ""
echo "Docker services:"
echo "  PostgreSQL:  localhost:5432"
echo "  ClickHouse:  localhost:8123"
echo "  Redis:       localhost:6379"
echo ""
