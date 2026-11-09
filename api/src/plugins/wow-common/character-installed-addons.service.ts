import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { CharacterInstalledAddonsResponse } from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import {
  GuildAccessService,
  type GuildActor,
} from '../../guilds/guild-access.service';
import { isHiddenFrom } from '../../guilds/hub-hidden.helpers';
import { loadInstalledAddons } from './addon-import/addon-import-char.installed';
import { toInstalledAddonsView } from './addon-import/addon-import-char.installed.helpers';
import { findCharacterGuild } from './guilds/guild-queries.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/** D6: what everyone but the owner and the guild's officers gets. */
const NOT_VISIBLE: CharacterInstalledAddonsResponse = {
  visible: false,
  installed: null,
};

/**
 * ROK-2147 §5 — the addon folders a character's LedgerLink export reported.
 * Visible to the character's owner and to officers (`canEdit`, staff
 * included) of the guild the character is in now, unless that hub is hidden
 * from them. Everyone else — and an unknown character — gets
 * `{ visible: false, installed: null }` without the table being read, so the
 * answer never says whether a list exists.
 */
@Injectable()
export class CharacterInstalledAddonsService {
  constructor(
    @Inject(DrizzleAsyncProvider) private readonly db: Db,
    private readonly access: GuildAccessService,
  ) {}

  async getForCharacter(
    actor: GuildActor,
    characterId: string,
  ): Promise<CharacterInstalledAddonsResponse> {
    if (!(await this.canSee(actor, characterId))) return NOT_VISIBLE;
    const row = await loadInstalledAddons(this.db, characterId);
    return {
      visible: true,
      installed: row ? toInstalledAddonsView(row) : null,
    };
  }

  private async canSee(
    actor: GuildActor,
    characterId: string,
  ): Promise<boolean> {
    const [owner] = await this.db
      .select({ userId: schema.characters.userId })
      .from(schema.characters)
      .where(eq(schema.characters.id, characterId))
      .limit(1);
    if (!owner) return false;
    if (owner.userId === actor.id) return true;
    const found = await findCharacterGuild(this.db, characterId);
    if (!found) return false;
    const guildId = found.guild.id;
    if (await isHiddenFrom(this.db, actor, guildId)) return false;
    return this.access.canEdit(actor, guildId);
  }
}
