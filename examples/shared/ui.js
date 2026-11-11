// What both examples draw: messages, Markdown, sources, quick replies, the conversation list and the event log.
// Plain browser JavaScript, no build step. Nothing here talks to the library.
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // Enough Markdown for chat answers: paragraphs, lists, **bold**, *italic*, `code`, http(s) links and [n] source
  // markers. Everything is escaped first, so an answer can't put HTML on the page. A `\` before a mark keeps the mark.
  function inline(text) {
    const kept = [];
    let s = esc(text).replace(/\\([\\`*_[\]()#+\-.!>])/g, (_, c) => { kept.push(c); return `\u0000${kept.length - 1}\u0000`; });
    s = s
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
      .replace(/\[(\d{1,3})\]/g, '<sup class="cite">[$1]</sup>');
    return s.replace(/\u0000(\d+)\u0000/g, (_, i) => esc(kept[Number(i)]));
  }
  function markdown(text) {
    // Core's bots write line breaks as <br>; they're turned into new lines before anything is escaped.
    const lines = String(text).replace(/<br\s*\/?>/gi, '\n').split(/\r?\n/);
    let html = '';
    let list = null;
    const close = () => { if (list) { html += `</${list}>`; list = null; } };
    for (const line of lines) {
      const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
      const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
      if (bullet || numbered) {
        const want = bullet ? 'ul' : 'ol';
        if (list !== want) { close(); html += `<${want}>`; list = want; }
        html += `<li>${inline((bullet || numbered)[1])}</li>`;
      } else if (line.trim()) {
        close();
        html += `<p>${inline(line.replace(/^#+\s*/, ''))}</p>`;
      } else close();
    }
    close();
    return html;
  }

  function scrollDown() { const m = $('messages'); m.scrollTop = m.scrollHeight; }

  function bubble(who, text, extra = '') {
    const el = document.createElement('div');
    el.className = `bubble ${who} ${extra}`.trim();
    if (who === 'you') el.textContent = text; else el.innerHTML = markdown(text);
    $('messages').appendChild(el);
    scrollDown();
    return el;
  }
  function note(text, cls = 'note') {
    const el = document.createElement('div');
    el.className = cls;
    el.textContent = text;
    $('messages').appendChild(el);
    scrollDown();
    return el;
  }
  function typing(label) {
    const el = document.createElement('div');
    el.className = 'step';
    el.innerHTML = '<span class="dots" aria-hidden="true"><span></span><span></span><span></span></span> <span class="label"></span>';
    el.querySelector('.label').textContent = label || '';
    $('messages').appendChild(el);
    scrollDown();
    return el;
  }
  // list: [{ number, title, url?, page? }], numbered as the [n] in the answer.
  function sources(el, list) {
    if (!list || !list.length) return;
    const box = document.createElement('div');
    box.className = 'sources';
    box.innerHTML = '<b>Sources</b><ol></ol>';
    const ol = box.querySelector('ol');
    for (const s of list) {
      const li = document.createElement('li');
      if (s.number) li.value = s.number;
      const title = s.title || 'Internal document';
      if (s.url && /^https?:\/\//.test(s.url)) {
        const a = document.createElement('a');
        a.href = s.url;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.textContent = title;
        li.appendChild(a);
      } else li.textContent = title;
      if (s.page) li.append(`, page ${s.page}`);
      ol.appendChild(li);
    }
    el.appendChild(box);
    scrollDown();
  }
  // Quick replies as buttons; pressing one sends its words and takes the buttons away.
  function choices(list, onPick) {
    if (!list || !list.length) return null;
    const row = document.createElement('div');
    row.className = 'choices';
    for (const c of list) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = c;
      b.onclick = () => { row.remove(); onPick(c); };
      row.appendChild(b);
    }
    $('messages').appendChild(row);
    scrollDown();
    return row;
  }
  function clearMessages() { $('messages').innerHTML = ''; }

  function log(text, cls = '') {
    const line = document.createElement('div');
    if (cls) line.className = cls;
    line.textContent = `${new Date().toLocaleTimeString()}  ${text}`;
    $('log').appendChild(line);
    $('log').scrollTop = $('log').scrollHeight;
  }
  function status(html) { $('status').innerHTML = html; }

  // items: [{ id, title, detail }]; the current one is marked.
  function conversationList(items, currentId, onOpen) {
    const ul = $('convs');
    ul.innerHTML = '';
    if (!items.length) { ul.innerHTML = '<li><small>No conversations yet.</small></li>'; return; }
    for (const item of items) {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('aria-current', String(item.id === currentId));
      b.innerHTML = '<span></span><small></small>';
      b.querySelector('span').textContent = item.title;
      b.querySelector('small').textContent = item.detail || '';
      b.onclick = () => onOpen(item.id);
      li.appendChild(b);
      ul.appendChild(li);
    }
  }

  window.ExampleUI = { $, esc, markdown, bubble, note, typing, sources, choices, clearMessages, log, status, conversationList, scrollDown };
})();
