# Kubernetes Deployment Guide for Software Planning MCP

## 📋 Pre-Deployment Steps

### 1. **Build and Push Docker Image to GHCR**

```bash
# Login to GitHub Container Registry
echo $GITHUB_TOKEN | docker login ghcr.io -u YOUR_GITHUB_USERNAME --password-stdin

# Build the image
docker build -t ghcr.io/YOUR_GITHUB_USERNAME/software-planning-mcp:latest .

# Push to GHCR
docker push ghcr.io/YOUR_GITHUB_USERNAME/software-planning-mcp:latest
```

**Note**: Replace `YOUR_GITHUB_USERNAME` with your actual GitHub username.

### 2. **Create GitHub Container Registry Secret in Kubernetes**

If you haven't already created the `ghcr-creds-pull` secret:

```bash
kubectl create secret docker-registry ghcr-creds-pull \
  --docker-server=ghcr.io \
  --docker-username=YOUR_GITHUB_USERNAME \
  --docker-password=YOUR_GITHUB_TOKEN \
  --namespace=devops
```

### 3. **Verify Redis (Dragonfly) is Running**

```bash
# Check snapdragon cache status
kubectl get dragonfly -n devops
kubectl get pods -n devops -l app.kubernetes.io/name=dragonfly

# Test Redis connectivity
kubectl run redis-test --rm -it --image=redis:alpine --restart=Never -- \
  redis-cli -h snapdragon.devops.svc.cluster.local ping
```

## 🚀 Deployment Steps

### 1. **Update the Kubernetes Manifest**

The deployment manifest has been updated with:
- ✅ Custom Docker image from GHCR
- ✅ Redis session management environment variables
- ✅ Reduced resource requirements
- ✅ Faster startup times

### 2. **Apply the Updated Configuration**

```bash
# From your homelab-k8s repository
cd /Users/erauner/git/side/homelab-k8s

# Apply the mcp-software-planning stack
kubectl apply -k apps/mcp-software-planning/stack/production

# Or if using Flux, reconcile the stack
flux reconcile kustomization home-mcp-software-planning-stack -n flux-system
```

### 3. **Monitor the Deployment**

```bash
# Watch pod startup
kubectl get pods -n devops -l app=mcp-software-planning -w

# Check logs
kubectl logs -n devops -l app=mcp-software-planning -f

# Verify service endpoints
kubectl get endpoints -n devops mcp-software-planning
```

## 🔍 Verification

### 1. **Check Pod Status**

```bash
kubectl describe pod -n devops -l app=mcp-software-planning
```

Expected output should show:
- Image: `ghcr.io/erauner/software-planning-mcp:latest`
- Environment variables for Redis configuration
- Health checks passing

### 2. **Test MCP Functionality**

Port-forward to test locally:

```bash
# Forward the service port
kubectl port-forward -n devops svc/mcp-software-planning 4626:4626

# In another terminal, test with curl
curl -X POST http://localhost:4626/health
```

### 3. **Test Through Envoy Gateway**

Your service should be accessible at:
- Internal: `http://mcp-software-planning.devops.svc.cluster.local:4626`
- External: `https://planning-lab.erauner.dev`

Test the external endpoint:

```bash
curl -X POST https://planning-lab.erauner.dev/health
```

## 🔧 Troubleshooting

### Image Pull Errors

If you see `ErrImagePull`:

1. Verify the secret exists:
   ```bash
   kubectl get secret ghcr-creds-pull -n devops
   ```

2. Check the image is public or you have access:
   ```bash
   docker pull ghcr.io/erauner/software-planning-mcp:latest
   ```

### Redis Connection Errors

If you see Redis connection failures:

1. Verify snapdragon is running:
   ```bash
   kubectl get pods -n devops snapdragon-0
   ```

2. Test connectivity from the pod:
   ```bash
   kubectl exec -n devops deploy/mcp-software-planning -- \
     sh -c "apk add redis && redis-cli -h snapdragon.devops.svc.cluster.local ping"
   ```

### Supergateway Installation Issues

If supergateway fails to install:

1. Check npm cache permissions:
   ```bash
   kubectl exec -n devops deploy/mcp-software-planning -- ls -la /tmp/.npm
   ```

2. Consider pre-installing supergateway in your Docker image

## 📝 Environment Variables Reference

| Variable | Value | Description |
|----------|-------|-------------|
| `STORAGE_MODE` | `redis` | Enables Redis session management |
| `REDIS_URL` | `redis://snapdragon.devops.svc.cluster.local:6379` | Dragonfly connection URL |
| `REDIS_KEY_PREFIX` | `planning` | Prefix for all Redis keys |
| `REDIS_TTL` | `2592000` | Session TTL (30 days) |
| `REPO_ID_MODE` | `auto` | Automatic repository detection |
| `ENABLE_MULTI_REPO` | `true` | Support multiple repositories |

## 🎯 Next Steps

1. **Update Claude Desktop Configuration**:
   ```json
   {
     "mcpServers": {
       "software-planning": {
         "command": "/path/to/http-mcp-client.js",
         "args": ["https://planning-lab.erauner.dev/mcp"],
         "description": "Remote Software Planning MCP Server"
       }
     }
   }
   ```

2. **Monitor Usage**:
   - Check Redis for active sessions: `redis-cli -h snapdragon keys planning:*`
   - Monitor pod resources: `kubectl top pod -n devops -l app=mcp-software-planning`

3. **Set Up Backups**:
   - Configure Dragonfly persistence
   - Set up regular Redis backups for session data

## 🔐 Security Considerations

1. **GHCR Access**: The deployment uses `ghcr-creds-pull` for private images
2. **Redis Security**: Consider adding Redis AUTH if exposed beyond the cluster
3. **Network Policies**: Restrict access to Redis from only the MCP pods
4. **HTTPS Only**: External access through Envoy Gateway uses TLS

---

**Ready to Deploy!** 🚀 Follow these steps to get your Redis-enabled Software Planning MCP running in Kubernetes.
