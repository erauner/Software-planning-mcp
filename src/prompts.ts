export const SEQUENTIAL_THINKING_PROMPT = `You are a senior software architect guiding the development of a software feature through a question-based sequential thinking process. Your role is to:

1. UNDERSTAND THE GOAL
- Start by thoroughly understanding the provided goal
- Break down complex requirements into manageable components
- Identify potential challenges and constraints

2. ASK STRATEGIC QUESTIONS
Ask focused questions about:
- System architecture and design patterns
- Technical requirements and constraints
- Integration points with existing systems
- Security considerations
- Performance requirements
- Scalability needs
- Data management and storage
- User experience requirements
- Testing strategy
- Deployment considerations

3. ANALYZE RESPONSES
- Process user responses to refine understanding
- Identify gaps in information
- Surface potential risks or challenges
- Consider alternative approaches
- Validate assumptions

4. DEVELOP THE PLAN
As understanding develops:
- Create detailed, actionable implementation steps
- Include complexity scores (0-10) for each task
- Provide code examples where helpful
- Consider dependencies between tasks
- Break down large tasks into smaller subtasks
- Include testing and validation steps
- Document architectural decisions

5. ITERATE AND REFINE
- Continue asking questions until all aspects are clear
- Refine the plan based on new information
- Adjust task breakdown and complexity scores
- Add implementation details as they emerge

6. COMPLETION
The process continues until the user indicates they are satisfied with the plan. The final plan should be:
- Comprehensive and actionable
- Well-structured and prioritized
- Clear in its technical requirements
- Specific in its implementation details
- Realistic in its complexity assessments

GUIDELINES:
- Ask one focused question at a time
- Maintain context from previous responses
- Be specific and technical in questions
- Consider both immediate and long-term implications
- Document key decisions and their rationale
- Include relevant code examples in task descriptions
- Consider security, performance, and maintainability
- Focus on practical, implementable solutions

Begin by analyzing the provided goal and asking your first strategic question.`;

export const formatPlanAsTodos = (plan: string): Array<{
  title: string;
  description: string;
  complexity: number;
  codeExample?: string;
}> => {
  if (!plan || plan.trim().length === 0) {
    return [];
  }

  // Split by numbered items (1., 2., 3., etc.)
  const sections = plan.split(/(?=\n?\d+\.\s)/);

  const todos = sections
    .filter(section => section.trim().length > 0 && /^\d+\.\s/.test(section.trim()))
    .map(section => {
      const lines = section.trim().split('\n');
      const title = lines[0].replace(/^[0-9]+\.\s*/, '').trim();
      const complexity = parseInt(section.match(/Complexity:\s*([0-9]+)/)?.[1] || '5');
      const codeExample = section.match(/\`\`\`[\s\S]*?\`\`\`/)?.[0];
      const description = section
        .replace(/^[0-9]+\.\s*[^\n]*\n?/, '')
        .replace(/Complexity:\s*[0-9]+/g, '')
        .replace(/\`\`\`[\s\S]*?\`\`\`/g, '')
        .trim();

      return {
        title,
        description,
        complexity,
        codeExample: codeExample?.replace(/^\`\`\`[a-zA-Z]*\n?|\`\`\`$/g, ''),
      };
    });

  return todos;
};

export function formatTodosForDisplay(todos: any[], branch: string): string {
  const completed = todos.filter(t => t.isComplete);
  const pending = todos.filter(t => !t.isComplete);

  let output = `⏺ Current Todos (branch: ${branch})\n\n`;

  if (pending.length > 0) {
    output += '  ⎿ Active Tasks:\n';
    pending.forEach(todo => {
      output += `     ☐ ${todo.title}`;
      if (todo.complexity !== undefined) {
        output += ` (Complexity: ${todo.complexity})`;
      }
      output += '\n';
    });
  }

  if (completed.length > 0) {
    output += '\n  ⎿ Completed:\n';
    completed.forEach(todo => {
      output += `     ☒ ${todo.title}\n`;
    });
  }

  if (todos.length === 0) {
    output += '  ⎿ No todos yet. Start adding tasks!\n';
  }

  return output;
}

export function formatBranchSummary(branchSummaries: any[]): string {
  let output = '🌳 Todo Summary Across Branches\n\n';

  if (branchSummaries.length === 0) {
    output += '  ⎿ No todos found in any branch\n';
    return output;
  }

  branchSummaries.forEach(summary => {
    const filledBlocks = Math.floor(summary.percentage / 10);
    const emptyBlocks = 10 - filledBlocks;
    const progressBar = '█'.repeat(filledBlocks) + '□'.repeat(emptyBlocks);

    output += `  ⎿ ${summary.branch}: ${summary.completed}/${summary.total} (${summary.percentage}%) [${progressBar}]\n`;
  });

  return output;
}
