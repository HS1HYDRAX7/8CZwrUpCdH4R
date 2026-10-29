(() => {
  'use strict';

  const MAX_FILE_BYTES = 25 * 1024 * 1024;
  const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
  const MAX_EMOJI_BYTES = 512 * 1024;
  const POLL_MS = 2000;
  const REFRESH_EVERY_POLLS = 15;
  const GROUP_MS = 7 * 60 * 1000;
  const TYPING_SEND_MS = 4000;
  const COLORS = ['#e11d2e', '#5865f2', '#23a55a', '#f0b232', '#eb459e', '#00a8fc', '#8b5cf6'];
  const ALLOWED_FILES = /^(image\/(png|jpeg|gif|webp)|audio\/(mpeg|ogg|wav|webm|mp4|flac)|video\/(mp4|webm)|application\/pdf|text\/plain|application\/zip)$/;
  const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
  const FRAME_OPTIONS = [
    ['none', 'None'], ['ring', 'Ring'], ['neon', 'Neon'], ['flame', 'Flame'], ['gold', 'Gold'], ['aurora', 'Aurora'],
  ];

  const state = {
    me: null,
    meProfile: null,
    servers: [],
    server: null,
    owner: false,
    channels: [],
    members: [],
    channel: null,
    messages: [],
    emojis: [],
    emojiByName: new Map(),
    typing: [],
    pendingFile: null,
    editing: null,
    navToken: 0,
    pollTimer: null,
    polls: 0,
    online: true,
    lastPollOk: Date.now(),
    busy: false,
    lastTypingSent: 0,
  };

  const $ = (selector, root = document) => root.querySelector(selector);

  function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (value === null || value === undefined || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key === 'dataset') Object.assign(node.dataset, value);
      else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value === true ? '' : String(value));
    }
    for (const child of children.flat()) {
      if (child === null || child === undefined || child === false) continue;
      node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return node;
  }

  async function api(path, { method = 'GET', body, rawBody, headers = {} } = {}) {
    const init = { method, credentials: 'same-origin', headers: { 'X-Requested-With': 'Hellcord', ...headers } };
    if (rawBody !== undefined) {
      init.body = rawBody;
    } else if (body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    const res = await fetch('api/' + path, init);
    let data = {};
    try {
      data = await res.json();
    } catch {
      // empty body
    }
    if (!res.ok) {
      const error = new Error(data.error || `Request failed (${res.status})`);
      error.status = res.status;
      throw error;
    }
    return data;
  }

  function colorFor(name) {
    let hash = 0;
    for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
    return COLORS[hash % COLORS.length];
  }

  function formatTime(timestamp) {
    const date = new Date(timestamp);
    const sameDay = date.toDateString() === new Date().toDateString();
    return sameDay
      ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : date.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  function fileUrl(id) {
    return `api/files/${encodeURIComponent(id)}`;
  }

  function openMobileNav() {
    const shell = $('#shell');
    if (shell) shell.classList.add('nav-open');
  }
  function closeMobileNav() {
    const shell = $('#shell');
    if (shell) shell.classList.remove('nav-open');
  }
  function toggleMobileNav() {
    const shell = $('#shell');
    if (!shell) return;
    shell.classList.toggle('nav-open');
  }

  function setOnline(ok) {
    state.online = ok;
    state.lastPollOk = ok ? Date.now() : state.lastPollOk;
    const pill = document.querySelector('.conn-status');
    if (!pill) return;
    pill.classList.toggle('offline', !ok);
    pill.classList.toggle('reconnecting', !ok);
    const label = pill.querySelector('.conn-label');
    if (label) label.textContent = ok ? 'Online' : 'Reconnecting…';
  }

  function ensureToastStack() {
    let stack = document.querySelector('.toast-stack');
    if (!stack) {
      stack = el('div', { class: 'toast-stack', 'aria-live': 'polite' });
      document.body.append(stack);
    }
    return stack;
  }

  function toast(text, kind = '') {
    const stack = ensureToastStack();
    const node = el('div', { class: 'toast ' + kind, role: 'status' }, text);
    stack.append(node);
    setTimeout(() => {
      node.classList.add('leaving');
      setTimeout(() => node.remove(), 280);
    }, 3200);
  }

  // Avatar with an optional frame. Falls back to the first letter on a colored disc.
  function avatarNode(author, size = '') {
    const frame = author.frame && author.frame !== 'none' ? ` frame-${author.frame}` : '';
    const node = el('span', { class: ('avatar ' + size + frame).trim() });
    if (author.avatar) {
      node.append(el('img', { src: fileUrl(author.avatar), alt: '', loading: 'lazy' }));
    } else {
      node.style.background = colorFor(author.username);
      node.append(author.username[0].toUpperCase());
    }
    return node;
  }

  // Text with links, and :emoji: names replaced by images the viewer is allowed to use.
  function richText(text) {
    const fragment = document.createDocumentFragment();
    const pattern = /(https?:\/\/[^\s<>"']+)|:([a-z0-9_]{2,32}):/gi;
    let last = 0;
    let match;
    while ((match = pattern.exec(text))) {
      if (match.index > last) fragment.append(text.slice(last, match.index));
      if (match[1]) {
        fragment.append(el('a', { href: match[1], target: '_blank', rel: 'noopener noreferrer' }, match[1]));
      } else {
        const emoji = state.emojiByName.get(match[2].toLowerCase());
        if (emoji) {
          fragment.append(el('img', {
            class: 'emoji', src: fileUrl(emoji.fileId), alt: `:${emoji.name}:`,
            title: `:${emoji.name}: from ${emoji.serverName}`, loading: 'lazy',
          }));
        } else {
          fragment.append(match[0]);
        }
      }
      last = match.index + match[0].length;
    }
    if (last < text.length) fragment.append(text.slice(last));
    return fragment;
  }

  // Modal shell used by every dialog. content(close) returns the nodes to show.
  function showModal(content, { wide = false, label = 'Dialog' } = {}) {
    const close = () => {
      document.removeEventListener('keydown', onKey);
      overlay.remove();
    };
    const onKey = (event) => { if (event.key === 'Escape') close(); };
    const panel = el('div', { class: 'modal' + (wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': label });
    const overlay = el('div', { class: 'overlay', onclick: (event) => { if (event.target === overlay) close(); } }, panel);
    panel.append(...[content(close)].flat());
    document.addEventListener('keydown', onKey);
    document.body.append(overlay);
    return { close, panel };
  }

  function simpleForm({ title, label, submitLabel, onSubmit }) {
    showModal((close) => {
      const input = el('input', { required: true, maxlength: 40, autocomplete: 'off', 'aria-label': label });
      const error = el('p', { class: 'form-error', role: 'alert' });
      return el('form', {
        class: 'stack',
        onsubmit: async (event) => {
          event.preventDefault();
          error.textContent = '';
          try {
            await onSubmit(input.value.trim());
            close();
          } catch (err) {
            error.textContent = err.message;
          }
        },
      },
        el('h2', { text: title }),
        el('label', {}, label, input),
        error,
        el('div', { class: 'dialog-actions' },
          el('button', { class: 'ghost', type: 'button', onclick: close }, 'Cancel'),
          el('button', { class: 'primary', type: 'submit' }, submitLabel)));
    }, { label: title });
    setTimeout(() => document.querySelector('.modal input')?.focus(), 0);
  }

  // ---------- auth ----------

  function renderAuth(mode = 'login') {
    stopPolling();
    const isLogin = mode === 'login';
    $('#app').replaceChildren(
      el('main', { class: 'auth' },
        el('section', { class: 'auth-card' },
          el('div', { class: 'brand-lg' },
            el('img', { src: 'assets/hellcord.svg', alt: '', width: 44, height: 44 }),
            el('h1', { text: 'Hellcord' })),
          el('p', { class: 'muted', text: isLogin ? 'Welcome back.' : 'Create your account.' }),
          el('form', { class: 'stack', onsubmit: (event) => submitAuth(event, mode) },
            el('label', {}, 'Username',
              el('input', { name: 'username', autocomplete: 'username', required: true, minlength: 3, maxlength: 24 })),
            el('label', {}, 'Password',
              el('input', {
                name: 'password', type: 'password', required: true, minlength: 8, maxlength: 200,
                autocomplete: isLogin ? 'current-password' : 'new-password',
              })),
            el('p', { class: 'form-error', id: 'auth-error', role: 'alert' }),
            el('button', { class: 'primary', type: 'submit' }, isLogin ? 'Log in' : 'Create account')),
          el('button', { class: 'link', type: 'button', onclick: () => renderAuth(isLogin ? 'register' : 'login') },
            isLogin ? 'Need an account? Register' : 'Already have an account? Log in'))));
  }

  async function submitAuth(event, mode) {
    event.preventDefault();
    const form = event.currentTarget;
    const error = $('#auth-error');
    error.textContent = '';
    try {
      const data = await api(`auth/${mode}`, {
        method: 'POST',
        body: { username: form.username.value, password: form.password.value },
      });
      state.me = data.user;
      await loadApp();
    } catch (err) {
      error.textContent = err.message;
    }
  }

  async function logout() {
    try {
      await api('auth/logout', { method: 'POST' });
    } catch {
      // the server clears the cookie; a failed call still leaves the UI signed out
    }
    Object.assign(state, { me: null, meProfile: null, servers: [], server: null, channel: null, messages: [], pendingFile: null });
    renderAuth('login');
  }

  // ---------- shell ----------

  async function loadApp() {
    const [{ servers }, { user }] = await Promise.all([api('servers'), api(`users/${state.me.id}`)]);
    state.meProfile = user;
    state.servers = servers;
    renderShell();
    if (servers.length) await openServer(servers[0].id);
    else renderEmpty();
  }

  function renderShell() {
    $('#app').replaceChildren(
      el('div', { class: 'hc-app', id: 'shell' },
        el('div', { class: 'nav-scrim', id: 'nav-scrim', onclick: closeMobileNav }),
        el('nav', { class: 'rail', id: 'rail', 'aria-label': 'Servers' }),
        el('aside', { class: 'sidebar', id: 'sidebar' }),
        el('main', { class: 'chat', id: 'chat' }),
        el('aside', { class: 'members', id: 'members', 'aria-label': 'Members' })));
    renderRail();
    renderSidebar();
    renderChat();
    renderMembers();
  }

  function renderEmpty() {
    renderShell();
    $('#chat').replaceChildren(
      el('div', { class: 'empty' },
        el('h2', { text: 'Start with a server' }),
        el('p', { class: 'muted', text: 'Create a server for your group, or join one with an invite code.' }),
        el('div', { class: 'row' },
          el('button', { class: 'primary', onclick: openCreateServer }, 'Create server'),
          el('button', { class: 'ghost', onclick: openJoinServer }, 'Join with invite'))));
  }

  function renderRail() {
    const rail = $('#rail');
    if (!rail) return;
    rail.replaceChildren(
      el('div', { class: 'server-btn home', title: 'Hellcord', 'aria-hidden': 'true' }, 'H'),
      el('div', { class: 'rail-sep' }),
      ...state.servers.map((server) => el('button', {
        class: 'server-btn' + (state.server && state.server.id === server.id ? ' active' : ''),
        title: server.name,
        'aria-label': server.name,
        onclick: () => openServer(server.id),
      }, server.name.slice(0, 2).toUpperCase())),
      el('button', { class: 'server-btn add', title: 'Create a server', 'aria-label': 'Create a server', onclick: openCreateServer }, '+'),
      el('button', { class: 'server-btn add', title: 'Join with invite', 'aria-label': 'Join with invite', onclick: openJoinServer }, '↗'));
  }

  function renderSidebar() {
    const sidebar = $('#sidebar');
    if (!sidebar) return;
    if (!state.server) {
      sidebar.replaceChildren();
      return;
    }
    const me = state.meProfile || state.me;
    sidebar.replaceChildren(
      el('header', { class: 'side-head' },
        el('strong', { text: state.server.name }),
        el('button', { class: 'icon-btn', title: 'Copy invite code', 'aria-label': 'Copy invite code', onclick: copyInvite }, '⧉')),
      el('div', { class: 'side-section' },
        el('span', { class: 'label', text: 'Channels' }),
        state.owner
          ? el('button', { class: 'icon-btn small', title: 'Create channel', 'aria-label': 'Create channel', onclick: openCreateChannel }, '+')
          : null),
      el('ul', { class: 'channels', role: 'list' },
        state.channels.map((channel) => el('li', {},
          el('button', {
            class: 'channel' + (state.channel && state.channel.id === channel.id ? ' active' : ''),
            onclick: () => openChannel(channel.id),
          }, el('span', { class: 'hash', text: '#' }), channel.name)))),
      el('footer', { class: 'user-bar' },
        el('button', { class: 'user-card', title: 'Edit your profile', onclick: openProfileSettings },
          avatarNode({ username: state.me.username, avatar: me.avatar, frame: me.frame }, 'small'),
          el('span', { class: 'user-name', text: state.me.username })),
        el('button', { class: 'icon-btn', title: 'Log out', 'aria-label': 'Log out', onclick: logout }, '⏻')));
  }

  function renderChat() {
    const chat = $('#chat');
    if (!chat) return;
    if (!state.channel) {
      chat.replaceChildren(el('div', { class: 'empty' }, el('p', { class: 'muted', text: 'Pick a channel to start talking.' })));
      return;
    }
    chat.replaceChildren(
      el('header', { class: 'chat-head' },
        el('button', { class: 'icon-btn nav-toggle', 'aria-label': 'Show channels', onclick: toggleMobileNav }, '☰'),
        el('span', { class: 'hash', text: '#' }),
        el('strong', { text: state.channel.name }),
        el('span', { class: 'conn-status' + (state.online ? '' : ' offline reconnecting'), title: 'Connection status' },
          el('span', { class: 'dot', 'aria-hidden': 'true' }),
          el('span', { class: 'conn-label', text: state.online ? 'Online' : 'Reconnecting…' })),
        el('span', { class: 'head-actions' },
          el('button', { class: 'ghost small', onclick: openBotStudio }, 'Bots'),
          el('button', { class: 'ghost small', onclick: openEmojiManager }, 'Emojis'))),
      el('div', { class: 'messages', id: 'messages', role: 'log', 'aria-live': 'polite' }),
      el('div', { class: 'typing', id: 'typing', hidden: true }),
      el('form', { class: 'composer', id: 'composer', onsubmit: sendMessage },
        el('div', { class: 'pending', id: 'pending', hidden: true }),
        el('div', { class: 'composer-row' },
          el('label', { class: 'icon-btn attach', title: 'Attach a file', 'aria-label': 'Attach a file' },
            '+',
            el('input', {
              type: 'file', id: 'file-input', hidden: true,
              accept: 'image/*,audio/*,video/*,application/pdf,text/plain,application/zip',
              onchange: (event) => { takeFile(event.currentTarget.files[0]); event.currentTarget.value = ''; },
            })),
          el('textarea', {
            id: 'message-input', rows: 1, maxlength: 2000,
            placeholder: `Message #${state.channel.name}`, 'aria-label': 'Message',
            onkeydown: onComposerKey, oninput: onComposerInput,
          }),
          el('button', { class: 'primary send', type: 'submit', id: 'send' }, 'Send'))));
    chat.ondragover = (event) => { event.preventDefault(); chat.classList.add('dropping'); };
    chat.ondragleave = () => chat.classList.remove('dropping');
    chat.ondrop = (event) => {
      event.preventDefault();
      chat.classList.remove('dropping');
      takeFile(event.dataTransfer?.files?.[0]);
    };
    renderPending();
    renderTyping();
    renderMessages(true);
    $('#messages').addEventListener('click', toggleMessageActions);
  }

  // Touch screens have no hover: tapping a message shows its toolbar.
  function toggleMessageActions(event) {
    if (event.target.closest('button, a, input, textarea, audio, video')) return;
    const message = event.target.closest('.msg');
    document.querySelectorAll('.msg.show-actions').forEach((node) => { if (node !== message) node.classList.remove('show-actions'); });
    message?.classList.toggle('show-actions');
  }

  function renderMembers() {
    const aside = $('#members');
    if (!aside) return;
    aside.replaceChildren(
      el('h3', { class: 'label', text: `Members — ${state.members.length}` }),
      el('ul', { class: 'member-list', role: 'list' },
        state.members.map((member) => el('li', { class: 'member' },
          el('span', { class: 'avatar small', style: `background:${colorFor(member.username)}` }, member.username[0].toUpperCase()),
          el('span', { text: member.username + (state.server && member.id === state.server.owner_id ? ' · owner' : '') })))));
  }

  // ---------- servers and channels ----------

  async function openServer(serverId) {
    closeMobileNav();
    const token = ++state.navToken;
    const data = await api(`servers/${serverId}`);
    if (token !== state.navToken) return;
    state.server = data.server;
    state.owner = data.server.owner_id === state.me.id;
    state.channels = data.channels;
    state.members = data.members;
    renderRail();
    renderMembers();
    const first = data.channels[0];
    if (first) {
      await openChannel(first.id);
    } else {
      state.channel = null;
      renderSidebar();
      renderChat();
    }
  }

  async function openChannel(channelId) {
    closeMobileNav();
    stopPolling();
    const token = ++state.navToken;
    state.channel = state.channels.find((c) => c.id === channelId) || null;
    state.messages = [];
    state.typing = [];
    state.pendingFile = null;
    state.editing = null;
    renderSidebar();
    renderChat();
    if (!state.channel) return;
    const [{ messages }, emojiData] = await Promise.all([
      api(`channels/${channelId}/messages`),
      api(`channels/${channelId}/emojis`),
    ]);
    if (token !== state.navToken) return;
    state.messages = messages;
    setEmojis(emojiData.emojis);
    renderMessages(true);
    startPolling();
  }

  function setEmojis(list) {
    state.emojis = list;
    state.emojiByName = new Map();
    for (const emoji of list) {
      const current = state.emojiByName.get(emoji.name);
      if (!current || (state.server && emoji.serverId === state.server.id)) {
        state.emojiByName.set(emoji.name, emoji);
      }
    }
  }

  function openCreateServer() {
    simpleForm({
      title: 'Create a server', label: 'Server name', submitLabel: 'Create',
      onSubmit: async (name) => {
        const { server } = await api('servers', { method: 'POST', body: { name } });
        state.servers = (await api('servers')).servers;
        await openServer(server.id);
        renderRail();
      },
    });
  }

  function openJoinServer() {
    simpleForm({
      title: 'Join a server', label: 'Invite code', submitLabel: 'Join',
      onSubmit: async (invite) => {
        const { server } = await api('servers/join', { method: 'POST', body: { invite } });
        state.servers = (await api('servers')).servers;
        await openServer(server.id);
        renderRail();
      },
    });
  }

  function openCreateChannel() {
    simpleForm({
      title: 'Create a channel', label: 'Channel name', submitLabel: 'Create',
      onSubmit: async (name) => {
        await api(`servers/${state.server.id}/channels`, { method: 'POST', body: { name } });
        state.channels = (await api(`servers/${state.server.id}`)).channels;
        renderSidebar();
      },
    });
  }

  function copyInvite() {
    navigator.clipboard?.writeText(state.server.invite_code)
      .then(() => toast('Invite code copied'))
      .catch(() => toast(`Invite code: ${state.server.invite_code}`));
  }

  // ---------- profile ----------

  async function openProfile(userId) {
    const { user } = await api(`users/${userId}`);
    showModal(() => {
      const banner = el('div', { class: 'profile-banner', style: user.banner ? '' : `background:${user.bannerColor}` });
      if (user.banner) banner.style.backgroundImage = `url("${fileUrl(user.banner)}")`;
      return [
        banner,
        el('div', { class: 'profile-body' },
          el('div', { class: 'profile-avatar' }, avatarNode(user, 'xl')),
          el('h2', {},
            user.username,
            user.bot ? el('span', { class: 'badge bot', text: 'BOT' }) : null,
            user.nitro ? el('span', { class: 'badge nitro', text: 'NITRO' }) : null),
          el('p', { class: 'bio' }, user.bio || 'No bio yet.'),
          el('p', { class: 'muted small', text: `Member since ${new Date(user.createdAt).toLocaleDateString()}` })),
      ];
    }, { label: `${user.username}'s profile` });
  }

  function uploadProfileImage(kind, file) {
    if (!file) return;
    if (!IMAGE_TYPES.includes(file.type)) return toast('Use a PNG, JPEG, GIF or WebP image.', 'error');
    if (file.size > MAX_IMAGE_BYTES) return toast('Images can be at most 5 MB.', 'error');
    api(`me/${kind}`, { method: 'POST', rawBody: file, headers: { 'Content-Type': file.type } })
      .then(async () => {
        state.meProfile = (await api(`users/${state.me.id}`)).user;
        renderSidebar();
        toast(`${kind === 'avatar' ? 'Avatar' : 'Banner'} updated`, 'ok');
      })
      .catch((err) => toast(err.message, 'error'));
  }

  async function openProfileSettings() {
    const { user } = await api(`users/${state.me.id}`);
    showModal((close) => {
      const bio = el('textarea', { maxlength: 190, rows: 3, 'aria-label': 'Bio' });
      bio.value = user.bio || '';
      const color = el('input', { type: 'color', value: user.bannerColor, 'aria-label': 'Banner color' });
      const frame = el('select', { 'aria-label': 'Avatar frame' },
        FRAME_OPTIONS.map(([value, label]) => el('option', { value, selected: value === user.frame }, label)));
      return el('form', {
        class: 'stack',
        onsubmit: async (event) => {
          event.preventDefault();
          try {
            await api('me/profile', { method: 'PATCH', body: { bio: bio.value, bannerColor: color.value, frame: frame.value } });
            state.meProfile = (await api(`users/${state.me.id}`)).user;
            renderSidebar();
            toast('Profile saved', 'ok');
            close();
          } catch (err) {
            toast(err.message, 'error');
          }
        },
      },
        el('h2', { text: 'Your profile' }),
        el('label', {}, 'Bio', bio),
        el('label', {}, 'Banner color', color),
        el('label', {}, 'Avatar frame', frame),
        el('div', { class: 'row-split' },
          el('label', { class: 'file-field' }, 'Avatar image',
            el('input', { type: 'file', accept: IMAGE_TYPES.join(','), onchange: (e) => uploadProfileImage('avatar', e.currentTarget.files[0]) })),
          el('label', { class: 'file-field' }, 'Banner image',
            el('input', { type: 'file', accept: IMAGE_TYPES.join(','), onchange: (e) => uploadProfileImage('banner', e.currentTarget.files[0]) }))),
        el('div', { class: 'dialog-actions' },
          el('button', { class: 'ghost', type: 'button', onclick: close }, 'Cancel'),
          el('button', { class: 'primary', type: 'submit' }, 'Save profile')));
    }, { wide: true, label: 'Your profile' });
  }

  // ---------- bots ----------

  function showTokenOnce(token, container) {
    container.replaceChildren(
      el('div', { class: 'token-box' },
        el('p', { class: 'warn', text: 'Copy this token now. It will not be shown again.' }),
        el('code', { class: 'token', text: token }),
        el('button', {
          class: 'ghost small', type: 'button',
          onclick: () => navigator.clipboard?.writeText(token).then(() => toast('Token copied')),
        }, 'Copy token')));
  }

  async function openBotStudio() {
    let { bots } = await api('bots');
    let current = bots[0] || null;
    const modal = showModal(() => [], { wide: true, label: 'Bot studio' });

    const refresh = async () => {
      bots = (await api('bots')).bots;
      current = bots.find((b) => current && b.id === current.id) || bots[0] || null;
      draw();
    };

    const draw = () => {
      const { panel } = modal;
      const list = el('aside', { class: 'studio-list' },
        bots.map((bot) => el('button', {
          class: 'studio-item' + (current && current.id === bot.id ? ' active' : ''),
          onclick: () => { current = bot; draw(); },
        }, avatarNode({ username: bot.username, avatar: bot.avatar }, 'small'), bot.username)),
        el('button', { class: 'ghost', onclick: () => { current = null; draw(); } }, '+ New bot'));
      panel.replaceChildren(
        el('div', { class: 'studio-head' },
          el('h2', { text: 'Bot studio' }),
          el('button', { class: 'icon-btn', 'aria-label': 'Close', onclick: modal.close }, '×')),
        el('div', { class: 'studio' }, list, el('section', { class: 'studio-main' }, current ? botEditor(current) : newBotForm())));
    };

    const newBotForm = () => {
      const name = el('input', { maxlength: 24, required: true, 'aria-label': 'Bot name', placeholder: 'e.g. HelperBot' });
      const mode = el('select', { 'aria-label': 'Reply mode' },
        el('option', { value: 'canned' }, 'Standard replies'),
        el('option', { value: 'ai' }, 'AI (Xkiro)'));
      const prompt = el('textarea', { rows: 3, maxlength: 1000, 'aria-label': 'Personality prompt', placeholder: 'How should the bot talk?' });
      const fallback = el('input', { maxlength: 500, 'aria-label': 'Default reply', placeholder: 'Reply when nothing else applies' });
      const output = el('div');
      return el('form', {
        class: 'stack',
        onsubmit: async (event) => {
          event.preventDefault();
          try {
            const { bot, token } = await api('bots', {
              method: 'POST',
              body: { name: name.value.trim(), mode: mode.value, prompt: prompt.value, defaultReply: fallback.value },
            });
            showTokenOnce(token, output);
            bots = (await api('bots')).bots;
            current = bots.find((b) => b.id === bot.id) || null;
            toast('Bot created', 'ok');
            setTimeout(draw, 1500);
          } catch (err) {
            toast(err.message, 'error');
          }
        },
      },
        el('h3', { text: 'Create a bot' }),
        el('label', {}, 'Name', name),
        el('label', {}, 'Mode', mode),
        el('label', {}, 'Personality (AI mode)', prompt),
        el('label', {}, 'Default reply', fallback),
        el('p', { class: 'muted small', text: 'Bots answer when someone mentions them with @name, or runs one of their /commands.' }),
        el('button', { class: 'primary', type: 'submit' }, 'Create bot'),
        output);
    };

    const botEditor = (bot) => {
      const mode = el('select', { 'aria-label': 'Reply mode' },
        el('option', { value: 'canned', selected: bot.mode === 'canned' }, 'Standard replies'),
        el('option', { value: 'ai', selected: bot.mode === 'ai' }, 'AI (Xkiro)'));
      const prompt = el('textarea', { rows: 3, maxlength: 1000, 'aria-label': 'Personality prompt' });
      prompt.value = bot.prompt || '';
      const fallback = el('input', { maxlength: 500, 'aria-label': 'Default reply' });
      fallback.value = bot.defaultReply || '';
      const tokenBox = el('div');
      const cmdName = el('input', { maxlength: 24, 'aria-label': 'Command name', placeholder: 'command, e.g. ping' });
      const cmdResponse = el('input', { maxlength: 1000, 'aria-label': 'Command response', placeholder: 'pong {user} {args}' });

      return el('div', { class: 'editor' },
        el('div', { class: 'editor-head' },
          avatarNode({ username: bot.username, avatar: bot.avatar }, 'large'),
          el('div', {},
            el('h3', { text: bot.username }),
            el('span', { class: 'badge bot', text: 'BOT' }))),
        el('form', {
          class: 'stack',
          onsubmit: async (event) => {
            event.preventDefault();
            try {
              await api(`bots/${bot.id}`, { method: 'PATCH', body: { mode: mode.value, prompt: prompt.value, defaultReply: fallback.value } });
              toast('Bot saved', 'ok');
              await refresh();
            } catch (err) {
              toast(err.message, 'error');
            }
          },
        },
          el('label', {}, 'Mode', mode),
          el('label', {}, 'Personality (AI mode)', prompt),
          el('label', {}, 'Default reply', fallback),
          el('button', { class: 'primary', type: 'submit' }, 'Save changes')),
        el('div', { class: 'row-split' },
          el('label', { class: 'file-field' }, 'Bot avatar',
            el('input', {
              type: 'file', accept: IMAGE_TYPES.join(','),
              onchange: async (e) => {
                const file = e.currentTarget.files[0];
                if (!file || !IMAGE_TYPES.includes(file.type) || file.size > MAX_IMAGE_BYTES) return toast('Use an image up to 5 MB.', 'error');
                await api(`bots/${bot.id}/avatar`, { method: 'POST', rawBody: file, headers: { 'Content-Type': file.type } });
                toast('Bot avatar updated', 'ok');
                await refresh();
              },
            })),
          el('button', {
            class: 'ghost', type: 'button',
            onclick: async () => {
              const { token } = await api(`bots/${bot.id}/token`, { method: 'POST' });
              showTokenOnce(token, tokenBox);
            },
          }, 'Rotate token')),
        tokenBox,
        state.owner
          ? el('button', {
            class: 'ghost', type: 'button',
            onclick: async () => {
              try {
                await api(`servers/${state.server.id}/bots`, { method: 'POST', body: { botId: bot.id } });
                state.members = (await api(`servers/${state.server.id}`)).members;
                renderMembers();
                toast(`${bot.username} added to ${state.server.name}`, 'ok');
              } catch (err) {
                toast(err.message, 'error');
              }
            },
          }, `Add to ${state.server.name}`)
          : null,
        el('h3', { text: 'Commands' }),
        el('ul', { class: 'command-list' },
          bot.commands.length
            ? bot.commands.map((cmd) => el('li', {},
              el('code', { text: `/${cmd.name}` }),
              el('span', { class: 'muted', text: cmd.response }),
              el('button', {
                class: 'ghost small', type: 'button',
                onclick: async () => {
                  await api(`bots/${bot.id}/commands/${cmd.id}`, { method: 'DELETE' });
                  await refresh();
                },
              }, 'Delete')))
            : el('li', { class: 'muted', text: 'No commands yet.' })),
        el('form', {
          class: 'inline-form',
          onsubmit: async (event) => {
            event.preventDefault();
            try {
              await api(`bots/${bot.id}/commands`, {
                method: 'POST', body: { name: cmdName.value.trim(), response: cmdResponse.value.trim() },
              });
              await refresh();
            } catch (err) {
              toast(err.message, 'error');
            }
          },
        },
          cmdName, cmdResponse,
          el('button', { class: 'primary small', type: 'submit' }, 'Add command')));
    };

    draw();
  }

  // ---------- emojis ----------

  function openEmojiManager() {
    showModal((close) => {
      const name = el('input', { maxlength: 32, 'aria-label': 'Emoji name', placeholder: 'wave' });
      const file = el('input', { type: 'file', accept: IMAGE_TYPES.join(','), 'aria-label': 'Emoji image' });
      const list = el('ul', { class: 'emoji-list' },
        state.emojis.length
          ? state.emojis.map((emoji) => el('li', {},
            el('img', { class: 'emoji big', src: fileUrl(emoji.fileId), alt: '' }),
            el('code', { text: `:${emoji.name}:` }),
            el('span', { class: 'muted small', text: emoji.serverName }),
            emoji.serverId === state.server?.id && state.owner
              ? el('button', {
                class: 'ghost small',
                onclick: async () => {
                  await api(`emojis/${emoji.id}`, { method: 'DELETE' });
                  setEmojis((await api(`channels/${state.channel.id}/emojis`)).emojis);
                  renderMessages(false);
                  close();
                  toast('Emoji deleted', 'ok');
                },
              }, 'Delete')
              : null))
          : el('li', { class: 'muted', text: 'No emojis yet. Upload one below.' }));
      return el('form', {
        class: 'stack',
        onsubmit: async (event) => {
          event.preventDefault();
          const picked = file.files[0];
          if (!picked || !IMAGE_TYPES.includes(picked.type) || picked.size > MAX_EMOJI_BYTES) {
            return toast('Use a PNG, JPEG, GIF or WebP image up to 512 KB.', 'error');
          }
          try {
            const { file: uploaded } = await api(`servers/${state.server.id}/emojis/upload`, {
              method: 'POST', rawBody: picked, headers: { 'Content-Type': picked.type },
            });
            await api(`servers/${state.server.id}/emojis`, {
              method: 'POST', body: { name: name.value.trim().toLowerCase(), fileId: uploaded.id },
            });
            setEmojis((await api(`channels/${state.channel.id}/emojis`)).emojis);
            renderMessages(false);
            toast(`:${name.value.trim().toLowerCase()}: added`, 'ok');
            close();
          } catch (err) {
            toast(err.message, 'error');
          }
        },
      },
        el('h2', { text: 'Emojis' }),
        el('p', { class: 'muted small', text: 'Write :name: in any message to use an emoji. Nitro members can use emojis from every server they belong to.' }),
        list,
        el('label', {}, 'Name', name),
        el('label', { class: 'file-field' }, 'Image', file),
        el('div', { class: 'dialog-actions' },
          el('button', { class: 'ghost', type: 'button', onclick: close }, 'Close'),
          el('button', { class: 'primary', type: 'submit' }, 'Add emoji')));
    }, { wide: true, label: 'Emojis' });
  }

  // ---------- messages ----------

  function isNearBottom(list) {
    return list.scrollHeight - list.scrollTop - list.clientHeight < 120;
  }

  function renderMessages(scrollToEnd) {
    const list = $('#messages');
    if (!list) return;
    const stick = scrollToEnd || isNearBottom(list);
    if (!state.messages.length) {
      list.replaceChildren(
        el('div', { class: 'empty' },
          el('div', { class: 'empty-icon', 'aria-hidden': 'true' }, '🔥'),
          el('h2', { text: 'Welcome to #' + state.channel.name }),
          el('p', { class: 'muted', text: 'This is the start of the channel. Send a message to break the silence.' }))
      );
      return;
    }
    const nodes = [];
    let previous = null;
    let lastDay = null;
    for (const message of state.messages) {
      const day = new Date(message.created_at).toDateString();
      if (day !== lastDay) {
        const label = day === new Date().toDateString()
          ? 'Today'
          : day === new Date(Date.now() - 86400000).toDateString()
            ? 'Yesterday'
            : new Date(message.created_at).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
        nodes.push(el('div', { class: 'date-sep', role: 'separator' }, label));
        lastDay = day;
        previous = null;
      }
      const compact = previous
        && previous.author.id === message.author.id
        && message.created_at - previous.created_at < GROUP_MS
        && !previous.file && !message.file;
      nodes.push(messageNode(message, Boolean(compact)));
      previous = message;
    }
    list.replaceChildren(...nodes);
    if (stick) list.scrollTop = list.scrollHeight;
  }

  function messageNode(message, compact) {
    const mine = message.author.id === state.me.id;
    const canDelete = mine || state.owner;
    const editing = state.editing === message.id;
    const toolbar = el('div', { class: 'msg-toolbar' },
      el('button', { class: 'ghost small', title: 'Copy text', onclick: () => copyText(message.content) }, 'Copy'),
      mine ? el('button', { class: 'ghost small', title: 'Edit message', onclick: () => startEdit(message.id) }, 'Edit') : null,
      canDelete ? el('button', { class: 'ghost small danger-text', title: 'Delete message', onclick: () => deleteMessage(message.id) }, 'Delete') : null);

    return el('article', { class: 'msg' + (compact ? ' compact' : '') + (message._enter ? ' enter' : ''), dataset: { id: message.id } },
      compact ? el('span', { class: 'avatar-gutter' }) : el('button', {
        class: 'avatar-btn', title: `${message.author.username}'s profile`,
        onclick: () => openProfile(message.author.id),
      }, avatarNode(message.author)),
      el('div', { class: 'msg-body' },
        compact ? null : el('header', { class: 'msg-head' },
          el('button', { class: 'author', onclick: () => openProfile(message.author.id) }, message.author.username),
          message.author.bot ? el('span', { class: 'badge bot', text: 'BOT' }) : null,
          el('time', { datetime: new Date(message.created_at).toISOString() }, formatTime(message.created_at))),
        editing ? editForm(message) : el('p', { class: 'msg-text' },
          richText(message.content),
          message.edited_at ? el('span', { class: 'edited', text: ' (edited)' }) : null),
        message.file ? attachmentNode(message.file) : null),
      editing ? null : toolbar);
  }

  function startEdit(messageId) {
    state.editing = messageId;
    renderMessages(false);
    const field = document.querySelector(`.msg[data-id="${messageId}"] .edit-input`);
    field?.focus();
  }

  function editForm(message) {
    const field = el('textarea', { class: 'edit-input', rows: 2, maxlength: 2000, 'aria-label': 'Edit message' });
    field.value = message.content;
    const save = async () => {
      const content = field.value.trim();
      if (!content) return toast('Messages cannot be empty.', 'error');
      try {
        const { message: updated } = await api(`messages/${message.id}`, { method: 'PATCH', body: { content } });
        Object.assign(message, { content: updated.content, edited_at: updated.edited_at });
        state.editing = null;
        renderMessages(false);
      } catch (err) {
        toast(err.message, 'error');
      }
    };
    field.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        save();
      } else if (event.key === 'Escape') {
        state.editing = null;
        renderMessages(false);
      }
    });
    return el('div', { class: 'edit-box' },
      field,
      el('small', { class: 'muted', text: 'Enter to save · Esc to cancel' }));
  }

  function copyText(text) {
    navigator.clipboard?.writeText(text).then(() => toast('Copied', 'ok'))
      .catch(() => toast('Copy failed', 'error'));
  }

  function attachmentNode(file) {
    const url = fileUrl(file.id);
    if (file.mime.startsWith('image/')) {
      return el('a', { class: 'attach image', href: url, target: '_blank', rel: 'noopener' },
        el('img', { src: url, alt: file.name, loading: 'lazy' }));
    }
    if (file.mime.startsWith('audio/')) {
      return el('div', { class: 'attach audio' },
        el('span', { class: 'attach-name', text: `${file.name} · ${formatBytes(file.size)}` }),
        el('audio', { controls: true, preload: 'metadata', src: url }));
    }
    if (file.mime.startsWith('video/')) {
      return el('div', { class: 'attach video' }, el('video', { controls: true, preload: 'metadata', src: url }));
    }
    return el('a', { class: 'attach file', href: url, rel: 'noopener' },
      el('span', { text: file.name }),
      el('span', { class: 'muted', text: formatBytes(file.size) }));
  }

  function renderTyping() {
    const box = $('#typing');
    if (!box) return;
    if (!state.typing.length) {
      box.hidden = true;
      box.replaceChildren();
      return;
    }
    const names = state.typing.map((t) => t.username);
    const label = names.length === 1 ? `${names[0]} is typing` : `${names.slice(0, 2).join(', ')} are typing`;
    box.hidden = false;
    box.replaceChildren(
      el('span', { class: 'dots', 'aria-hidden': 'true' }, el('i'), el('i'), el('i')),
      el('span', { text: label + '…' }));
  }

  // ---------- polling ----------

  function startPolling() {
    stopPolling();
    state.polls = 0;
    state.pollTimer = setInterval(poll, POLL_MS);
  }

  function stopPolling() {
    if (state.pollTimer) clearInterval(state.pollTimer);
    state.pollTimer = null;
  }

  async function poll() {
    if (!state.channel || state.busy) return;
    const channelId = state.channel.id;
    const lastId = state.messages.length ? state.messages[state.messages.length - 1].id : 0;
    state.polls += 1;
    try {
      const [messagesData, typingData] = await Promise.all([
        state.polls % REFRESH_EVERY_POLLS === 0
          ? api(`channels/${channelId}/messages`)
          : api(`channels/${channelId}/messages?after=${lastId}`),
        api(`channels/${channelId}/typing`),
      ]);
      if (!state.channel || state.channel.id !== channelId) return;
      setOnline(true);
      state.typing = typingData.typing;
      renderTyping();

      if (state.polls % REFRESH_EVERY_POLLS === 0) {
        // Full refresh of the latest page picks up edits and deletions by other members.
        state.messages = messagesData.messages;
        renderMessages(false);
        return;
      }
      const known = new Set(state.messages.map((m) => m.id));
      const fresh = messagesData.messages.filter((m) => !known.has(m.id));
      if (!fresh.length) return;
      for (const m of fresh) m._enter = true;
      state.messages.push(...fresh);
      renderMessages(false);
      // Clear enter flag so full re-renders do not re-animate.
      for (const m of fresh) delete m._enter;
    } catch {
      setOnline(false);
      // network hiccup: the next tick tries again
    }
  }

  async function deleteMessage(messageId) {
    if (!confirm('Delete this message?')) return;
    try {
      await api(`messages/${messageId}`, { method: 'DELETE' });
      state.messages = state.messages.filter((m) => m.id !== messageId);
      renderMessages(false);
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  // ---------- composer ----------

  function onComposerKey(event) {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      $('#composer').requestSubmit();
    }
  }

  function onComposerInput(event) {
    const input = event.currentTarget;
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 180) + 'px';
    const now = Date.now();
    if (input.value.trim() && state.channel && now - state.lastTypingSent > TYPING_SEND_MS) {
      state.lastTypingSent = now;
      api(`channels/${state.channel.id}/typing`, { method: 'POST' }).catch(() => {});
    }
  }

  function takeFile(file) {
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) return toast('Files can be at most 25 MB.', 'error');
    if (!ALLOWED_FILES.test(file.type)) return toast('That file type is not allowed.', 'error');
    state.pendingFile = file;
    renderPending();
    $('#message-input')?.focus();
  }

  function renderPending() {
    const box = $('#pending');
    if (!box) return;
    if (!state.pendingFile) {
      box.hidden = true;
      box.replaceChildren();
      return;
    }
    box.hidden = false;
    box.replaceChildren(
      el('span', { class: 'pending-name', text: `${state.pendingFile.name} · ${formatBytes(state.pendingFile.size)}` }),
      el('button', { class: 'ghost small', type: 'button', onclick: () => { state.pendingFile = null; renderPending(); } }, 'Remove'));
  }

  async function sendMessage(event) {
    event.preventDefault();
    if (state.busy || !state.channel) return;
    const input = $('#message-input');
    const content = input.value.trim();
    if (!content && !state.pendingFile) return;

    state.busy = true;
    $('#send').disabled = true;
    try {
      let fileId = null;
      if (state.pendingFile) {
        const file = state.pendingFile;
        const { file: uploaded } = await api(`channels/${state.channel.id}/files`, {
          method: 'POST',
          rawBody: file,
          headers: { 'Content-Type': file.type, 'X-File-Name': encodeURIComponent(file.name) },
        });
        fileId = uploaded.id;
      }
      const { message } = await api(`channels/${state.channel.id}/messages`, {
        method: 'POST',
        body: { content, fileId },
      });
      message._enter = true;
      state.messages.push(message);
      state.pendingFile = null;
      input.value = '';
      input.style.height = '';
      renderPending();
      renderMessages(true);
      delete message._enter;
      // Bot replies arrive on the next poll.
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      state.busy = false;
      $('#send').disabled = false;
      $('#message-input')?.focus();
    }
  }

  // ---------- start ----------

  // Keyboard shortcuts
  document.addEventListener('keydown', (event) => {
    const tag = (event.target && event.target.tagName) || '';
    const typing = tag === 'INPUT' || tag === 'TEXTAREA' || event.target?.isContentEditable;
    if (event.key === 'Escape') {
      closeMobileNav();
      return;
    }
    if (!typing && (event.key === '/' || (event.key === 'k' && (event.ctrlKey || event.metaKey)))) {
      event.preventDefault();
      const input = $('#message-input');
      if (input) {
        input.focus();
        const len = input.value.length;
        input.setSelectionRange(len, len);
      }
    }
  });

  async function init() {
    try {
      const { user } = await api('me');
      state.me = user;
      await loadApp();
    } catch {
      renderAuth('login');
    }
  }

  init();
})();
