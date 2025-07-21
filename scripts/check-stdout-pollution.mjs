#!/usr/bin/env node

/**
 * Stdout Pollution Checker for MCP Servers
 * 
 * This script scans the source code for potential stdout pollution issues
 * that could break MCP JSON-RPC protocol compliance.
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const ISSUES_FOUND = [];

// Patterns that indicate potential stdout pollution
const POLLUTION_PATTERNS = [
  {
    pattern: /console\.log\s*\(/g,
    message: 'console.log() writes to stdout and will break MCP JSON-RPC protocol',
    suggestion: 'Use console.error() instead to write to stderr'
  },
  {
    pattern: /process\.stdout\.write\s*\(/g,
    message: 'process.stdout.write() will pollute the JSON-RPC stream',
    suggestion: 'Use process.stderr.write() or console.error() instead'
  },
  {
    pattern: /console\.info\s*\(/g,
    message: 'console.info() typically writes to stdout and may break MCP protocol',
    suggestion: 'Use console.error() instead to write to stderr'
  }
];

// Simple glob implementation for TypeScript files
function findTSFiles(dir) {
  let files = [];
  const entries = readdirSync(dir);
  
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    
    if (stat.isDirectory() && !entry.startsWith('.')) {
      files = files.concat(findTSFiles(fullPath));
    } else if (entry.endsWith('.ts')) {
      files.push(fullPath);
    }
  }
  
  return files;
}

// Files to check (TypeScript source files)
const SOURCE_FILES = findTSFiles('src');

console.error('🔍 Checking for potential stdout pollution in MCP server...\n');

SOURCE_FILES.forEach(filePath => {
  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');

  POLLUTION_PATTERNS.forEach(({ pattern, message, suggestion }) => {
    let match;
    
    while ((match = pattern.exec(content)) !== null) {
      // Find the line number
      const beforeMatch = content.substring(0, match.index);
      const lineNumber = beforeMatch.split('\n').length;
      const line = lines[lineNumber - 1].trim();

      // Skip if it's in a comment
      if (line.startsWith('//') || line.startsWith('*') || line.startsWith('/*')) {
        continue;
      }

      ISSUES_FOUND.push({
        file: filePath,
        line: lineNumber,
        code: line,
        message,
        suggestion,
        pattern: pattern.source
      });
    }
    
    // Reset regex lastIndex for next iteration
    pattern.lastIndex = 0;
  });
});

// Report results
if (ISSUES_FOUND.length === 0) {
  console.error('✅ No stdout pollution issues found!');
  console.error('   MCP JSON-RPC protocol compliance verified.\n');
  process.exit(0);
} else {
  console.error('❌ Stdout pollution issues detected!\n');
  console.error('   These issues will break MCP JSON-RPC protocol compliance.\n');
  
  ISSUES_FOUND.forEach((issue, index) => {
    console.error(`${index + 1}. ${issue.file}:${issue.line}`);
    console.error(`   Code: ${issue.code}`);
    console.error(`   Issue: ${issue.message}`);
    console.error(`   Fix: ${issue.suggestion}\n`);
  });

  console.error('🚨 CRITICAL: MCP servers must not write anything to stdout except JSON-RPC responses!');
  console.error('   All debug, log, and error messages must use stderr (console.error).\n');
  
  process.exit(1);
}
