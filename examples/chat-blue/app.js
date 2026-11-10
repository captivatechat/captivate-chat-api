// A web chat with a Vienna Blue bot through captivate-chat-api's Blue mode (a `vba_` key for your app).
// It shows the answer while it's written, its sources, quick replies, Stop, a dropped connection read back,
// and the user's conversations. See README.md for how to run it.
(async function () {
  const ui = window.ExampleUI;
  const { $ } = ui;
  const { CaptivateChatAPI, isBlueKey } = window;
  const { key, mode } = window.EXAMPLE_CONFIG;

  // "Test reconnect" cuts the connection an answer is coming down. Blue mode opens no socket: each message is one
  // HTTPS request whose answer streams back, so the library is given a fetch whose answers this page can cut, as a
  // lost network would. The library then reads the answer back from Blue; it never sends the message again.
  const streams = new Set();
  function cuttableFetch(url, init) {
    return window.fetch(url, init).then((response) => {
      const isSend = init && init.method === 'POST' && /\/v1\/chat$/.test(new URL(url).pathname);
      if (!isSend || !response.body) return response;
      const reader = response.body.getReader();
      let controller;
      const stream = {
        cut() {
          streams.delete(stream);
          try { controller.error(new TypeError('Failed to fetch')); } catch (_) { /* already ended */ }
          reader.cancel().catch(() => {});
        },
      };
      const body = new ReadableStream({
        start(c) { controller = c; streams.add(stream); },
        async pull(c) {
          try {
            const { done, value } = await reader.read();
            if (done) { streams.delete(stream); c.close(); } else c.enqueue(value);
          } catch (err) {
            streams.delete(stream);
            try { c.error(err); } catch (_) { /* already cut */ }
          }
        },
        cancel(reason) { streams.delete(stream); return reader.cancel(reason); },
      });
      return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
    });
  }

  const userBox = $('userId');
  let userId = '';
  try { userId = localStorage.getItem('example-blue-user') || ''; } catch (_) { /* storage blocked */ }
  if (!userId) userId = `example-user-${Math.random().toString(36).slice(2, 8)}`;
  userBox.value = userId;
  userBox.onchange = () => {
    userId = userBox.value.trim() || userId;
    try { localStorage.setItem('example-blue-user', userId); } catch (_) { /* storage blocked */ }
    refreshList();
  };
  try { localStorage.setItem('example-blue-user', userId); } catch (_) { /* storage blocked */ }

  if (!isBlueKey(key) || !key.startsWith('vba_')) {
    ui.status('<b class="bad">This needs a key for your app from Blue\'s Channels page (it starts with vba_).</b>');
    return;
  }

  let api;
  try {
    api = await CaptivateChatAPI.create(key, mode, { fetch: cuttableFetch });
  } catch (err) {
    ui.status(`<b class="bad">Couldn't start: ${ui.esc(err.errorDesc || err.message)}</b>`);
    return;
  }
  ui.status(`<b class="ok">Ready</b> · Blue mode (${ui.esc(mode)}) · no socket: each message is one request`);
  ui.log('Library ready in Blue mode', 'ok');

  let current = null;       // the open conversation's handle
  let draft = null;         // the bubble showing the answer while it's written
  let typingLine = null;    // the typing line, with Blue's step label
  let answering = false;
  let test = null;          // the reconnect test while it runs
  const listened = new WeakSet();

  function setBusy(busy) {
    answering = busy;
    $('stopBtn').disabled = !busy;
    $('reconnectBtn').disabled = busy || !current;
  }
  function enable() {
    for (const id of ['text', 'sendBtn']) $(id).disabled = !current;
    $('reconnectBtn').disabled = !current || answering;
  }
  function endTyping() { if (typingLine) { typingLine.remove(); typingLine = null; } }

  function listen(conversation) {
    if (listened.has(conversation)) return;
    listened.add(conversation);
    const mine = () => conversation === current;
    conversation.onStep((label) => {
      if (!mine()) return;
      if (!typingLine) typingLine = ui.typing(label);
      else typingLine.querySelector('.label').textContent = label;
    });
    conversation.onDelta((text, { reset }) => {
      if (!mine()) return;
      endTyping();
      if (!draft) draft = ui.bubble('bot', '', 'draft');
      draft.innerHTML = ui.markdown(reset ? '' : text);
      ui.scrollDown();
      if (test && !test.cutAt && text) {
        test.cutAt = Date.now();
        test.wordsBefore = text.split(/\s+/).length;
        const cut = streams.size;
        for (const s of [...streams]) s.cut();
        ui.log(`Test: connection cut after the first ${test.wordsBefore} words (${cut} stream cut)`, 'bad');
        ui.note('The connection was cut. The library reads the answer back from Blue…');
      }
    });
    conversation.onMessage((content, type) => {
      if (!mine()) return;
      if (test) test.messages += 1;
      ui.log(`onMessage (${type})`);
    });
    conversation.onAnswer((answer) => {
      if (!mine()) return;
      endTyping();
      const el = draft || ui.bubble('bot', '');
      draft = null;
      el.className = `bubble bot${answer.stopped ? ' stopped' : ''}`;
      el.innerHTML = ui.markdown(answer.text);
      ui.sources(el, answer.sources);
      ui.choices(answer.choices, (choice) => send(choice));
      ui.log(`onAnswer: ${answer.text.length} characters, ${answer.sources.length} sources, ${(answer.choices || []).length} quick replies${answer.stopped ? ', stopped' : ''}`, 'ok');
      setBusy(false);
      if (test) finishTest(answer);
    });
    conversation.onConversationUpdate((update) => {
      if (!mine()) return;
      ui.log(`Update: ${update.type}`);
      if (update.type === 'answering' && test) ui.note('Blue is still writing the answer; reading it back.');
    });
    conversation.onError((error) => {
      if (!mine()) return;
      endTyping();
      ui.log(`onError: ${error.errorDesc}${error.errorCode ? ` (${error.errorCode})` : ''}`, 'bad');
    });
  }

  function finishTest(answer) {
    const t = test;
    test = null;
    if (!t.cutAt) {
      ui.log('Test: the answer came before any words could be cut. Press Test reconnect again.', 'bad');
      return;
    }
    const once = t.messages <= 1 && $('messages').querySelectorAll('.bubble.bot.draft').length === 0;
    ui.log(`Test: recovered in ${((Date.now() - t.cutAt) / 1000).toFixed(1)} s, the answer came ${once ? 'once' : `${t.messages} times`} (${answer.text.split(/\s+/).length} words)`, once ? 'ok' : 'bad');
    ui.note(once ? 'Recovered: the whole answer was read back, once.' : 'The answer came more than once.');
  }

  async function send(text) {
    if (!current || !text.trim()) return;
    ui.bubble('you', text);
    typingLine = ui.typing('');
    setBusy(true);
    try {
      await current.sendMessage(text);
      ui.log('Message sent; the answer has started');
    } catch (err) {
      endTyping();
      setBusy(false);
      ui.bubble('bot', err.errorDesc || 'The message didn\'t go through. Send it again.', 'error');
      ui.log(`sendMessage refused: ${err.errorDesc || err.message}`, 'bad');
    }
  }

  async function open(conversation, title) {
    current = conversation;
    draft = null;
    endTyping();
    listen(conversation);
    ui.clearMessages();
    $('convTitle').textContent = title || 'Conversation';
    enable();
    try {
      const transcript = await conversation.getTranscript();
      for (const m of transcript) {
        const el = ui.bubble(m.sender === 'user' ? 'you' : 'bot', m.text || '', m.stopped ? 'stopped' : '');
        if (m.sender !== 'user') ui.sources(el, m.sources);
      }
      ui.log(`Opened a conversation: ${transcript.length} messages read back`);
    } catch (err) {
      ui.log(`getTranscript: ${err.errorDesc || err.message}`, 'bad');
    }
    refreshList();
  }

  async function refreshList() {
    try {
      const { conversations, pagination } = await api.getUserConversations({ userId, pagination: { page: 1, limit: 20 } });
      const items = conversations.map((c) => {
        const meta = (c.metadata && c.metadata.channelMetadata) || {};
        const custom = meta.custom || {};
        const when = meta.conversationUpdatedAt ? new Date(meta.conversationUpdatedAt).toLocaleString() : '';
        return { id: c.getConversationId(), title: custom.conversation_title || meta.preview || 'Conversation', detail: [meta.lastChatMessage || meta.preview, when].filter(Boolean).join(' · ') };
      });
      ui.conversationList(items, current && current.getConversationId(), (id) => {
        const c = conversations.find((x) => x.getConversationId() === id);
        open(c, items.find((i) => i.id === id).title);
      });
      ui.log(`getUserConversations: ${items.length} of ${pagination ? pagination.total : items.length}`);
    } catch (err) {
      ui.log(`getUserConversations: ${err.errorDesc || err.message}`, 'bad');
    }
  }

  $('newBtn').onclick = async () => {
    $('newBtn').disabled = true;
    try {
      const conversation = await api.createConversation(userId, {}, { conversation_title: `Example chat ${new Date().toLocaleTimeString()}` }, 'bot-first');
      // The greeting comes on the next tick, so the listeners go on first.
      current = conversation;
      listen(conversation);
      ui.clearMessages();
      $('convTitle').textContent = 'New conversation';
      enable();
      ui.log('createConversation: started, bot first', 'ok');
      setTimeout(refreshList, 500);
    } catch (err) {
      ui.log(`createConversation: ${err.errorDesc || err.message}`, 'bad');
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
    try {
      const { stopped } = await current.stop();
      ui.log(`stop(): ${stopped ? 'stopped' : 'nothing was being answered'}`, stopped ? 'ok' : '');
    } catch (err) {
      ui.log(`stop(): ${err.errorDesc || err.message}`, 'bad');
    }
  };
  $('reconnectBtn').onclick = () => {
    test = { cutAt: 0, messages: 0 };
    ui.log('Test: asking a question, then cutting the connection at its first words');
    send('Tell me everything about your returns policy, in detail.');
  };

  $('newBtn').disabled = false;
  $('refreshBtn').disabled = false;
  refreshList();
})();
