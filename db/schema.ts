import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
export const players=sqliteTable('players',{
 id:text('id').primaryKey(),name:text('name').notNull(),state:text('state').notNull(),
 revision:integer('revision').notNull().default(0),best:integer('best').notNull().default(1),
 prestiges:integer('prestiges').notNull().default(0),updated:integer('updated').notNull()
},t=>[index('idx_players_best').on(t.best)]);
