/** Descriptor for a known .env file in the project. */
export interface EnvFileEntry {
  relativePath: string;
  examplePath: string;
  description: string;
  requiredVars: string[];
}

/** Hardcoded registry of all known .env files in the project. */
export const ENV_FILES: EnvFileEntry[] = [
  {
    relativePath: '.env',
    examplePath: '.env.example',
    description: 'Root env: database, Discord OAuth, JWT, client URL',
    requiredVars: [
      'DATABASE_URL',
      'DISCORD_CLIENT_ID',
      'DISCORD_CLIENT_SECRET',
      'DISCORD_CALLBACK_URL',
      'JWT_SECRET',
      'CLIENT_URL',
    ],
  },
  {
    relativePath: 'api/.env',
    examplePath: 'api/.env.example',
    description: 'API env: read by NestJS ConfigModule',
    requiredVars: [
      'DATABASE_URL',
      'DISCORD_CLIENT_ID',
      'DISCORD_CLIENT_SECRET',
      'DISCORD_CALLBACK_URL',
      'JWT_SECRET',
      'CLIENT_URL',
    ],
  },
  {
    relativePath: 'tools/test-bot/.env',
    examplePath: 'tools/test-bot/.env.example',
    description: 'Discord test bot: token and guild/channel IDs',
    requiredVars: ['TEST_BOT_TOKEN', 'TEST_GUILD_ID'],
  },
  {
    relativePath: 'tools/mcp-discord/.env',
    examplePath: 'tools/mcp-discord/.env.example',
    description: 'MCP Discord: CDP port and mode (all optional)',
    requiredVars: [],
  },
];

/**
 * Extract variable names from .env file content.
 * Handles optional `export` prefix. Returns only names, never values.
 */
export function parseVarNames(content: string): string[] {
  const regex = /^(?:export\s+)?([A-Z_][A-Z0-9_]*)=/gm;
  const names: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    names.push(match[1]);
  }
  return names;
}
