# Kubernetes Testing Guide for MCP Software Planning

This guide explains how to test the MCP Software Planning server deployed in Kubernetes without relying on external URLs.

## Prerequisites

- `kubectl` configured with access to your cluster
- `jq` installed for JSON parsing (optional but recommended)
- Access to the `devops` namespace (or adjust `K8S_NAMESPACE` env var)

## Quick Start

```bash
# Run quick smoke test
make k8s-quick-test

# Run comprehensive tests
make k8s-test

# Run interactive demo
make k8s-demo
```

## Available Test Scripts

### 1. Quick Test (`k8s-quick-test.sh`)
Fast smoke test that verifies basic functionality:
- Health endpoint
- Supergateway process
- Redis connectivity
- MCP server response
- External access (optional)

```bash
./scripts/k8s-quick-test.sh
```

### 2. Comprehensive Test (`k8s-test.sh`)
Full test suite including:
- Deployment status
- Health checks
- Supergateway verification
- Redis connection
- Direct MCP server testing

```bash
./scripts/k8s-test.sh
```

### 3. Tools Test (`k8s-tools-test.sh`)
Tests all MCP tools functionality:
- Initialize protocol
- List available tools
- Start planning
- Save plans
- Add/get todos
- Session isolation

```bash
./scripts/k8s-tools-test.sh
```

### 4. Debug Script (`k8s-debug.sh`)
Detailed debugging information:
- Deployment details
- Pod events
- Service endpoints
- HTTPRoute configuration
- Process listing
- Environment variables
- Network connectivity
- Recent logs

```bash
./scripts/k8s-debug.sh
```

### 5. Example Usage (`k8s-example-usage.sh`)
Interactive client and demo scenarios:

```bash
# Run demo scenario
./scripts/k8s-example-usage.sh demo

# Start interactive mode
./scripts/k8s-example-usage.sh interactive
```

## Testing Without External URLs

All tests work by using `kubectl exec` to run commands inside the pod. This approach:
- Doesn't require external network access
- Tests the actual deployed container
- Verifies internal connectivity
- Works even if ingress/HTTPRoute is misconfigured

### Example: Direct MCP Testing

```bash
# Get pod name
POD=$(kubectl get pods -n devops -l app=mcp-software-planning -o jsonpath='{.items[0].metadata.name}')

# Test MCP server directly via stdio
kubectl exec -n devops $POD -- sh -c 'echo '\''{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{"tools":{}},"clientInfo":{"name":"test","version":"1.0"}},"id":1}'\'' | node /app/build/index.js'
```

## Environment Variables

All scripts support these environment variables:

- `K8S_NAMESPACE` - Kubernetes namespace (default: `devops`)
- `APP_LABEL` - Pod selector label (default: `app=mcp-software-planning`)
- `TEST_USER` - User ID for testing (default: `k8s-test-user`)
- `TEST_SESSION` - Session ID for testing (default: `k8s-test-session`)

Example usage:
```bash
K8S_NAMESPACE=my-namespace TEST_USER=alice ./scripts/k8s-tools-test.sh
```

## Makefile Targets

```bash
make k8s-quick-test    # Quick smoke test
make k8s-test          # Comprehensive test suite
make k8s-test-tools    # Test all MCP tools
make k8s-debug         # Show debug information
make k8s-logs          # Follow pod logs
make k8s-status        # Quick status check
make k8s-demo          # Run demo scenario
make k8s-interactive   # Start interactive client
```

## Understanding Test Results

### Successful Test Output
```
🚀 Quick K8s MCP Test
====================
Pod: mcp-software-planning-xxx

1. Health check: ✅ PASS
2. Supergateway: ✅ Running
3. Redis connection: ✅ Configured
4. MCP server: ✅ Responding
5. External access: ✅ Available
```

### Common Issues

1. **"Terminated" messages**: Normal behavior when using `timeout` command
2. **"command terminated with exit code 143"**: Expected when timeout expires
3. **External access fails**: Check HTTPRoute and ingress configuration
4. **Redis connection fails**: Verify Redis service is running and accessible

## Debugging Failed Tests

1. Check pod status:
   ```bash
   kubectl get pods -n devops -l app=mcp-software-planning
   ```

2. View recent logs:
   ```bash
   make k8s-logs
   ```

3. Run debug script:
   ```bash
   make k8s-debug
   ```

4. Execute shell in pod:
   ```bash
   kubectl exec -it -n devops <pod-name> -- sh
   ```

## Architecture Notes

The deployment uses:
- **Supergateway**: HTTP/2 bridge for stdio MCP servers
- **Stateless mode**: Each request spawns fresh process
- **Redis backend**: All state stored in Redis
- **StreamableHttp transport**: Requires proper Accept headers

## CI/CD Integration

These scripts can be integrated into CI/CD pipelines:

```yaml
# Example GitHub Actions step
- name: Test K8s deployment
  run: |
    ./scripts/k8s-quick-test.sh
    ./scripts/k8s-tools-test.sh
```

## Contributing

When adding new tests:
1. Create script in `scripts/` directory
2. Make it executable: `chmod +x scripts/your-script.sh`
3. Add Makefile target for easy access
4. Document usage in this guide
