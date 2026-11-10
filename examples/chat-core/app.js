// A web chat with a Captivate bot through captivate-chat-api's core path (a key for Captivate's gateway).
// Messages go out over HTTPS and replies come back on one WebSocket. It shows replies, their sources, the bot's
// actions as quick replies, Stop, a socket dropped and recovered, and the user's conversations. See README.md.
(async function () {
  const ui = window.ExampleUI;
  const { $ } = ui;
  const { CaptivateChatAPI, isBlueKey } = window;
  const { key, mode } = window.EXAMPLE_CONFIG;

  const userBox = $('userId');
  let userId = '';
  try { userId = localStorage.getItem('example-core-user') || ''; } catch (_) { /* storage blocked */ }
  if (!userId) userId = `example-user-${Math.random().toString(36).slice(2, 8)}`;
  userBox.value = userId;
  const keepUser = () => { try { localStorage.setItem('example-core-user', userId); } catch (_) { /* storage blocked */ } };
  keepUser();
  userBox.onchange = () => { userId = userBox.value.trim() || userId; keepUser(); refreshList(); };

  if (isBlueKey(key)) {
    ui.status('<b class="bad">This is one of Blue\'s keys: use examples/chat-blue with it. This page needs a Captivate core key.</b>');
    return;
  }

  let api;
  try {
    api = await CaptivateChatAPI.create(key, mode);
  } catch (err) {
    ui.status(`<b class="bad">Couldn't connect: ${ui.esc(err.message)}</b>`);
    return;
  }
  ui.log('Connected to Captivate\'s gateway', 'ok');

  // The socket's state, shown all the time, so a drop and its recovery can be watched.
  const shortId = (id) => (id ? `…${id.slice(-4)}` : 'none');
  function showSocket() {
    const active = api.isSocketActive();
    ui.status(`${active ? '<b class="ok">Socket open</b>' : '<b class="bad">Socket closed</b>'} · core (${ui.esc(mode)}) · socket id ${ui.esc(shortId(api.getSocketId()))}`);
  }
  showSocket();
  setInterval(showSocket, 1000);

  let current = null;
  let typingLine = null;
  let waitingSince = 0;
  let test = null;
  const listened = new Set();
  const endTyping = () => { if (typingLine) { typingLine.remove(); typingLine = null; } };

  // Core's bots name their sources in the text, "(Source: guide.pdf)". They become [n] markers and a list.
  function withSources(text) {
    const titles = [];
    const body = text.replace(/\s*\((?:Sources?):\s*([^)]+)\)/gi, (_, names) => {
      const marks = names.split(/\s*[,;]\s*/).filter(Boolean).map((name) => {
        let n = titles.indexOf(name) + 1;
        if (!n) { titles.push(name); n = titles.length; }
        return `[${n}]`;
      });
      return ` ${marks.join('')}`;
    });
    return { body, sources: titles.map((title, i) => ({ number: i + 1, title })) };
  }

  // A reply is a list of parts, [{ type: 'text', text }], or a string for an error.
  function partsOf(content) {
    if (typeof content === 'string') return { text: content, choices: [], other: [] };
    const list = Array.isArray(content) ? content : [content];
    const text = [];
    const choices = [];
    const other = [];
    for (const part of list) {
      if (!part || typeof part !== 'object') continue;
      if (part.type === 'text' && typeof part.text === 'string') { text.push(part.text); continue; }
      const options = part.buttons || part.options || part.quick_replies || part.choices;
      if (Array.isArray(options)) {
        for (const o of options) choices.push(typeof o === 'string' ? o : (o.title || o.label || o.text || o.value || ''));
        if (part.text) text.push(part.text);
        continue;
      }
      other.push(part.type || 'part');
    }
    return { text: text.join('\n\n'), choices: choices.filter(Boolean), other };
  }

  function showReply(content, type) {
    endTyping();
    const { text, choices, other } = partsOf(content);
    if (type === 'error') { ui.bubble('bot', text, 'error'); return; }
    const { body, sources } = withSources(text);
    const el = ui.bubble('bot', body || '(no words)');
    ui.sources(el, sources);
    ui.choices(choices, (choice) => send(choice));
    if (other.length) ui.note(`The reply also had: ${other.join(', ')}`);
    return { sources: sources.length, choices: choices.length };
  }

  function listen(conversation) {
    if (listened.has(conversation)) return;
    listened.add(conversation);
    conversation.onMessage((content, type) => {
      const shown = showReply(content, type) || { sources: 0, choices: 0 };
      const after = waitingSince ? ` after ${((Date.now() - waitingSince) / 1000).toFixed(1)} s` : '';
      waitingSince = 0;
      ui.log(`onMessage (${type})${after}: ${shown.sources} sources, ${shown.choices} quick replies`, type === 'error' ? 'bad' : 'ok');
      if (test && test.sentAt) finishTest();
    });
    conversation.onActionReceived((actions) => {
      ui.log(`onActionReceived: ${actions.length} action(s)`);
      const labels = [];
      for (const a of actions) {
        const options = a && a.data && (a.data.buttons || a.data.options || a.data.choices);
        if (Array.isArray(options)) for (const o of options) labels.push(typeof o === 'string' ? o : (o.title || o.label || o.text || ''));
      }
      if (labels.length) ui.choices(labels.filter(Boolean), (choice) => send(choice));
      else ui.note(`The bot sent an action: ${actions.map((a) => a && a.id).join(', ')}`);
    });
    conversation.onConversationUpdate((update) => ui.log(`Update: ${JSON.stringify(update).slice(0, 120)}`));
    conversation.onError((error) => ui.log(`onError: ${error && (error.errorDesc || error.message || JSON.stringify(error))}`, 'bad'));
  }

  // Every conversation on one socket hears every reply (the gateway's replies don't say whose they are), so only
  // the open conversation listens. See "Known limits" in the library's README.
  function quiet(conversation) {
    if (!conversation || !listened.has(conversation)) return;
    conversation.removeAllListeners();
    listened.delete(conversation);
  }

  function enable() {
    for (const id of ['text', 'sendBtn', 'stopBtn', 'reconnectBtn']) $(id).disabled = !current;
  }

  async function send(text) {
    if (!current || !text.trim()) return;
    ui.bubble('you', text);
    endTyping();
    typingLine = ui.typing('');
    waitingSince = Date.now();
    try {
      await current.sendMessage(text);
      ui.log('Message sent (HTTP); waiting for the reply on the socket');
    } catch (err) {
      endTyping();
      ui.bubble('bot', 'The message didn\'t go through. Send it again.', 'error');
      ui.log(`sendMessage failed: ${err.status ? `status ${err.status}: ` : ''}${err.message}`, 'bad');
    }
  }

  // A transcript entry: { from, messages }, where a bot's messages are { messages: parts } and a user's are parts.
  function transcriptText(entry) {
    const m = entry.messages;
    const parts = Array.isArray(m) ? m : (m && Array.isArray(m.messages) ? m.messages : []);
    return partsOf(parts).text;
  }

  async function open(conversation, title) {
    quiet(current);
    current = conversation;
    endTyping();
    listen(conversation);
    ui.clearMessages();
    $('convTitle').textContent = title || 'Conversation';
    enable();
    try {
      const transcript = await conversation.getTranscript();
      for (const entry of transcript) {
        const text = transcriptText(entry);
        if (!text) continue;
        if (entry.from === 'user') ui.bubble('you', text);
        else { const { body, sources } = withSources(text); ui.sources(ui.bubble('bot', body), sources); }
      }
      ui.log(`Opened a conversation: ${transcript.length} messages read back`);
    } catch (err) {
      ui.log(`getTranscript: ${err.message}`, 'bad');
    }
    refreshList();
  }

  function titleOf(c) {
    const md = c.metadata || {};
    const ch = md.channelMetadata || {};
    const custom = ch.custom || md.custom || {};
    const id = c.getConversationId();
    return {
      title: (custom.conversation_title && custom.conversation_title !== 'Untitled Chat' ? custom.conversation_title : '') || `Conversation …${id.slice(-6)}`,
      detail: ch.conversationUpdatedAt ? new Date(ch.conversationUpdatedAt).toLocaleString() : '',
    };
  }

  async function refreshList() {
    try {
      const { conversations } = await api.getUserConversations({ userId, pagination: { page: 1, limit: 20 } });
      const items = conversations.map((c) => ({ id: c.getConversationId(), ...titleOf(c) }));
      ui.conversationList(items, current && current.getConversationId(), (id) => {
        const c = conversations.find((x) => x.getConversationId() === id);
        open(c, items.find((i) => i.id === id).title);
      });
      ui.log(`getUserConversations: ${items.length}`);
    } catch (err) {
      ui.log(`getUserConversations: ${err.message}`, 'bad');
    }
  }

  async function finishTest() {
    const t = test;
    test = null;
    ui.log(`Test: recovered: a reply came on the new socket ${((Date.now() - t.sentAt) / 1000).toFixed(1)} s after sending`, 'ok');
    ui.note('Recovered: the conversation follows the new socket and its replies arrive.');
  }

  $('newBtn').onclick = async () => {
    $('newBtn').disabled = true;
    try {
      quiet(current);
      waitingSince = Date.now();
      const conversation = await api.createConversation(userId, {}, { conversation_title: `Example chat ${new Date().toLocaleTimeString()}` }, 'bot-first');
      current = conversation;
      listen(conversation);
      ui.clearMessages();
      typingLine = ui.typing('');
      $('convTitle').textContent = 'New conversation';
      enable();
      ui.log('createConversation: started, bot first (the greeting comes on the socket)', 'ok');
      setTimeout(refreshList, 1500);
    } catch (err) {
      ui.log(`createConversation: ${err.message}`, 'bad');
    } finally {
      $('newBtn').disabled = false;
    }
  };
  $('refreshBtn').onclick = refreshList;
  $('composer').onsubmit = (e) => {
    e.preventDefault();
    const text = $('text').value;
    $('text').value = '';
    send(text);
  };
  $('stopBtn').onclick = async () => {
    if (!current) return;
    const { stopped } = await current.stop();
    ui.log(`stop(): stopped=${stopped}`);
    if (!stopped) ui.note('Nothing to stop: core\'s gateway sends each reply whole, and stop() works only with a key from Blue.');
  };
  $('reconnectBtn').onclick = async () => {
    if (!current) return;
    $('reconnectBtn').disabled = true;
    const before = api.getSocketId();
    try {
      ui.log(`Test: closing the socket (id ${shortId(before)})`, 'bad');
      api.getSocket().close();
      const t0 = Date.now();
      while (api.isSocketActive() && Date.now() - t0 < 5000) await new Promise((r) => setTimeout(r, 100));
      showSocket();
      ui.log(`Test: isSocketActive() is ${api.isSocketActive()}`);
      ui.note('The socket was closed. Reconnecting…');
      const r0 = Date.now();
      await api.reconnect();
      showSocket();
      const after = api.getSocketId();
      ui.log(`Test: reconnected in ${((Date.now() - r0) / 1000).toFixed(1)} s, new socket id ${shortId(after)} (${after && after !== before ? 'a new one' : 'the same'})`, 'ok');
      test = { sentAt: Date.now() };
      await send('Are you still there?');
    } catch (err) {
      test = null;
      ui.log(`Test: ${err.message}`, 'bad');
    } finally {
      $('reconnectBtn').disabled = !current;
    }
  };

  $('newBtn').disabled = false;
  $('refreshBtn').disabled = false;
  refreshList();
})();
