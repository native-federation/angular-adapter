import { strings } from '@angular-devkit/core';

export function generateRemoteMap(workspace: any, projectName: string) {
  const result = {} as Record<string, string>;

  for (const p in workspace.projects) {
    const project = workspace.projects[p];
    const projectType = project.projectType ?? 'application';

    if (
      p !== projectName &&
      projectType === 'application' &&
      project?.architect?.serve &&
      project?.architect?.build
    ) {
      const pPort =
        project.architect['serve-original']?.options?.port ??
        project.architect.serve?.options?.port ??
        4200;
      result[strings.camelize(p)] = `http://localhost:${pPort}/remoteEntry.json`;
    }
  }

  if (Object.keys(result).length === 0) {
    result['mfe1'] = `http://localhost:3000/remoteEntry.json`;
  }

  return result;
}
