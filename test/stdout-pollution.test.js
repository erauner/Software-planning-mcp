import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'child_process';
import path from 'path';

describe('MCP Protocol Compliance', () => {
  describe('Stdout Pollution Prevention', () => {
    it('should not output non-JSON content to stdout during MCP operations', async () => {
      // Start the MCP server
      const serverPath = path.resolve('./build/index.js');
      const serverProcess = spawn('node', [serverPath], {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: process.cwd()
      });

      let stdoutData = '';
      let stderrData = '';
      
      // Collect all stdout and stderr data
      serverProcess.stdout.on('data', (data) => {
        stdoutData += data.toString();
      });
      
      serverProcess.stderr.on('data', (data) => {
        stderrData += data.toString();
      });

      // Wait for server to start
      await new Promise((resolve) => {
        serverProcess.stderr.on('data', (data) => {
          if (data.toString().includes('Software Planning MCP server running on stdio')) {
            resolve();
          }
        });
      });

      // Send a series of MCP requests that might trigger debug output
      const requests = [
        // List tools
        { jsonrpc: '2.0', id: 1, method: 'tools/list' },
        // Start planning (might trigger git branch detection)
        { 
          jsonrpc: '2.0', 
          id: 2, 
          method: 'tools/call', 
          params: { 
            name: 'start_planning', 
            arguments: { goal: 'Test stdout pollution' } 
          } 
        },
        // Add todo
        { 
          jsonrpc: '2.0', 
          id: 3, 
          method: 'tools/call', 
          params: { 
            name: 'add_todo', 
            arguments: { 
              title: 'Test todo', 
              description: 'Test description', 
              complexity: 5 
            } 
          } 
        },
        // List branch todos (might trigger file operations)
        { 
          jsonrpc: '2.0', 
          id: 4, 
          method: 'tools/call', 
          params: { 
            name: 'list_branch_todos', 
            arguments: {} 
          } 
        }
      ];

      // Send requests and collect responses
      const responses = [];
      let responseCount = 0;

      const sendNextRequest = () => {
        if (responseCount < requests.length) {
          const request = requests[responseCount];
          serverProcess.stdin.write(JSON.stringify(request) + '\n');
        }
      };

      serverProcess.stdout.on('data', (data) => {
        const chunk = data.toString();
        
        // Try to parse each line as JSON
        const lines = chunk.trim().split('\n').filter(line => line.trim());
        
        for (const line of lines) {
          try {
            const response = JSON.parse(line);
            responses.push({ line, parsed: response });
            responseCount++;
            
            // Send next request after getting a response
            if (responseCount < requests.length) {
              setTimeout(sendNextRequest, 100);
            } else {
              // All responses received, end test
              serverProcess.kill('SIGTERM');
            }
          } catch (parseError) {
            // This is the critical test - we should never get non-JSON on stdout
            serverProcess.kill('SIGTERM');
            throw new Error(
              `STDOUT POLLUTION DETECTED: Non-JSON content found on stdout: "${line}"\n` +
              `Parse error: ${parseError.message}\n` +
              `This breaks MCP JSON-RPC protocol compliance.\n` +
              `All debug/log messages must use console.error (stderr) not console.log (stdout).`
            );
          }
        }
      });

      // Start the request chain
      sendNextRequest();

      // Wait for all responses or timeout
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          serverProcess.kill('SIGTERM');
          reject(new Error('Test timeout - server did not respond to all requests'));
        }, 10000);

        serverProcess.on('exit', () => {
          clearTimeout(timeout);
          resolve();
        });
      });

      // Verify we got valid JSON responses for all requests
      assert.equal(responses.length, requests.length, 
        `Expected ${requests.length} JSON responses, got ${responses.length}`);

      // Verify all responses are valid JSON-RPC
      responses.forEach((response, index) => {
        assert.ok(response.parsed.jsonrpc, 
          `Response ${index + 1} missing jsonrpc field: ${response.line}`);
        assert.ok(response.parsed.id !== undefined, 
          `Response ${index + 1} missing id field: ${response.line}`);
        assert.ok(response.parsed.result || response.parsed.error, 
          `Response ${index + 1} missing result or error field: ${response.line}`);
      });

      // Log what was properly sent to stderr (this is good)
      if (stderrData.trim()) {
        console.log('✅ Debug output correctly sent to stderr:', stderrData.trim());
      }
    });

    it('should handle non-git directory without stdout pollution', async () => {
      // Create a temporary non-git directory
      const { mkdtemp, rm } = await import('fs/promises');
      const { tmpdir } = await import('os');
      
      const tempDir = await mkdtemp(path.join(tmpdir(), 'mcp-test-'));

      try {
        // Start server in non-git directory
        const serverPath = path.resolve('./build/index.js');
        const serverProcess = spawn('node', [serverPath], {
          stdio: ['pipe', 'pipe', 'pipe'],
          cwd: tempDir // This is not a git repository
        });

        let stdoutLines = [];
        let pollutionDetected = false;

        serverProcess.stdout.on('data', (data) => {
          const lines = data.toString().trim().split('\n').filter(line => line.trim());
          
          for (const line of lines) {
            try {
              JSON.parse(line);
              stdoutLines.push(line);
            } catch (parseError) {
              pollutionDetected = true;
              serverProcess.kill('SIGTERM');
              throw new Error(
                `STDOUT POLLUTION in non-git directory: "${line}"\n` +
                `This often happens when git commands fail and error messages leak to stdout.\n` +
                `Ensure all git error handling uses console.error, not console.log.`
              );
            }
          }
        });

        // Wait for server to start
        await new Promise((resolve) => {
          serverProcess.stderr.on('data', (data) => {
            if (data.toString().includes('Software Planning MCP server running on stdio')) {
              resolve();
            }
          });
        });

        // Test start_planning in non-git directory
        const request = {
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'start_planning',
            arguments: { goal: 'Test non-git directory' }
          }
        };

        serverProcess.stdin.write(JSON.stringify(request) + '\n');

        // Wait for response
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            if (!pollutionDetected) {
              serverProcess.kill('SIGTERM');
              resolve(); // Success if no pollution detected
            }
          }, 3000);

          serverProcess.on('exit', () => {
            clearTimeout(timeout);
            if (!pollutionDetected) {
              resolve();
            }
          });
        });

        assert.ok(!pollutionDetected, 'No stdout pollution should be detected in non-git directory');
        
      } finally {
        // Cleanup
        await rm(tempDir, { recursive: true, force: true });
      }
    });

    it('should not leak git command output to stdout', async () => {
      // Test that git command failures don't pollute stdout
      const serverPath = path.resolve('./build/index.js');
      
      // Create a directory that looks like git but isn't
      const { mkdtemp, rm, mkdir, writeFile } = await import('fs/promises');
      const { tmpdir } = await import('os');
      
      const tempDir = await mkdtemp(path.join(tmpdir(), 'fake-git-'));
      const gitDir = path.join(tempDir, '.git');
      await mkdir(gitDir);
      await writeFile(path.join(gitDir, 'config'), 'invalid git config');

      try {
        const serverProcess = spawn('node', [serverPath], {
          stdio: ['pipe', 'pipe', 'pipe'],
          cwd: tempDir
        });

        let gitErrorDetected = false;

        serverProcess.stdout.on('data', (data) => {
          const content = data.toString();
          
          // Check for common git error patterns that might leak
          const gitErrorPatterns = [
            /fatal:/i,
            /error:/i,
            /not a git repository/i,
            /git:/i,
            /repository/i
          ];

          for (const pattern of gitErrorPatterns) {
            if (pattern.test(content)) {
              gitErrorDetected = true;
              serverProcess.kill('SIGTERM');
              throw new Error(
                `GIT ERROR OUTPUT DETECTED on stdout: "${content}"\n` +
                `Git command errors must be handled and not leak to stdout.\n` +
                `This breaks MCP protocol compliance.`
              );
            }
          }
        });

        // Wait for server start and test
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            serverProcess.kill('SIGTERM');
            if (!gitErrorDetected) {
              resolve(); // Success if no git errors leaked
            }
          }, 5000);

          serverProcess.stderr.on('data', (data) => {
            if (data.toString().includes('Software Planning MCP server running on stdio')) {
              // Server started, test git branch detection
              const request = {
                jsonrpc: '2.0',
                id: 1,
                method: 'tools/call',
                params: {
                  name: 'start_planning',
                  arguments: { goal: 'Test git error handling' }
                }
              };
              serverProcess.stdin.write(JSON.stringify(request) + '\n');
              
              setTimeout(() => {
                if (!gitErrorDetected) {
                  clearTimeout(timeout);
                  resolve();
                }
              }, 2000);
            }
          });

          serverProcess.on('exit', () => {
            clearTimeout(timeout);
            if (!gitErrorDetected) {
              resolve();
            }
          });
        });

        assert.ok(!gitErrorDetected, 'Git command errors should not leak to stdout');

      } finally {
        // Cleanup
        await rm(tempDir, { recursive: true, force: true });
      }
    });
  });
});
