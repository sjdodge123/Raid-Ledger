import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { users } from './users';

/** ROK-313: audit log of admin moderation actions (kick/ban/role-change). */
export const adminActions = pgTable(
  'admin_actions',
  {
    id: serial('id').primaryKey(),
    action: text('action', {
      enum: ['kick', 'unkick', 'ban', 'unban', 'role_change'],
    }).notNull(),
    actorId: integer('actor_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    targetId: integer('target_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    reason: text('reason'),
    metadata: text('metadata'), // JSON string: {"dataWiped":true,"discordKicked":true}
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [index('admin_actions_target_idx').on(t.targetId, t.createdAt)],
);
