import * as fs from 'fs';
import * as path from 'path';
import { ALL_QUEUE_NAMES } from './queue-registry';

const API_SRC_DIR = path.resolve(__dirname, '..');
const REGISTRY_FILE = path.resolve(__dirname, 'queue-registry.ts');

const REGISTER_QUEUE_REGEX =
  /BullModule\.registerQueue\(\s*\{\s*name:\s*([A-Z_][A-Z0-9_]*|'[^']+'|"[^"]+")[\s,}]/g;

function collectTsFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTsFiles(full));
    } else if (
      entry.isFile() &&
      entry.name.endsWith('.ts') &&
      !entry.name.endsWith('.spec.ts') &&
      !entry.name.endsWith('.integration.spec.ts') &&
      full !== REGISTRY_FILE
    ) {
      files.push(full);
    }
  }
  return files;
}

function collectCallsiteIdentifiers(): Set<string> {
  const identifiers = new Set<string>();
  for (const file of collectTsFiles(API_SRC_DIR)) {
    const contents = stripComments(fs.readFileSync(file, 'utf8'));
    let match: RegExpExecArray | null;
    REGISTER_QUEUE_REGEX.lastIndex = 0;
    while ((match = REGISTER_QUEUE_REGEX.exec(contents)) !== null) {
      identifiers.add(match[1]);
    }
  }
  return identifiers;
}

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function collectRegistryImportedIdentifiers(): Set<string> {
  const contents = stripComments(fs.readFileSync(REGISTRY_FILE, 'utf8'));
  const identifiers = new Set<string>();
  const importRegex =
    /import\s*\{\s*([A-Z_][A-Z0-9_]*)\s*\}\s*from\s*['"][^'"]+['"]/g;
  let match: RegExpExecArray | null;
  while ((match = importRegex.exec(contents)) !== null) {
    identifiers.add(match[1]);
  }
  return identifiers;
}

describe('queue-registry parity', () => {
  it('enumerates exactly the registered queues', () => {
    const callsiteIdentifiers = collectCallsiteIdentifiers();
    const registryImportedIdentifiers = collectRegistryImportedIdentifiers();

    expect(callsiteIdentifiers.size).toBeGreaterThan(0);
    expect([...callsiteIdentifiers].sort()).toEqual(
      [...registryImportedIdentifiers].sort(),
    );
  });

  it('contains no duplicates', () => {
    expect(new Set(ALL_QUEUE_NAMES).size).toBe(ALL_QUEUE_NAMES.length);
  });
});
