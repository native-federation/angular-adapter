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

  // No sibling projects → emit an empty map for the user to fill in, rather than
  // injecting a surprising fake `mfe1` remote.
  return result;
}
