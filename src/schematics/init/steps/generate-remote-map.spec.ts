import { generateRemoteMap } from './generate-remote-map.js';

function app(port?: number) {
  return {
    projectType: 'application',
    architect: { build: {}, serve: { options: port ? { port } : {} } },
  };
}

describe('generateRemoteMap', () => {
  // The init template writes `name: '<project>'` into the remote's federation config, so a
  // camelized key (`wcRemote`) would never match the remote's registered name `wc-remote`.
  it('keys each remote by its raw project name', () => {
    const workspace = {
      projects: { shell: app(4200), 'wc-remote': app(4201) },
    };

    expect(generateRemoteMap(workspace, 'shell')).toEqual({
      'wc-remote': 'http://localhost:4201/remoteEntry.json',
    });
  });

  it('prefers the original serve port once a sibling has been federated', () => {
    const remote = app(9999);
    Object.assign(remote.architect, { 'serve-original': { options: { port: 4201 } } });

    expect(
      generateRemoteMap({ projects: { shell: app(), mfe1: remote } }, 'shell'),
    ).toEqual({
      mfe1: 'http://localhost:4201/remoteEntry.json',
    });
  });

  it('skips libraries and the project itself', () => {
    const workspace = {
      projects: { shell: app(4200), lib: { ...app(), projectType: 'library' } },
    };

    expect(generateRemoteMap(workspace, 'shell')).toEqual({});
  });
});
