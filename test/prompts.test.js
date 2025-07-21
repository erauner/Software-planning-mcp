import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatPlanAsTodos, formatTodosForDisplay, formatBranchSummary } from '../build/prompts.js';

describe('Prompts', () => {
  describe('formatPlanAsTodos', () => {
    it('should parse simple plan text into todos', () => {
      const planText = `1. Create database schema
Complexity: 7
Design and implement the database tables for storing user data.

\`\`\`sql
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE
);
\`\`\`

2. Implement authentication
Complexity: 5
Add user login and registration functionality.`;

      const todos = formatPlanAsTodos(planText);
      
      assert.equal(todos.length, 2);
      
      // First todo
      assert.equal(todos[0].title, 'Create database schema');
      assert.equal(todos[0].complexity, 7);
      assert.ok(todos[0].description.includes('Design and implement'));
      assert.ok(todos[0].codeExample);
      assert.ok(todos[0].codeExample.includes('CREATE TABLE'));
      
      // Second todo
      assert.equal(todos[1].title, 'Implement authentication');
      assert.equal(todos[1].complexity, 5);
      assert.ok(todos[1].description.includes('Add user login'));
    });

    it('should handle plan without complexity scores', () => {
      const planText = `1. Setup project structure
Initialize the project with necessary dependencies.

2. Create basic components
Build the core components for the application.`;

      const todos = formatPlanAsTodos(planText);
      
      assert.equal(todos.length, 2);
      assert.equal(todos[0].complexity, 5); // Default complexity
      assert.equal(todos[1].complexity, 5);
    });

    it('should handle empty plan text', () => {
      const todos = formatPlanAsTodos('');
      assert.equal(todos.length, 0);
    });

    it('should handle plan without code examples', () => {
      const planText = `1. Write documentation
Complexity: 3
Create comprehensive documentation for the API.`;

      const todos = formatPlanAsTodos(planText);
      
      assert.equal(todos.length, 1);
      assert.equal(todos[0].title, 'Write documentation');
      assert.equal(todos[0].complexity, 3);
      assert.equal(todos[0].codeExample, undefined);
    });
  });

  describe('formatTodosForDisplay', () => {
    it('should format mixed completed and pending todos', () => {
      const todos = [
        {
          id: '1',
          title: 'Setup database',
          complexity: 8,
          isComplete: false
        },
        {
          id: '2',
          title: 'Create API endpoints',
          complexity: 6,
          isComplete: true
        },
        {
          id: '3',
          title: 'Write tests',
          complexity: 4,
          isComplete: false
        }
      ];

      const display = formatTodosForDisplay(todos, 'feature/api');
      
      assert.ok(display.includes('⏺ Current Todos (branch: feature/api)'));
      assert.ok(display.includes('⎿ Active Tasks:'));
      assert.ok(display.includes('☐ Setup database (Complexity: 8)'));
      assert.ok(display.includes('☐ Write tests (Complexity: 4)'));
      assert.ok(display.includes('⎿ Completed:'));
      assert.ok(display.includes('☒ Create API endpoints'));
    });

    it('should handle only pending todos', () => {
      const todos = [
        {
          id: '1',
          title: 'Task 1',
          complexity: 5,
          isComplete: false
        },
        {
          id: '2',
          title: 'Task 2',
          complexity: 3,
          isComplete: false
        }
      ];

      const display = formatTodosForDisplay(todos, 'main');
      
      assert.ok(display.includes('⏺ Current Todos (branch: main)'));
      assert.ok(display.includes('⎿ Active Tasks:'));
      assert.ok(display.includes('☐ Task 1 (Complexity: 5)'));
      assert.ok(display.includes('☐ Task 2 (Complexity: 3)'));
      assert.ok(!display.includes('⎿ Completed:'));
    });

    it('should handle only completed todos', () => {
      const todos = [
        {
          id: '1',
          title: 'Completed task',
          isComplete: true
        }
      ];

      const display = formatTodosForDisplay(todos, 'main');
      
      assert.ok(display.includes('⎿ Completed:'));
      assert.ok(display.includes('☒ Completed task'));
      assert.ok(!display.includes('⎿ Active Tasks:'));
    });

    it('should handle empty todos list', () => {
      const display = formatTodosForDisplay([], 'main');
      
      assert.ok(display.includes('⎿ No todos yet. Start adding tasks!'));
    });

    it('should handle todos without complexity', () => {
      const todos = [
        {
          id: '1',
          title: 'Simple task',
          isComplete: false
        }
      ];

      const display = formatTodosForDisplay(todos, 'main');
      
      assert.ok(display.includes('☐ Simple task'));
      assert.ok(!display.includes('Complexity:'));
    });
  });

  describe('formatBranchSummary', () => {
    it('should format branch summaries with progress bars', () => {
      const summaries = [
        {
          branch: 'main',
          total: 10,
          completed: 8,
          percentage: 80
        },
        {
          branch: 'feature/auth',
          total: 5,
          completed: 2,
          percentage: 40
        },
        {
          branch: 'fix/bug-123',
          total: 3,
          completed: 3,
          percentage: 100
        }
      ];

      const display = formatBranchSummary(summaries);
      
      assert.ok(display.includes('🌳 Todo Summary Across Branches'));
      assert.ok(display.includes('⎿ main: 8/10 (80%)'));
      assert.ok(display.includes('⎿ feature/auth: 2/5 (40%)'));
      assert.ok(display.includes('⎿ fix/bug-123: 3/3 (100%)'));
      
      // Check progress bars
      assert.ok(display.includes('[████████■■]')); // 80% = 8 filled squares
      assert.ok(display.includes('[████□□□□□□]')); // 40% = 4 filled squares  
      assert.ok(display.includes('[■■■■■■■■■■]')); // 100% = 10 filled squares
    });

    it('should handle empty summaries', () => {
      const display = formatBranchSummary([]);
      
      assert.ok(display.includes('🌳 Todo Summary Across Branches'));
      assert.ok(display.includes('⎿ No todos found in any branch'));
    });

    it('should handle zero percentage correctly', () => {
      const summaries = [
        {
          branch: 'new-branch',
          total: 5,
          completed: 0,
          percentage: 0
        }
      ];

      const display = formatBranchSummary(summaries);
      
      assert.ok(display.includes('⎿ new-branch: 0/5 (0%)'));
      assert.ok(display.includes('[□□□□□□□□□□]')); // All empty squares
    });

    it('should handle single branch', () => {
      const summaries = [
        {
          branch: 'solo-branch',
          total: 2,
          completed: 1,
          percentage: 50
        }
      ];

      const display = formatBranchSummary(summaries);
      
      assert.ok(display.includes('⎿ solo-branch: 1/2 (50%)'));
      assert.ok(display.includes('[■■■■■□□□□□]')); // 50% = 5 filled squares
    });

    it('should handle branch names with special characters', () => {
      const summaries = [
        {
          branch: 'feature/user-auth#123',
          total: 1,
          completed: 0,
          percentage: 0
        }
      ];

      const display = formatBranchSummary(summaries);
      
      assert.ok(display.includes('⎿ feature/user-auth#123: 0/1 (0%)'));
    });
  });

  describe('Edge Cases', () => {
    it('should handle malformed plan text gracefully', () => {
      const malformedPlan = `Not a numbered list
      
      Random text here
      
      Complexity: not-a-number
      
      \`\`\`
      Incomplete code block`;

      const todos = formatPlanAsTodos(malformedPlan);
      
      // Should still create todos from parseable sections
      assert.ok(Array.isArray(todos));
    });

    it('should handle undefined values in todos', () => {
      const todosWithUndefined = [
        {
          id: '1',
          title: 'Valid todo',
          isComplete: false,
          complexity: undefined
        }
      ];

      const display = formatTodosForDisplay(todosWithUndefined, 'main');
      
      assert.ok(display.includes('☐ Valid todo'));
      assert.ok(!display.includes('undefined'));
    });

    it('should handle very large complexity numbers', () => {
      const todos = [
        {
          id: '1',
          title: 'Complex task',
          complexity: 9999,
          isComplete: false
        }
      ];

      const display = formatTodosForDisplay(todos, 'main');
      
      assert.ok(display.includes('☐ Complex task (Complexity: 9999)'));
    });

    it('should handle very long branch names', () => {
      const longBranchName = 'feature/very-long-branch-name-that-exceeds-normal-length';
      const display = formatTodosForDisplay([], longBranchName);
      
      assert.ok(display.includes(`⏺ Current Todos (branch: ${longBranchName})`));
    });
  });
});
