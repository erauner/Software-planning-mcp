#!/usr/bin/env node

import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

async function testMCPServer() {
  console.log('🧪 Testing MCP Software Planning Server...\n');

  // Create a temporary directory for testing
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-manual-test-'));
  console.log(`📁 Using temp directory: ${tempDir}`);

  const testCases = [
    {
      name: 'List Tools',
      input: {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
        params: {}
      }
    },
    {
      name: 'Start Planning (File Mode)',
      input: {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'start_planning',
          arguments: {
            goal: 'Test the MCP server functionality',
            projectPath: tempDir
          }
        }
      }
    },
    {
      name: 'Add Todo',
      input: {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'add_todo',
          arguments: {
            title: 'Test todo item',
            description: 'Verify that todos can be added',
            complexity: 5,
            codeExample: 'console.log("test");'
          }
        }
      }
    },
    {
      name: 'Get Todos',
      input: {
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: {
          name: 'get_todos',
          arguments: {}
        }
      }
    }
  ];

  for (const testCase of testCases) {
    console.log(`\n🔄 Testing: ${testCase.name}`);

    try {
      const result = await runMCPCommand(testCase.input);

      if (result.error) {
        console.log(`❌ Error: ${result.error.message}`);
      } else {
        console.log(`✅ Success!`);
        if (testCase.name === 'List Tools') {
          console.log(`   Found ${result.result.tools.length} tools`);
        } else if (testCase.name === 'Add Todo') {
          const todo = JSON.parse(result.result.content[0].text);
          console.log(`   Created todo: ${todo.title} (complexity: ${todo.complexity})`);
        } else if (testCase.name === 'Get Todos') {
          const todos = JSON.parse(result.result.content[0].text);
          console.log(`   Found ${todos.length} todos`);
        }
      }
    } catch (error) {
      console.log(`❌ Failed: ${error.message}`);
    }
  }

  // Cleanup
  await fs.rm(tempDir, { recursive: true, force: true });
  console.log('\n🧹 Cleaned up temp directory');
  console.log('\n✅ Manual testing complete!');
}

async function runMCPCommand(input) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', ['build/index.js'], {
      env: { ...process.env, STORAGE_MODE: 'file' },
      cwd: process.cwd()
    });

    let output = '';
    let errorOutput = '';

    child.stdout.on('data', (data) => output += data.toString());
    child.stderr.on('data', (data) => errorOutput += data.toString());

    child.stdin.write(JSON.stringify(input) + '\n');
    child.stdin.end();

    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error('Process timeout'));
    }, 10000);

    child.on('close', (code) => {
      clearTimeout(timeout);

      if (code !== 0) {
        reject(new Error(`Process exited with code ${code}. Stderr: ${errorOutput}`));
      } else {
        try {
          // Find the JSON-RPC response line
          const lines = output.trim().split('\n');
          const responseLine = lines.find(line => {
            try {
              const parsed = JSON.parse(line);
              return parsed.jsonrpc === '2.0';
            } catch {
              return false;
            }
          });

          if (responseLine) {
            resolve(JSON.parse(responseLine));
          } else {
            reject(new Error(`No valid JSON-RPC response found in output: ${output}`));
          }
        } catch (error) {
          reject(new Error(`Failed to parse output: ${error.message}. Output: ${output}`));
        }
      }
    });

    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

testMCPServer().catch(console.error);
