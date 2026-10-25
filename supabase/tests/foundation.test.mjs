import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { PGlite } from '../../.research/supabase-validation/node_modules/@electric-sql/pglite/dist/index.js';

const ids = [1, 2, 3, 4, 5].map(n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`);
const [alice, bob, outsider] = ids;

test('account foundation uses PostgreSQL grants and RLS to enforce ownership', async t => {
  const db = await PGlite.create();
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role bypassrls;
      create schema auth;
      create table auth.users (id uuid primary key, raw_user_meta_data jsonb);
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;
      grant usage on schema public, auth to anon, authenticated, service_role;
      grant execute on function auth.uid() to anon, authenticated, service_role;
    `);
    // A preexisting auth account exercises the migration's backfill path.
    await db.query('insert into auth.users values ($1, $2)', [alice, { full_name: ' Alice ' }]);
    await db.exec(await readFile(new URL('../migrations/20261021000000_account_friends_foundation.sql', import.meta.url), 'utf8'));

    async function as(user, sql, params = [], role = 'authenticated') {
      await db.exec(`set role ${role}`);
      try {
        await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user ?? '']);
        return await db.query(sql, params);
      } finally {
        await db.exec('reset role');
      }
    }
    const relation = () => as(alice, 'select * from public.friendships');

    await t.test('existing and new accounts initialize with sanitized names and no rating', async () => {
      for (const [id, metadata] of [
        [bob, { full_name: '\n Bob\t ' }],
        [outsider, { global_name: '  \n\t ' }],
        [ids[3], { full_name: 'X'.repeat(100) }],
        [ids[4], null],
      ]) await db.query('insert into auth.users values ($1, $2)', [id, metadata]);
      const profiles = (await as(alice, 'select display_name from public.profiles order by id')).rows;
      assert.deepEqual(profiles.map(p => p.display_name), ['Alice', 'Bob', 'Player', 'X'.repeat(32), 'Player']);
      const ratings = (await as(alice, 'select * from public.player_ratings')).rows;
      assert.equal(ratings.length, 5);
      assert.ok(ratings.every(r => r.rating === null && r.rated_matches === 0));
    });

    await t.test('anonymous requests cannot read account or friendship data', async () => {
      for (const table of ['profiles', 'player_ratings', 'friendships']) {
        await assert.rejects(as(null, `select * from public.${table}`, [], 'anon'), /permission denied/);
      }
    });

    await t.test('profile edits are self-only and limited to valid display names', async () => {
      assert.equal((await as(alice, 'update public.profiles set display_name=$1 where id=$2 returning id', ['Kiki', alice])).rows.length, 1);
      assert.equal((await as(bob, 'update public.profiles set display_name=$1 where id=$2 returning id', ['Impersonation', alice])).rows.length, 0);
      await assert.rejects(as(alice, 'update public.profiles set id=$1 where id=$2', [ids[4], alice]), /permission denied/);
      for (const name of ['', ' leading', 'trailing ', 'x\ny', 'X'.repeat(33)]) {
        await assert.rejects(as(alice, 'update public.profiles set display_name=$1 where id=$2', [name, alice]), /check constraint/);
      }
      await assert.rejects(as(alice, 'delete from public.profiles where id=$1', [alice]), /permission denied/);
    });

    await t.test('ratings and signup initialization cannot be written by clients', async () => {
      await assert.rejects(as(alice, 'update public.player_ratings set rating=9999 where player_id=$1', [alice]), /permission denied/);
      await assert.rejects(as(alice, 'insert into public.player_ratings(player_id,rating) values ($1,9999)', [alice]), /permission denied/);
      await assert.rejects(as(alice, 'delete from public.player_ratings'), /permission denied/);
      await assert.rejects(as(alice, 'select public.create_polycup_account()'), /permission denied/);
    });

    await t.test('friend requests cannot forge a sender, self-request, or start accepted', async () => {
      await assert.rejects(as(alice, 'insert into public.friendships(requester_id,addressee_id) values ($1,$2)', [bob, outsider]), /row-level security/);
      await assert.rejects(as(alice, 'insert into public.friendships(requester_id,addressee_id) values ($1,$1)', [alice]), /check constraint/);
      await assert.rejects(as(alice, "insert into public.friendships(requester_id,addressee_id,status) values ($1,$2,'accepted')", [alice, bob]), /permission denied/);
      await as(alice, 'insert into public.friendships(requester_id,addressee_id) values ($1,$2)', [alice, bob]);
      assert.equal((await relation()).rows[0].status, 'pending');
    });

    await t.test('reverse and duplicate requests cannot create a second relationship', async () => {
      await assert.rejects(as(bob, 'insert into public.friendships(requester_id,addressee_id) values ($1,$2)', [bob, alice]), /unique constraint/);
      await assert.rejects(as(alice, 'insert into public.friendships(requester_id,addressee_id) values ($1,$2)', [alice, bob]), /unique constraint/);
    });

    await t.test('outsiders cannot see, accept, or delete a relationship', async () => {
      assert.equal((await as(outsider, 'select * from public.friendships')).rows.length, 0);
      assert.equal((await as(outsider, "update public.friendships set status='accepted' returning id")).rows.length, 0);
      assert.equal((await as(outsider, 'delete from public.friendships returning id')).rows.length, 0);
      assert.equal((await relation()).rows[0].status, 'pending');
    });

    await t.test('only the recipient can accept and cannot replace the participants', async () => {
      assert.equal((await as(alice, "update public.friendships set status='accepted' returning id")).rows.length, 0);
      await assert.rejects(as(bob, 'update public.friendships set requester_id=$1', [outsider]), /permission denied/);
      await assert.rejects(as(bob, "update public.friendships set status='pending'"), /row-level security/);
      assert.equal((await as(bob, "update public.friendships set status='accepted' returning id")).rows.length, 1);
      assert.equal((await relation()).rows[0].status, 'accepted');
      assert.equal((await as(bob, "update public.friendships set status='pending' returning id")).rows.length, 0);
    });

    await t.test('participants can unfriend, cancel, and decline', async () => {
      assert.equal((await as(alice, 'delete from public.friendships returning id')).rows.length, 1);
      for (const deletingUser of [alice, bob]) {
        await as(alice, 'insert into public.friendships(requester_id,addressee_id) values ($1,$2)', [alice, bob]);
        assert.equal((await as(deletingUser, 'delete from public.friendships returning id')).rows.length, 1);
      }
    });

    await t.test('administrative auth-account deletion cascades through owned records', async () => {
      await as(alice, 'insert into public.friendships(requester_id,addressee_id) values ($1,$2)', [alice, bob]);
      await db.query('delete from auth.users where id=$1', [bob]);
      for (const [table, column] of [['profiles', 'id'], ['player_ratings', 'player_id']]) {
        assert.equal((await db.query(`select * from public.${table} where ${column}=$1`, [bob])).rows.length, 0);
      }
      assert.equal((await relation()).rows.length, 0);
      assert.equal((await db.query('select * from public.profiles')).rows.length, 4);
    });
  } finally {
    await db.close();
  }
});
