import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';

// Resolve from the requesting workspace: dependencies may be hoisted or nested.
export function toolPath(workspace: string, name: string, entry: string) {
  const require = createRequire(resolve(workspace, 'package.json'));
  return resolve(dirname(require.resolve(`${name}/package.json`)), entry);
}
