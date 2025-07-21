import { execSync } from "child_process";
import { promises as fs } from "fs";
import path from "path";
import { Goal, ImplementationPlan, IStorage, StorageData, Todo } from "./types.js";

export class Storage implements IStorage {
  private storagePath: string;
  private data: StorageData;
  private projectPath: string;
  private currentBranch: string;

  constructor(projectPath?: string, overrideBranch?: string) {
    this.projectPath = projectPath || process.cwd();
    this.currentBranch = overrideBranch || this.getCurrentGitBranch();

    const dataDir = path.join(this.projectPath, ".planning");
    const safeBranch = this.sanitizeBranchName(this.currentBranch);
    this.storagePath = path.join(dataDir, `${safeBranch}.todos.json`);

    // Update data structure
    this.data = {
      branch: this.currentBranch,
      projectPath: this.projectPath,
      goals: {},
      plans: {},
      lastUpdated: null,
    };
  }

  private getCurrentGitBranch(): string {
    try {
      const branch = execSync("git rev-parse --abbrev-ref HEAD", {
        cwd: this.projectPath,
        encoding: "utf-8",
      }).trim();
      return branch || "main";
    } catch (error) {
      // Not a git repo or git not available
      console.error("Not a git repository, using default branch name");
      return "default";
    }
  }

  private sanitizeBranchName(branch: string): string {
    // Replace problematic characters for filenames
    // feature/auth-system -> feature-auth-system
    // fix/bug#123 -> fix-bug-123
    return branch.replace(/[^a-zA-Z0-9-_]/g, "-");
  }

  getCurrentBranch(): string {
    return this.currentBranch;
  }

  getProjectPath(): string {
    return this.projectPath;
  }

  getTodoCount(): number {
    return Object.values(this.data.plans).reduce(
      (count, plan) => count + plan.todos.length,
      0
    );
  }

  async getAllTodos(): Promise<Todo[]> {
    return Object.values(this.data.plans).flatMap((plan) => plan.todos);
  }

  async getGoals(): Promise<Record<string, Goal>> {
    return this.data.goals;
  }

  async initialize(): Promise<void> {
    try {
      const dataDir = path.dirname(this.storagePath);
      await fs.mkdir(dataDir, { recursive: true });

      // Try to read existing data for this branch
      const data = await fs.readFile(this.storagePath, "utf-8");
      this.data = JSON.parse(data);

      console.error(`Loaded existing todos from ${this.storagePath}`);
      console.error(`Branch: ${this.data.branch}, Todos: ${this.getTodoCount()}`);
    } catch (error) {
      // First time - create new file
      console.error(`Creating new todo file for branch: ${this.currentBranch}`);
      this.data.lastUpdated = new Date().toISOString();
      await this.save();
    }
  }

  async save(): Promise<void> {
    this.data.lastUpdated = new Date().toISOString();
    await fs.writeFile(this.storagePath, JSON.stringify(this.data, null, 2));
  }

  async createGoal(description: string): Promise<Goal> {
    const goal: Goal = {
      id: Date.now().toString(),
      description,
      createdAt: new Date().toISOString(),
    };

    this.data.goals[goal.id] = goal;
    await this.save();
    return goal;
  }

  async getGoal(id: string): Promise<Goal | null> {
    return this.data.goals[id] || null;
  }

  async createPlan(goalId: string): Promise<ImplementationPlan> {
    const plan: ImplementationPlan = {
      goalId,
      todos: [],
      updatedAt: new Date().toISOString(),
    };

    this.data.plans[goalId] = plan;
    await this.save();
    return plan;
  }

  async getPlan(goalId: string): Promise<ImplementationPlan | null> {
    return this.data.plans[goalId] || null;
  }

  async addTodo(
    goalId: string,
    {
      title,
      description,
      complexity,
      codeExample,
    }: Omit<Todo, "id" | "isComplete" | "createdAt" | "updatedAt">
  ): Promise<Todo> {
    const plan = await this.getPlan(goalId);
    if (!plan) {
      throw new Error(`No plan found for goal ${goalId}`);
    }

    const todo: Todo = {
      id: Date.now().toString(),
      title,
      description,
      complexity,
      codeExample,
      isComplete: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    plan.todos.push(todo);
    plan.updatedAt = new Date().toISOString();
    await this.save();
    return todo;
  }

  async removeTodo(goalId: string, todoId: string): Promise<void> {
    const plan = await this.getPlan(goalId);
    if (!plan) {
      throw new Error(`No plan found for goal ${goalId}`);
    }

    plan.todos = plan.todos.filter((todo: Todo) => todo.id !== todoId);
    plan.updatedAt = new Date().toISOString();
    await this.save();
  }

  async updateTodoStatus(
    goalId: string,
    todoId: string,
    isComplete: boolean
  ): Promise<Todo> {
    const plan = await this.getPlan(goalId);
    if (!plan) {
      throw new Error(`No plan found for goal ${goalId}`);
    }

    const todo = plan.todos.find((t: Todo) => t.id === todoId);
    if (!todo) {
      throw new Error(`No todo found with id ${todoId}`);
    }

    todo.isComplete = isComplete;
    todo.updatedAt = new Date().toISOString();
    plan.updatedAt = new Date().toISOString();
    await this.save();
    return todo;
  }

  async getTodos(goalId?: string): Promise<Todo[]> {
    if (goalId) {
      const plan = await this.getPlan(goalId);
      return plan?.todos || [];
    }

    return Object.values(this.data.plans).flatMap((plan) => plan.todos);
  }

  async updateTodo(id: string, updates: Partial<Todo>): Promise<void> {
    // Find todo across all plans and update it
    for (const plan of Object.values(this.data.plans)) {
      const todoIndex = plan.todos.findIndex(todo => todo.id === id);
      if (todoIndex !== -1) {
        plan.todos[todoIndex] = {
          ...plan.todos[todoIndex],
          ...updates,
          updatedAt: new Date().toISOString(),
        };
        plan.updatedAt = new Date().toISOString();
        await this.save();
        return;
      }
    }
    throw new Error(`Todo with id ${id} not found`);
  }

  async setGoal(goal: Goal): Promise<void> {
    this.data.goals[goal.id] = goal;
    await this.save();
  }

  async savePlan(plan: string): Promise<void> {
    // Convert plan text to todos - simplified implementation
    const lines = plan.split('\n').filter(line => line.trim());

    // Find or create a goal
    const goalIds = Object.keys(this.data.goals);
    const goalId = goalIds[0] || Date.now().toString();

    if (goalIds.length === 0) {
      await this.createGoal("Plan from text");
    }

    // Create todos from plan text
    for (const line of lines) {
      await this.addTodo(goalId, {
        title: `Step`,
        description: line.trim(),
        complexity: 3,
      });
    }
  }
}
