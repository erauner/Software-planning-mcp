# MCP Protocol Compliance

## Critical: Stdout Pollution Prevention

**This is a critical requirement for all MCP servers.** The Model Context Protocol (MCP) uses JSON-RPC over stdio, which means stdout must contain **ONLY** valid JSON responses.

### The Problem

Any non-JSON output to stdout will break the MCP protocol:

```javascript
// ❌ NEVER DO THIS - Breaks MCP protocol
console.log("Debug message");
console.log("Loaded file:", filename);
process.stdout.write("Status: OK\n");

// ✅ CORRECT - Use stderr for all debug/log messages
console.error("Debug message");
console.error("Loaded file:", filename);
process.stderr.write("Status: OK\n");
```

### What Happens When Stdout Gets Polluted

When debug messages leak to stdout, Claude Desktop sees this:
```
Debug message: Loaded existing todos from /path/to/file
{"jsonrpc":"2.0","id":1,"result":{"tools":[...]}}
```

Instead of valid JSON:
```
{"jsonrpc":"2.0","id":1,"result":{"tools":[...]}}
```

This causes "Unexpected token" JSON parsing errors and breaks the MCP connection.

### Prevention Measures

This project includes several safeguards:

#### 1. Automated Code Checking

Run before every build:
```bash
npm run check:stdout
```

This scans source code for patterns that could cause pollution:
- `console.log()` 
- `process.stdout.write()`
- `console.info()`
- `console.warn()` (platform-dependent)

#### 2. Runtime Protocol Testing

Test the actual MCP protocol compliance:
```bash
npm run test:stdout
```

This spawns the MCP server and verifies that only valid JSON is output to stdout during real operations.

#### 3. Build Integration

The default build command includes the pollution check:
```bash
npm run build  # Includes stdout checking
npm run build:unsafe  # Skips checks (only for debugging)
```

### Common Pollution Sources in MCP Servers

1. **Debug Messages**: `console.log("Server starting...")`
2. **Git Command Output**: Error messages from git operations
3. **File Operation Logs**: Status messages about file I/O
4. **Library Debug Output**: Third-party libraries writing to stdout
5. **Error Messages**: Uncaught errors that print to stdout instead of stderr

### Rules for MCP Servers

1. **NEVER** use `console.log()` - always use `console.error()`
2. **NEVER** use `process.stdout.write()` - use `process.stderr.write()`
3. **ALWAYS** handle external command errors (git, etc.) properly
4. **ALWAYS** test your MCP server with the protocol compliance tests
5. **ALWAYS** run the pollution checks before deployment

### Testing Your MCP Server

```bash
# Test for code-level issues
npm run check:stdout

# Test actual protocol compliance  
npm run test:stdout

# Run all tests including pollution prevention
npm test
```

### Emergency Debugging

If you need to temporarily bypass pollution checking for debugging:

```bash
npm run build:unsafe  # Build without checks
```

But **NEVER** deploy code that fails pollution checks!

---

Remember: **A single `console.log()` can break the entire MCP connection.** Always use `console.error()` for debug output.
