#!/bin/bash
set -e

echo "🚀 Pushing Software Planning MCP to GHCR"

# Set the token (you'll replace this)
export GITHUB_TOKEN="YOUR_TOKEN_HERE"
export GITHUB_USERNAME="erauner"

# Login to GHCR
echo "🔐 Logging into GitHub Container Registry..."
echo $GITHUB_TOKEN | docker login ghcr.io -u $GITHUB_USERNAME --password-stdin

# Push the image
echo "📤 Pushing image..."
docker push ghcr.io/$GITHUB_USERNAME/software-planning-mcp:latest

echo "✅ Push complete!"
echo "🌐 Image available at: ghcr.io/$GITHUB_USERNAME/software-planning-mcp:latest"

# Clean up
unset GITHUB_TOKEN
