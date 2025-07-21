export interface Todo {
  id: string;
  title: string;
  description: string;
  complexity: number;
  codeExample?: string;
  isComplete: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Goal {
  id: string;
  description: string;
  createdAt: string;
  repository?: string;
  branch?: string;
}

export interface ImplementationPlan {
  goalId: string;
  todos: Todo[];
  updatedAt: string;
}

export interface StorageData {
  branch: string;
  projectPath: string;
  goals: Record<string, Goal>;
  plans: Record<string, ImplementationPlan>;
  lastUpdated: string | null;
}

// New types for Redis session management
export interface RepositoryContext {
  // Primary identifiers
  repoIdentifier: string;  // e.g., "github.com/erauner/homelab-k8s"
  branch: string;          // e.g., "feature/add-redis"

  // Metadata for display/validation
  repoUrl?: string;        // Full clone URL
  repoName?: string;       // Short name for display
  localPath?: string;      // For backward compatibility
}

export interface SessionContext {
  userId: string;
  sessionId: string;
  repository: RepositoryContext;
  createdAt: string;
  lastAccessed: string;
}

export interface IStorage {
  initialize(): Promise<void>;
  save?(): Promise<void>; // Make save optional since it's private in Storage
  getTodos(goalId?: string): Promise<Todo[]>;
  addTodo(goalId: string, todo: Omit<Todo, 'id' | 'isComplete' | 'createdAt' | 'updatedAt'>): Promise<Todo>;
  updateTodo(id: string, updates: Partial<Todo>): Promise<void>;
  removeTodo(goalId: string, todoId: string): Promise<void>;
  setGoal(goal: Goal): Promise<void>;
  getGoal(id: string): Promise<Goal | null>;
  savePlan(plan: string): Promise<void>;
  getPlan(goalId: string): Promise<ImplementationPlan | null>;
  createGoal(description: string): Promise<Goal>;
  createPlan(goalId: string): Promise<ImplementationPlan>;
  updateTodoStatus(goalId: string, todoId: string, isComplete: boolean): Promise<Todo>;
  getGoals(): Promise<Record<string, Goal>>;
}
