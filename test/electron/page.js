// Runs fixtures through the built library and keeps every call an app's listeners get, as
// test/blue/answers.ts's record does: in the harness page (a renderer, given its task by the
// preload and reporting over IPC) and, through require, in Electron's main process and the plain
// Node run of server mode.
(function (root) {
  const LISTENERS = ['onStep', 'onDelta', 'onMessage', 'onActionReceived', 'onAnswer', 'onConversationUpdate', 'onError'];
  /** How long a fixture's calls may take to come, and the quiet after them that shows no more come. */
  const FIXTURE_MS = 15000;
  const QUIET_MS = 300;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function record(conversation) {
    const calls = [];
    for (const listener of LISTENERS) {
      conversation[listener]((...args) => calls.push({ listener, args: JSON.parse(JSON.stringify(args)) }));
    }
    return calls;
  }

  /**
   * One fixture: a conversation started for it (the replay reads its name from the metadata), its
   * name sent as the message, and the calls once `count` besides drafts have come and nothing more
   * follows (a network may bring two lines in one chunk, giving one draft for both).
   */
  async function runFixture(api, fixture, userId) {
    const conversation = await api.createConversation(userId, {}, { fixture: fixture.name }, 'user-first');
    const calls = record(conversation);
    let rejected = null;
    try {
      await conversation.sendMessage(fixture.name);
    } catch (error) {
      rejected = String((error && error.message) || error);
    }
    const until = Date.now() + FIXTURE_MS;
    while (calls.filter((c) => c.listener !== 'onDelta').length < fixture.count && Date.now() < until) await sleep(20);
    await sleep(QUIET_MS);
    return { calls, rejected, conversationId: conversation.getConversationId() };
  }

  /** Each fixture in turn, by name. */
  async function runAll(api, fixtures, userId) {
    const results = {};
    for (const fixture of fixtures) results[fixture.name] = await runFixture(api, fixture, userId);
    return results;
  }

  const exported = { LISTENERS, record, runFixture, runAll };
  if (typeof module === 'object' && module.exports) {
    module.exports = exported;
    return;
  }

  // In the harness page: the task from the preload, the report back over IPC.
  const harness = root.harness;
  if (!harness) return;
  const crashes = [];
  root.addEventListener('error', (event) => crashes.push(String(event.message)));
  root.addEventListener('unhandledrejection', (event) => crashes.push(String((event.reason && event.reason.message) || event.reason)));
  (async () => {
    const task = await harness.task();
    const report = { check: task.check, origin: root.location.origin, protocol: root.location.protocol, results: {}, crashes };
    try {
      const api = await root.CaptivateChatAPI.create(task.key, 'prod', { blueUrl: task.blueUrl });
      report.results = await runAll(api, task.fixtures, 'harness-user');
      api.dispose();
    } catch (error) {
      crashes.push(String((error && error.message) || error));
    }
    report.warnings = root.__warnings || [];
    harness.report(report);
  })();
})(typeof globalThis !== 'undefined' ? globalThis : this);
