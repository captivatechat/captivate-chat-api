// Server mode on plain Node against the fixtures' replay (first-channels-library-spec §5, L7; the
// server key spec §3.1): one instance of the built library with a whole vbk_ key, two users at
// once, each with its own drafts and answers, every call naming its user and none carrying an
// Origin or a secret, and no handle kept. Run by npm run test:electron before Electron; exits 0
// only when every check passed.
const { startReplay, fixtureNames, expectedOf, differenceOf, draftsOf, ROOT } = require('./replay');
const { runAll } = require('./page');

// src/api/blue/words.ts's, exactly.
const NAME_THE_USER = 'On a server, name the user on every call: getConversation(id, userId).';
const USER_A = 'usr_Qm4v-Z7pK.a';
const USER_B = 'usr_Hx2w-T9rL.b';

async function main() {
  const fixtures = fixtureNames().map((name) => ({ name, count: expectedOf(name).filter((c) => c.listener !== 'onDelta').length }));
  console.log(`Node ${process.versions.node}, server mode: ${fixtures.length} fixtures for each of two users at once`);
  const replay = await startReplay();
  const { CaptivateChatAPI } = require(ROOT);
  const key = `vbk_${'f1'.padStart(24, '0')}_${'cd'.repeat(32)}`;
  const outcomes = [];
  const check = (name, problems) => {
    outcomes.push(problems.length === 0);
    console.log(`${problems.length ? 'FAIL' : 'ok  '} ${name}${problems.length ? `\n       ${problems.join('\n       ')}` : ''}`);
  };

  const api = await CaptivateChatAPI.create(key, 'prod', { blueUrl: replay.url });
  // B takes the fixtures the other way round, so the two users' answers stream side by side.
  const [a, b] = await Promise.all([runAll(api, fixtures, USER_A), runAll(api, [...fixtures].reverse(), USER_B)]);
  for (const [user, results] of [['A', a], ['B', b]]) {
    const problems = [];
    const drafts = draftsOf(results);
    if (drafts.got === 0) problems.push(`no drafts (${drafts.expected} in the fixtures)`);
    for (const { name } of fixtures) {
      const result = results[name];
      if (result.rejected) problems.push(`${name}: sendMessage rejected: ${result.rejected}`);
      const difference = differenceOf(name, result.calls);
      if (difference) problems.push(difference);
    }
    check(`user ${user}: its own drafts and answer for every fixture (drafts ${drafts.got} of ${drafts.expected})`, problems);
  }

  {
    const calls = replay.seen.filter((r) => r.path.startsWith('/v1/chat'));
    const problems = [];
    for (const [user, name] of [[USER_A, 'A'], [USER_B, 'B']]) {
      const sends = calls.filter((r) => r.path === '/v1/chat' && r.user === user).length;
      if (sends !== fixtures.length) problems.push(`user ${name}: ${sends} sends, expected ${fixtures.length}`);
    }
    if (calls.some((r) => r.user !== USER_A && r.user !== USER_B)) problems.push('a call named no user, or another');
    if (calls.some((r) => r.origin !== null)) problems.push('a call carried an Origin');
    if (calls.some((r) => r.secret)) problems.push('a call carried X-Blue-Conversation');
    check('every call names its user by X-Blue-User, with no Origin and no secret', problems);
  }

  {
    const problems = [];
    if (api.conversations.size !== 0) problems.push(`${api.conversations.size} handles kept`);
    try {
      await api.getConversation(fixtures[0] && b[fixtures[0].name].conversationId);
      problems.push('getConversation(id) without a user was taken');
    } catch (error) {
      if (error.message !== NAME_THE_USER) problems.push(`getConversation(id) refused in other words: ${error.message}`);
    }
    check('no handle kept, and getConversation(id) without a user refused in its words', problems);
  }

  api.dispose();
  await replay.close();
  const failed = outcomes.filter((ok) => !ok).length;
  console.log(`Node ${process.versions.node}, server mode: ${outcomes.length - failed} passed, ${failed} failed`);
  return failed === 0 ? 0 : 1;
}

main()
  .catch((error) => {
    console.log(`FAIL the run itself: ${(error && error.stack) || error}`);
    return 1;
  })
  .then((code) => process.exit(code));
