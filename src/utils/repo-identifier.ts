import { execSync } from 'child_process';

export function extractRepoIdentifier(gitRemoteUrl: string): string {
  // Convert various Git URL formats to canonical form
  // https://github.com/erauner/homelab-k8s.git → github.com/erauner/homelab-k8s
  // git@github.com:erauner/homelab-k8s.git → github.com/erauner/homelab-k8s
  // https://gitlab.com/group/subgroup/project → gitlab.com/group/subgroup/project

  const patterns = [
    /https?:\/\/([^\/]+)\/(.+?)(?:\.git)?$/,
    /git@([^:]+):(.+?)(?:\.git)?$/,
    /ssh:\/\/git@([^\/]+)\/(.+?)(?:\.git)?$/
  ];

  for (const pattern of patterns) {
    const match = gitRemoteUrl.match(pattern);
    if (match) {
      return `${match[1]}/${match[2]}`;
    }
  }

  throw new Error(`Unable to parse repository URL: ${gitRemoteUrl}`);
}

export async function detectRepositoryId(projectPath: string = process.cwd()): Promise<string> {
  try {
    // Try to get remote URL
    const remoteUrl = execSync('git remote get-url origin', {
      cwd: projectPath,
      encoding: 'utf-8'
    }).trim();

    return extractRepoIdentifier(remoteUrl);
  } catch {
    // Fallback to local path basename
    const path = await import('path');
    return path.basename(projectPath);
  }
}
export async function detectCurrentBranch(projectPath: string = process.cwd()): Promise<string> {
  try {
    const { execSync } = await import('child_process');
    const branch = execSync('git rev-parse --abbrev-ref HEAD', {
      cwd: projectPath,
      encoding: 'utf-8'
    }).trim();
    return branch || 'main';
  } catch {
    // Not a git repo or git not available
    return 'default';
  }
}
