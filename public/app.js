(() => {
  'use strict';

  // ---------- constants ----------

  const LIMITS = {
    file: 25 * 1024 * 1024,
    image: 5 * 1024 * 1024,
    emoji: 512 * 1024,
    message: 2000,
  };
  const POLL_MS = 2000;
  const REFRESH_EVERY_POLLS = 15;
  const GROUP_MS = 7 * 60 * 1000;
  const TYPING_SEND_MS = 4000;
  const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
  const FILE_TYPES = /^(image\/(png|jpeg|gif|webp)|audio\/(mpeg|ogg|wav|webm|mp4|flac)|video\/(mp4|webm)|application\/pdf|text\/plain|application\/zip)$/;
  const COLORS = ['#e11d2e', '#5865f2', '#22c55e', '#f59e0b', '#ec4899', '#06b6d4', '#8b5cf6', '#14b8a6'];
  const FRAMES = [
    ['none', 'None'], ['ring', 'Ring'], ['neon', 'Neon'], ['flame', 'Flame'], ['gold', 'Gold'], ['aurora', 'Aurora'],
  ];

  // Icons are static SVG paths (Lucide style). Only trusted strings are placed in innerHTML.
  const ICONS = {
    plus: '<path d="M12 5v14M5 12h14"/>',
    hash: '<path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
    bot: '<rect x="4" y="8" width="16" height="12" rx="3"/><path d="M12 4v4M9 14h.01M15 14h.01"/>',
    smile: '<circle cx="12" cy="12" r="9"/><path d="M8.5 14.5s1.3 2 3.5 2 3.5-2 3.5-2M9 9.5h.01M15 9.5h.01"/>',
    paperclip: '<path d="M21 11.5 12.5 20a5 5 0 0 1-7-7L14 4.5a3.5 3.5 0 0 1 5 5L10.5 18a2 2 0 0 1-3-3L15 7.5"/>',
    send: '<path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z"/>',
    copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M4 16V4a2 2 0 0 1 2-2h12"/>',
    pencil: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/>',
    trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    eyeoff: '<path d="M17.9 17.9A10.8 10.8 0 0 1 12 19C5 19 2 12 2 12a18.5 18.5 0 0 1 5.1-5.9M9.9 4.2A10.9 10.9 0 0 1 12 4c7 0 10 8 10 8a18.5 18.5 0 0 1-2.2 3.2M1 1l22 22"/>',
    crown: '<path d="M3 8l4 4 5-7 5 7 4-4-2 11H5z"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    chevron: '<path d="m6 9 6 6 6-6"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
    zap: '<path d="M13 2 3 14h9l-1 8 10-12h-9z"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
    globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20z"/>',
    alert: '<circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>',
    loader: '<path d="M21 12a9 9 0 1 1-6.2-8.55"/>',
  };

  function icon(name, extra = '') {
    const span = document.createElement('span');
    span.className = 'ico ' + extra;
    span.setAttribute('aria-hidden', 'true');
    span.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ''}</svg>`;
    return span;
  }

  // ---------- state ----------

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
    authMode: 'login',
    navToken: 0,
    pollTimer: null,
    polls: 0,
    busy: false,
    lastTypingSent: 0,
    closePopover: null,
    pendingInvite: null,
  };

  // ---------- helpers ----------

  const $ = (selector, root = document) => root.querySelector(selector);

  function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (value === null || value === undefined || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key === 'dataset') Object.assign(node.dataset, value);
      else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
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
    let res;
    try {
      res = await fetch('api/' + path, init);
    } catch {
      throw new Error('Network error. Check your connection and try again.');
    }
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

  const colorFor = (name) => {
    let hash = 0;
    for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
    return COLORS[hash % COLORS.length];
  };

  const fileUrl = (id) => `api/files/${encodeURIComponent(id)}`;

  function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  function timeLabel(timestamp) {
    return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function dayLabel(timestamp) {
    const date = new Date(timestamp);
    const today = new Date();
    const yesterday = new Date(Date.now() - 86400000);
    if (date.toDateString() === today.toDateString()) return 'Today';
    if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return date.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  }

  function toast(text, kind = '') {
    const node = el('div', { class: 'toast ' + kind, role: 'status' }, icon(kind === 'error' ? 'alert' : kind === 'ok' ? 'check' : 'zap'), el('span', { text }));
    document.body.append(node);
    setTimeout(() => node.classList.add('leaving'), 2900);
    setTimeout(() => node.remove(), 3300);
  }

  function avatar(author, size = '') {
    const frame = author.frame && author.frame !== 'none' ? ` frame-${author.frame}` : '';
    const node = el('span', { class: `avatar ${size}${frame}`.trim() });
    if (author.avatar) {
      node.append(el('img', { src: fileUrl(author.avatar), alt: '', loading: 'lazy' }));
    } else {
      node.style.background = `linear-gradient(145deg, ${colorFor(author.username)}, ${colorFor(author.username)}bb)`;
      node.append(author.username[0].toUpperCase());
    }
    return node;
  }

  // Text is inserted as text nodes. Links, :emoji: names and mentions become elements.
  function richText(text) {
    const fragment = document.createDocumentFragment();
    const pattern = /(https?:\/\/[^\s<>"']+)|:([a-z0-9_]{2,32}):|(@[A-Za-z0-9_.-]{3,24})/gi;
    let last = 0;
    let match;
    while ((match = pattern.exec(text))) {
      if (match.index > last) fragment.append(text.slice(last, match.index));
      if (match[1]) {
        fragment.append(el('a', { href: match[1], target: '_blank', rel: 'noopener noreferrer' }, match[1]));
      } else if (match[2]) {
        const emoji = state.emojiByName.get(match[2].toLowerCase());
        if (emoji) {
          fragment.append(el('img', {
            class: 'emoji', src: fileUrl(emoji.fileId), alt: `:${emoji.name}:`,
            title: `:${emoji.name}: from ${emoji.serverName}`, loading: 'lazy',
          }));
        } else {
          fragment.append(match[0]);
        }
      } else {
        fragment.append(el('span', { class: 'mention' }, match[3]));
      }
      last = match.index + match[0].length;
    }
    if (last < text.length) fragment.append(text.slice(last));
    return fragment;
  }

  function linkCards(text) {
    const urls = [...new Set(text.match(/https?:\/\/[^\s<>"']+/g) || [])].slice(0, 2);
    return urls.map((url) => {
      let host = url;
      let path = '';
      try {
        const parsed = new URL(url);
        host = parsed.hostname.replace(/^www\./, '');
        path = (parsed.pathname + parsed.search).slice(0, 90);
      } catch {
        // keep the raw text
      }
      return el('a', { class: 'link-card', href: url, target: '_blank', rel: 'noopener noreferrer' },
        icon('globe', 'link-ico'),
        el('span', { class: 'link-text' },
          el('span', { class: 'link-host', text: host }),
          path ? el('span', { class: 'link-path', text: path }) : null));
    });
  }

  // ---------- modal, popover, lightbox ----------

  function showModal(content, { wide = false, label = 'Dialog' } = {}) {
    const close = () => {
      document.removeEventListener('keydown', onKey);
      overlay.classList.add('leaving');
      setTimeout(() => overlay.remove(), 160);
    };
    const onKey = (event) => { if (event.key === 'Escape') close(); };
    const panel = el('div', { class: 'modal' + (wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': label });
    const overlay = el('div', { class: 'overlay', onclick: (event) => { if (event.target === overlay) close(); } }, panel);
    panel.append(...[content(close)].flat());
    document.addEventListener('keydown', onKey);
    document.body.append(overlay);
    return { close, panel };
  }

  // Opens a popover under an anchor element. Returns a close function.
  function popover(anchor, children, { width = 260, className = '' } = {}) {
    closePopovers();
    const rect = anchor.getBoundingClientRect();
    const node = el('div', { class: 'popover ' + className, role: 'menu' }, children);
    document.body.append(node);
    const left = Math.min(Math.max(12, rect.left), window.innerWidth - width - 12);
    node.style.width = width + 'px';
    node.style.left = left + 'px';
    node.style.bottom = (window.innerHeight - rect.top + 10) + 'px';
    const onDown = (event) => { if (!node.contains(event.target) && !anchor.contains(event.target)) close(); };
    const onKey = (event) => { if (event.key === 'Escape') close(); };
    function close() {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey);
      node.remove();
      if (state.closePopover === close) state.closePopover = null;
    }
    setTimeout(() => {
      document.addEventListener('pointerdown', onDown, true);
      document.addEventListener('keydown', onKey);
    }, 0);
    state.closePopover = close;
    return close;
  }

  function closePopovers() {
    if (state.closePopover) state.closePopover();
  }

  function openLightbox(url, name) {
    showModal(() => [
      el('img', { class: 'lightbox-img', src: url, alt: name || 'Image' }),
      el('div', { class: 'lightbox-bar' },
        el('span', { class: 'muted', text: name || '' }),
        el('a', { class: 'ghost-link', href: url, download: name || '', rel: 'noopener' }, icon('download'), ' Download')),
    ], { label: name || 'Image' });
  }

  // ---------- auth ----------

  async function renderAuth(mode = state.authMode) {
    stopPolling();
    state.authMode = mode;
    const isLogin = mode === 'login';
    const error = el('p', { class: 'form-error', id: 'auth-error', role: 'alert' });
    const submit = el('button', { class: 'btn-primary wide', type: 'submit' }, isLogin ? 'Log in' : 'Create account');
    const password = el('input', {
      name: 'password', type: 'password', required: true, minlength: 8, maxlength: 200,
      autocomplete: isLogin ? 'current-password' : 'new-password', placeholder: 'At least 8 characters',
    });
    const toggle = el('button', { class: 'eye', type: 'button', 'aria-label': 'Show password', onclick: () => {
      const showing = password.type === 'text';
      password.type = showing ? 'password' : 'text';
      toggle.replaceChildren(icon(showing ? 'eye' : 'eyeoff'));
    } }, icon('eye'));

    const form = el('form', {
      class: 'auth-form',
      onsubmit: async (event) => {
        event.preventDefault();
        error.textContent = '';
        submit.disabled = true;
        submit.replaceChildren(icon('loader', 'spin'), ' Working…');
        try {
          const data = await api(`auth/${mode}`, {
            method: 'POST',
            body: { username: form.username.value.trim(), password: password.value },
          });
          state.me = data.user;
          await loadApp();
        } catch (err) {
          error.textContent = err.message;
          form.classList.remove('shake');
          void form.offsetWidth;
          form.classList.add('shake');
          submit.disabled = false;
          submit.replaceChildren(isLogin ? 'Log in' : 'Create account');
        }
      },
    },
      el('label', {}, 'Username',
        el('input', { name: 'username', autocomplete: 'username', required: true, minlength: 3, maxlength: 24, placeholder: 'your_name' })),
      el('label', {}, 'Password', el('div', { class: 'input-wrap' }, password, toggle)),
      error,
      submit);

    const diagnostic = el('div', { class: 'diagnostic', id: 'diagnostic', hidden: true });
    fetch('api/health', { credentials: 'same-origin' })
      .then((res) => res.json())
      .then((data) => {
        if (data.ok) return;
        diagnostic.hidden = false;
        diagnostic.replaceChildren(
          icon('alert'),
          el('div', {},
            el('strong', { text: 'Setup needed' }),
            el('p', { text: data.database }),
            data.storage && data.storage !== 'configured' ? el('p', { text: `Files: ${data.storage}` }) : null));
      })
      .catch(() => {});

    $('#app').replaceChildren(
      el('main', { class: 'auth' },
        el('div', { class: 'auth-glow', 'aria-hidden': 'true' }),
        el('section', { class: 'auth-brand' },
          el('div', { class: 'brand-mark' }, icon('hash')),
          el('h1', { text: 'Hellcord' }),
          el('p', { text: 'Servers, channels, bots and files in one place.' }),
          el('ul', { class: 'feature-list' },
            el('li', {}, icon('users'), 'Servers with invite codes'),
            el('li', {}, icon('bot'), 'Bots with commands and AI replies'),
            el('li', {}, icon('image'), 'Images, audio, video and files'))),
        el('section', { class: 'auth-card' },
          el('div', { class: 'segmented', role: 'tablist' },
            el('button', { class: isLogin ? 'on' : '', role: 'tab', 'aria-selected': isLogin, onclick: () => renderAuth('login') }, 'Log in'),
            el('button', { class: !isLogin ? 'on' : '', role: 'tab', 'aria-selected': !isLogin, onclick: () => renderAuth('register') }, 'Create account')),
          el('h2', { text: isLogin ? 'Welcome back' : 'Create your account' }),
          el('p', { class: 'muted', text: isLogin ? 'Log in to continue to your servers.' : 'Pick a username and a password to get started.' }),
          diagnostic,
          form,
          el('p', { class: 'auth-foot muted small', text: isLogin ? 'New here? Switch to Create account above.' : 'Already registered? Switch to Log in above.' }))));
    setTimeout(() => form.username?.focus(), 50);
  }

  async function logout() {
    try {
      await api('auth/logout', { method: 'POST' });
    } catch {
      // the server clears the cookie; the UI signs out either way
    }
    Object.assign(state, { me: null, meProfile: null, servers: [], server: null, channel: null, messages: [], pendingFile: null });
    stopPolling();
    renderAuth('login');
  }

  // ---------- app shell ----------

  async function loadApp() {
    const [{ servers }, { user }] = await Promise.all([api('servers'), api(`users/${state.me.id}`)]);
    state.meProfile = user;
    state.servers = servers;
    renderShell();
    if (servers.length) await openServer(servers[0].id);
    else renderEmpty();
    if (state.pendingInvite) {
      const code = state.pendingInvite;
      state.pendingInvite = null;
      history.replaceState(null, '', location.pathname);
      openJoinServer(code);
    }
  }

  function renderShell() {
    $('#app').replaceChildren(
      el('div', { class: 'hc-app', id: 'shell' },
        el('div', { class: 'drawer-backdrop', onclick: closeDrawers }),
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
      el('div', { class: 'empty-state' },
        el('div', { class: 'brand-mark big' }, icon('hash')),
        el('h2', { text: 'Start with a server' }),
        el('p', { class: 'muted', text: 'Create a server for your group, or join one with an invite code.' }),
        el('div', { class: 'row' },
          el('button', { class: 'btn-primary', onclick: openCreateServer }, icon('plus'), 'Create server'),
          el('button', { class: 'btn-ghost', onclick: openJoinServer }, icon('link'), 'Join with invite'))));
  }

  function renderRail() {
    const rail = $('#rail');
    if (!rail) return;
    rail.replaceChildren(
      el('div', { class: 'server-btn home', title: 'Hellcord' }, icon('hash')),
      el('div', { class: 'rail-sep' }),
      ...state.servers.map((server) => el('button', {
        class: 'server-btn' + (state.server && state.server.id === server.id ? ' active' : ''),
        title: server.name, 'aria-label': server.name,
        style: { background: `linear-gradient(145deg, ${colorFor(server.name)}, ${colorFor(server.name)}aa)` },
        onclick: () => openServer(server.id),
      }, server.name.slice(0, 2).toUpperCase())),
      el('button', { class: 'server-btn add', title: 'Create a server', 'aria-label': 'Create a server', onclick: openCreateServer }, icon('plus')),
      el('button', { class: 'server-btn add', title: 'Join with invite', 'aria-label': 'Join with invite', onclick: openJoinServer }, icon('link')));
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
        el('div', { class: 'side-title' },
          el('strong', { text: state.server.name }),
          state.owner ? icon('crown', 'owner-crown') : null),
        el('button', {
          class: 'icon-btn', title: 'Server menu', 'aria-label': 'Server menu',
          onclick: (event) => openServerMenu(event.currentTarget),
        }, icon('chevron'))),
      el('div', { class: 'side-section' },
        el('span', { class: 'label', text: 'Text channels' }),
        state.owner ? el('button', { class: 'icon-btn small', title: 'Create channel', 'aria-label': 'Create channel', onclick: openCreateChannel }, icon('plus')) : null),
      el('ul', { class: 'channels', role: 'list' },
        state.channels.map((channel) => el('li', {},
          el('button', {
            class: 'channel' + (state.channel && state.channel.id === channel.id ? ' active' : ''),
            onclick: () => openChannel(channel.id),
          }, icon('hash', 'channel-ico'), el('span', { text: channel.name }))))),
      el('footer', { class: 'user-bar' },
        el('button', { class: 'user-card', title: 'Edit your profile', onclick: openProfileSettings },
          el('span', { class: 'presence' }, avatar({ username: state.me.username, avatar: me.avatar, frame: me.frame }, 'small')),
          el('span', { class: 'user-meta' },
            el('span', { class: 'user-name', text: state.me.username }),
            el('span', { class: 'user-status', text: 'Online' }))),
        el('button', { class: 'icon-btn', title: 'Log out', 'aria-label': 'Log out', onclick: logout }, icon('logout'))));
  }

  function openServerMenu(anchor) {
    const items = [
      el('button', { class: 'menu-item', role: 'menuitem', onclick: () => { closePopovers(); openInvites(); } }, icon('link'), 'Invites'),
      el('button', { class: 'menu-item', role: 'menuitem', onclick: () => { closePopovers(); openBotStudio(); } }, icon('bot'), 'Bots'),
      el('button', { class: 'menu-item', role: 'menuitem', onclick: () => { closePopovers(); openEmojiManager(); } }, icon('smile'), 'Emojis'),
    ];
    if (state.owner) {
      items.push(el('button', { class: 'menu-item', role: 'menuitem', onclick: () => { closePopovers(); openCreateChannel(); } }, icon('hash'), 'Create channel'));
    }
    popover(anchor, items, { width: 230, className: 'menu' });
  }

  function renderChat() {
    const chat = $('#chat');
    if (!chat) return;
    if (!state.channel) {
      chat.replaceChildren(el('div', { class: 'empty-state' }, el('p', { class: 'muted', text: 'Pick a channel to start talking.' })));
      return;
    }
    const membersToggle = el('button', {
      class: 'icon-btn', title: 'Toggle members', 'aria-label': 'Toggle members',
      onclick: () => $('#shell')?.classList.toggle('show-members'),
    }, icon('users'));
    chat.replaceChildren(
      el('header', { class: 'chat-head' },
        el('button', { class: 'icon-btn nav-toggle', 'aria-label': 'Show channels', onclick: () => $('#shell')?.classList.toggle('nav-open') }, icon('menu')),
        el('span', { class: 'chan-title' }, icon('hash', 'chan-hash'), el('strong', { text: state.channel.name })),
        el('div', { class: 'head-actions' },
          el('button', { class: 'btn-ghost sm', onclick: openBotStudio }, icon('bot'), el('span', { class: 'hide-sm', text: 'Bots' })),
          el('button', { class: 'btn-ghost sm', onclick: openEmojiManager }, icon('smile'), el('span', { class: 'hide-sm', text: 'Emojis' })),
          membersToggle)),
      el('div', { class: 'messages', id: 'messages', role: 'log', 'aria-live': 'polite' }),
      el('div', { class: 'typing', id: 'typing', hidden: true }),
      el('form', { class: 'composer', id: 'composer', onsubmit: sendMessage },
        el('div', { class: 'pending', id: 'pending', hidden: true }),
        el('div', { class: 'composer-row' },
          el('label', { class: 'icon-btn attach', title: 'Attach a file', 'aria-label': 'Attach a file' },
            icon('paperclip'),
            el('input', {
              type: 'file', hidden: true,
              accept: 'image/*,audio/*,video/*,application/pdf,text/plain,application/zip',
              onchange: (event) => { takeFile(event.currentTarget.files[0]); event.currentTarget.value = ''; },
            })),
          el('textarea', {
            id: 'message-input', rows: 1, maxlength: LIMITS.message,
            placeholder: `Message #${state.channel.name}`, 'aria-label': 'Message',
            onkeydown: onComposerKey, oninput: onComposerInput,
          }),
          el('button', { class: 'icon-btn', title: 'Emoji', 'aria-label': 'Emoji', type: 'button', onclick: (event) => openEmojiPicker(event.currentTarget) }, icon('smile')),
          el('button', { class: 'send-btn', type: 'submit', id: 'send', 'aria-label': 'Send message' }, icon('send'))),
        el('p', { class: 'composer-hint muted small', text: 'Enter to send · Shift+Enter for a new line · Drop files anywhere in the chat' })));

    chat.ondragover = (event) => { event.preventDefault(); chat.classList.add('dropping'); };
    chat.ondragleave = (event) => { if (!chat.contains(event.relatedTarget)) chat.classList.remove('dropping'); };
    chat.ondrop = (event) => {
      event.preventDefault();
      chat.classList.remove('dropping');
      takeFile(event.dataTransfer?.files?.[0]);
    };
    $('#messages').addEventListener('click', toggleMessageActions);
    renderPending();
    renderTyping();
    renderMessages(true);
  }

  function renderMembers() {
    const aside = $('#members');
    if (!aside) return;
    const humans = state.members.filter((m) => !m.bot);
    const bots = state.members.filter((m) => m.bot);
    const row = (member) => el('li', { class: 'member' },
      el('span', { class: 'presence' }, avatar(member, 'small')),
      el('span', { class: 'member-name', text: member.username }),
      state.server && member.id === state.server.owner_id ? icon('crown', 'owner-crown') : null);
    aside.replaceChildren(
      el('h3', { class: 'label', text: `Members — ${humans.length}` }),
      el('ul', { class: 'member-list', role: 'list' }, humans.map(row)),
      bots.length ? el('h3', { class: 'label', text: `Bots — ${bots.length}` }) : null,
      bots.length ? el('ul', { class: 'member-list', role: 'list' }, bots.map(row)) : null);
  }

  // ---------- servers and channels ----------

  async function openServer(serverId) {
    const token = ++state.navToken;
    const data = await api(`servers/${serverId}`);
    if (token !== state.navToken) return;
    state.server = data.server;
    state.owner = data.server.owner_id === state.me.id;
    state.channels = data.channels;
    state.members = data.members;
    renderRail();
    renderSidebar();
    renderMembers();
    const first = data.channels[0];
    if (first) await openChannel(first.id);
    else {
      state.channel = null;
      renderChat();
    }
  }

  async function openChannel(channelId) {
    stopPolling();
    closePopovers();
    const token = ++state.navToken;
    state.channel = state.channels.find((c) => c.id === channelId) || null;
    state.messages = [];
    state.typing = [];
    state.pendingFile = null;
    state.editing = null;
    renderSidebar();
    renderChat();
    $('#shell')?.classList.remove('nav-open');
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
      if (!current || (state.server && emoji.serverId === state.server.id)) state.emojiByName.set(emoji.name, emoji);
    }
  }

  function simpleForm({ title, label, placeholder, submitLabel, onSubmit }) {
    showModal((close) => {
      const input = el('input', { required: true, maxlength: 40, autocomplete: 'off', 'aria-label': label, placeholder: placeholder || '' });
      const error = el('p', { class: 'form-error', role: 'alert' });
      setTimeout(() => input.focus(), 30);
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
          el('button', { class: 'btn-ghost', type: 'button', onclick: close }, 'Cancel'),
          el('button', { class: 'btn-primary', type: 'submit' }, submitLabel)));
    }, { label: title });
  }

  function openCreateServer() {
    simpleForm({
      title: 'Create a server', label: 'Server name', placeholder: 'My community', submitLabel: 'Create',
      onSubmit: async (name) => {
        const { server } = await api('servers', { method: 'POST', body: { name } });
        state.servers = (await api('servers')).servers;
        await openServer(server.id);
        renderRail();
        toast(`${server.name} is ready`, 'ok');
      },
    });
  }

  // ---------- invites ----------

  const INVITE_STATUS_LABEL = { active: 'Active', expired: 'Expired', 'used-up': 'Used up', revoked: 'Revoked' };

  function inviteUrl(code) {
    return `${location.origin}${location.pathname}?invite=${encodeURIComponent(code)}`;
  }

  // Accepts a bare code or a full invite link.
  function parseInviteCode(text) {
    const value = String(text || '').trim();
    const match = value.match(/[?&]invite=([A-Za-z0-9_-]{4,64})/);
    if (match) return match[1];
    return value.split(/[/?#]/).filter(Boolean).pop() || '';
  }

  function expiryText(expiresAt) {
    if (!expiresAt) return 'Never expires';
    const hours = Math.round((expiresAt - Date.now()) / 3600000);
    if (hours <= 0) return 'Expired';
    if (hours < 48) return `Expires in ${hours} h`;
    return `Expires in ${Math.round(hours / 24)} days`;
  }

  function statusPill(status) {
    return el('span', { class: `status status-${status}` }, INVITE_STATUS_LABEL[status] || status);
  }

  function copyLink(code, legacy) {
    const text = legacy ? code : inviteUrl(code);
    navigator.clipboard?.writeText(text)
      .then(() => toast(legacy ? 'Invite code copied' : 'Invite link copied', 'ok'))
      .catch(() => toast(text));
  }

  function closeDrawers() {
    $('#shell')?.classList.remove('nav-open', 'show-members');
  }

  function openJoinServer(prefill = '') {
    showModal((close) => {
      let confirmed = '';
      const input = el('input', { maxlength: 300, autocomplete: 'off', 'aria-label': 'Invite code or link', placeholder: 'Paste an invite code or link' });
      input.value = prefill || '';
      const preview = el('div', { class: 'invite-preview', hidden: true });
      const error = el('p', { class: 'form-error', role: 'alert' });
      const submit = el('button', { class: 'btn-primary', type: 'submit' }, 'Look up invite');

      const showPreview = (invite) => {
        const canJoin = invite.status === 'active' || invite.joined;
        preview.hidden = false;
        preview.replaceChildren(
          el('span', { class: 'label', text: 'Invite found' }),
          el('h3', { text: invite.serverName }),
          el('div', { class: 'invite-meta' },
            el('span', { text: `${invite.members} member${invite.members === 1 ? '' : 's'}` }),
            statusPill(invite.status),
            invite.maxUses ? el('span', { text: `${invite.uses}/${invite.maxUses} uses` }) : null,
            el('span', { text: expiryText(invite.expiresAt) })),
          invite.joined ? el('p', { class: 'muted small', text: 'You are already a member of this server.' }) : null,
          canJoin ? null : el('p', { class: 'form-error', text: 'This invite can no longer be used.' }));
        submit.textContent = invite.joined ? 'Open server' : canJoin ? 'Join server' : 'Look up another';
      };

      const form = el('form', {
        class: 'stack',
        onsubmit: async (event) => {
          event.preventDefault();
          error.textContent = '';
          const wanted = parseInviteCode(input.value);
          if (!wanted) {
            error.textContent = 'Paste an invite code or link.';
            return;
          }
          submit.disabled = true;
          try {
            if (wanted !== confirmed) {
              const { invite } = await api(`invites/${encodeURIComponent(wanted)}`);
              confirmed = wanted;
              showPreview(invite);
              return;
            }
            const { server, alreadyMember } = await api('servers/join', { method: 'POST', body: { invite: confirmed } });
            state.servers = (await api('servers')).servers;
            await openServer(server.id);
            renderRail();
            toast(alreadyMember ? `Opened ${server.name}` : `Joined ${server.name}`, 'ok');
            close();
          } catch (err) {
            error.textContent = err.message;
          } finally {
            submit.disabled = false;
          }
        },
      },
        el('h2', { text: 'Join a server' }),
        el('p', { class: 'muted small', text: 'Paste an invite code or the full invite link.' }),
        el('label', {}, 'Invite', input),
        preview,
        error,
        el('div', { class: 'dialog-actions' },
          el('button', { class: 'btn-ghost', type: 'button', onclick: close }, 'Cancel'),
          submit));
      setTimeout(() => input.focus(), 30);
      return form;
    }, { label: 'Join a server' });
  }

  function openInvites() {
    if (!state.server) return;
    const serverId = state.server.id;
    showModal((close) => {
      const list = el('div', { class: 'invite-list' });
      const output = el('div');
      const maxUses = el('select', { 'aria-label': 'Maximum uses' },
        [['0', 'No limit'], ['1', '1 use'], ['5', '5 uses'], ['10', '10 uses'], ['50', '50 uses']]
          .map(([value, label]) => el('option', { value }, label)));
      const expires = el('select', { 'aria-label': 'Expires after' },
        [['1', '1 hour'], ['24', '1 day'], ['168', '7 days'], ['0', 'Never']]
          .map(([value, label]) => el('option', { value, selected: value === '168' }, label)));

      const reload = async () => {
        const { invites } = await api(`servers/${serverId}/invites`);
        list.replaceChildren(...(invites.length
          ? invites.map((invite) => inviteRow(invite))
          : [el('p', { class: 'muted small', text: 'No invites yet. Create one above.' })]));
      };

      const inviteRow = (invite) => el('div', { class: 'invite-row' },
        el('div', {},
          el('div', { class: 'invite-meta' },
            el('span', { class: 'invite-code', text: invite.legacy ? 'Permanent code' : invite.code }),
            statusPill(invite.status)),
          el('div', { class: 'invite-meta' },
            el('span', { text: `by ${invite.createdBy}` }),
            el('span', { text: invite.maxUses ? `${invite.uses}/${invite.maxUses} uses` : `${invite.uses} uses` }),
            el('span', { text: expiryText(invite.expiresAt) }))),
        el('div', { class: 'invite-actions' },
          el('button', { class: 'icon-btn', title: 'Copy link', 'aria-label': 'Copy link', onclick: () => copyLink(invite.code, invite.legacy) }, icon('copy')),
          invite.status === 'active' && !invite.legacy && (invite.mine || state.owner)
            ? el('button', {
              class: 'icon-btn danger', title: 'Revoke', 'aria-label': 'Revoke invite',
              onclick: async () => {
                try {
                  await api(`invites/${encodeURIComponent(invite.code)}`, { method: 'DELETE' });
                  toast('Invite revoked', 'ok');
                  await reload();
                } catch (err) {
                  toast(err.message, 'error');
                }
              },
            }, icon('x'))
            : null));

      const create = async (event) => {
        event.preventDefault();
        try {
          const { invite } = await api(`servers/${serverId}/invites`, {
            method: 'POST',
            body: { maxUses: Number(maxUses.value) || null, expiresInHours: Number(expires.value) || null },
          });
          output.replaceChildren(el('div', { class: 'invite-link' },
            el('input', { readonly: true, value: inviteUrl(invite.code), 'aria-label': 'Invite link', onfocus: (e) => e.currentTarget.select() }),
            el('button', { class: 'btn-primary', type: 'button', onclick: () => copyLink(invite.code, false) }, icon('copy'), 'Copy')));
          await reload();
        } catch (err) {
          toast(err.message, 'error');
        }
      };

      reload().catch((err) => toast(err.message, 'error'));
      return el('div', { class: 'invites' },
        el('h2', { text: `Invites · ${state.server.name}` }),
        el('p', { class: 'muted small', text: 'Anyone with the link can join until it expires or runs out of uses.' }),
        el('form', { class: 'invite-form', onsubmit: create },
          el('label', {}, 'Max uses', maxUses),
          el('label', {}, 'Expires', expires),
          el('button', { class: 'btn-primary', type: 'submit' }, icon('plus'), 'Create link')),
        output,
        el('h3', { text: 'Invites' }),
        list,
        el('div', { class: 'dialog-actions' },
          el('button', { class: 'btn-ghost', type: 'button', onclick: close }, 'Done')));
    }, { wide: true, label: 'Invites' });
  }

  function openCreateChannel() {
    simpleForm({
      title: 'Create a channel', label: 'Channel name', placeholder: 'announcements', submitLabel: 'Create',
      onSubmit: async (name) => {
        await api(`servers/${state.server.id}/channels`, { method: 'POST', body: { name } });
        state.channels = (await api(`servers/${state.server.id}`)).channels;
        renderSidebar();
        toast('Channel created', 'ok');
      },
    });
  }

  function copyInvite() {
    navigator.clipboard?.writeText(state.server.invite_code)
      .then(() => toast('Invite code copied', 'ok'))
      .catch(() => toast(`Invite code: ${state.server.invite_code}`));
  }

  // ---------- profile ----------

  async function openProfile(userId) {
    const { user } = await api(`users/${userId}`);
    showModal(() => {
      const banner = el('div', { class: 'profile-banner', style: user.banner ? {} : { background: user.bannerColor } });
      if (user.banner) banner.style.backgroundImage = `url("${fileUrl(user.banner)}")`;
      return [
        banner,
        el('div', { class: 'profile-body' },
          el('div', { class: 'profile-avatar' }, avatar(user, 'xl')),
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
    if (file.size > LIMITS.image) return toast('Images can be at most 5 MB.', 'error');
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
      const bio = el('textarea', { maxlength: 190, rows: 3, 'aria-label': 'Bio', placeholder: 'Tell people about yourself' });
      bio.value = user.bio || '';
      const color = el('input', { type: 'color', value: user.bannerColor, 'aria-label': 'Banner color' });
      const frame = el('select', { 'aria-label': 'Avatar frame' },
        FRAMES.map(([value, label]) => el('option', { value, selected: value === user.frame }, label)));
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
        el('p', { class: 'muted small', text: 'Visible to everyone in your servers.' }),
        el('label', {}, 'Bio', bio),
        el('div', { class: 'row-split' },
          el('label', { class: 'grow' }, 'Banner color', color),
          el('label', { class: 'grow' }, 'Avatar frame', frame)),
        el('div', { class: 'row-split' },
          el('label', { class: 'grow' }, 'Avatar image',
            el('input', { type: 'file', accept: IMAGE_TYPES.join(','), onchange: (e) => uploadProfileImage('avatar', e.currentTarget.files[0]) })),
          el('label', { class: 'grow' }, 'Banner image',
            el('input', { type: 'file', accept: IMAGE_TYPES.join(','), onchange: (e) => uploadProfileImage('banner', e.currentTarget.files[0]) }))),
        el('div', { class: 'dialog-actions' },
          el('button', { class: 'btn-ghost', type: 'button', onclick: close }, 'Cancel'),
          el('button', { class: 'btn-primary', type: 'submit' }, 'Save profile')));
    }, { wide: true, label: 'Your profile' });
  }

  // ---------- bots ----------

  function showTokenOnce(token, container) {
    container.replaceChildren(
      el('div', { class: 'token-box' },
        el('p', { class: 'warn', text: 'Copy this token now. It will not be shown again.' }),
        el('code', { class: 'token', text: token }),
        el('button', {
          class: 'btn-ghost sm', type: 'button',
          onclick: () => navigator.clipboard?.writeText(token).then(() => toast('Token copied', 'ok')),
        }, icon('copy'), 'Copy token')));
  }

  async function openBotStudio() {
    let { bots } = await api('bots');
    let current = bots[0] || null;
    let newMode = false;
    const modal = showModal(() => [], { wide: true, label: 'Bot studio' });

    const refresh = async () => {
      bots = (await api('bots')).bots;
      current = bots.find((b) => current && b.id === current.id) || (newMode ? null : bots[0] || null);
      draw();
    };

    const draw = () => {
      const { panel } = modal;
      const list = el('aside', { class: 'studio-list' },
        bots.map((bot) => el('button', {
          class: 'studio-item' + (current && current.id === bot.id ? ' active' : ''),
          onclick: () => { current = bot; newMode = false; draw(); },
        }, avatar({ username: bot.username, avatar: bot.avatar }, 'small'), el('span', { text: bot.username }))),
        el('button', { class: 'btn-ghost', onclick: () => { current = null; newMode = true; draw(); } }, icon('plus'), 'New bot'));
      panel.replaceChildren(
        el('div', { class: 'studio-head' },
          el('div', {},
            el('h2', { text: 'Bot studio' }),
            el('p', { class: 'muted small', text: 'Bots answer @mentions and their own /commands.' })),
          el('button', { class: 'icon-btn', 'aria-label': 'Close', onclick: modal.close }, icon('x'))),
        el('div', { class: 'studio' }, list, el('section', { class: 'studio-main' }, current && !newMode ? botEditor(current) : newBotForm())));
    };

    const newBotForm = () => {
      const name = el('input', { maxlength: 24, required: true, 'aria-label': 'Bot name', placeholder: 'HelperBot' });
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
            newMode = false;
            toast('Bot created', 'ok');
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
        el('button', { class: 'btn-primary', type: 'submit' }, icon('bot'), 'Create bot'),
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
      const cmdName = el('input', { maxlength: 24, 'aria-label': 'Command name', placeholder: 'ping' });
      const cmdResponse = el('input', { maxlength: 1000, 'aria-label': 'Command response', placeholder: 'pong {user} {args}' });

      return el('div', { class: 'editor' },
        el('div', { class: 'editor-head' },
          avatar({ username: bot.username, avatar: bot.avatar }, 'large'),
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
          el('div', { class: 'row-split' },
            el('label', { class: 'grow' }, 'Mode', mode)),
          el('label', {}, 'Personality (AI mode)', prompt),
          el('label', {}, 'Default reply', fallback),
          el('button', { class: 'btn-primary', type: 'submit' }, 'Save changes')),
        el('div', { class: 'row-split' },
          el('label', { class: 'grow' }, 'Bot avatar',
            el('input', {
              type: 'file', accept: IMAGE_TYPES.join(','),
              onchange: async (e) => {
                const file = e.currentTarget.files[0];
                if (!file || !IMAGE_TYPES.includes(file.type) || file.size > LIMITS.image) return toast('Use an image up to 5 MB.', 'error');
                try {
                  await api(`bots/${bot.id}/avatar`, { method: 'POST', rawBody: file, headers: { 'Content-Type': file.type } });
                  toast('Bot avatar updated', 'ok');
                  await refresh();
                } catch (err) {
                  toast(err.message, 'error');
                }
              },
            })),
          el('button', {
            class: 'btn-ghost', type: 'button',
            onclick: async () => {
              const { token } = await api(`bots/${bot.id}/token`, { method: 'POST' });
              showTokenOnce(token, tokenBox);
            },
          }, icon('zap'), 'Rotate token')),
        tokenBox,
        state.owner
          ? el('button', {
            class: 'btn-ghost', type: 'button',
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
          }, icon('plus'), `Add to ${state.server.name}`)
          : null,
        el('h3', { text: 'Commands' }),
        el('ul', { class: 'command-list' },
          bot.commands.length
            ? bot.commands.map((cmd) => el('li', {},
              el('code', { text: `/${cmd.name}` }),
              el('span', { class: 'muted', text: cmd.response }),
              el('button', {
                class: 'icon-btn small', type: 'button', title: 'Delete command', 'aria-label': `Delete /${cmd.name}`,
                onclick: async () => {
                  await api(`bots/${bot.id}/commands/${cmd.id}`, { method: 'DELETE' });
                  await refresh();
                },
              }, icon('trash'))))
            : el('li', { class: 'muted', text: 'No commands yet. Add one below.' })),
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
          el('button', { class: 'btn-primary sm', type: 'submit' }, 'Add command')));
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
                class: 'icon-btn small', title: 'Delete emoji', 'aria-label': `Delete :${emoji.name}:`,
                onclick: async () => {
                  await api(`emojis/${emoji.id}`, { method: 'DELETE' });
                  setEmojis((await api(`channels/${state.channel.id}/emojis`)).emojis);
                  renderMessages(false);
                  close();
                  toast('Emoji deleted', 'ok');
                },
              }, icon('trash'))
              : null))
          : el('li', { class: 'muted', text: 'No emojis yet. Upload one below.' }));
      return el('form', {
        class: 'stack',
        onsubmit: async (event) => {
          event.preventDefault();
          const picked = file.files[0];
          const label = name.value.trim().toLowerCase();
          if (!picked || !IMAGE_TYPES.includes(picked.type) || picked.size > LIMITS.emoji) {
            return toast('Use a PNG, JPEG, GIF or WebP image up to 512 KB.', 'error');
          }
          try {
            const { file: uploaded } = await api(`servers/${state.server.id}/emojis/upload`, {
              method: 'POST', rawBody: picked, headers: { 'Content-Type': picked.type },
            });
            await api(`servers/${state.server.id}/emojis`, { method: 'POST', body: { name: label, fileId: uploaded.id } });
            setEmojis((await api(`channels/${state.channel.id}/emojis`)).emojis);
            renderMessages(false);
            toast(`:${label}: added`, 'ok');
            close();
          } catch (err) {
            toast(err.message, 'error');
          }
        },
      },
        el('h2', { text: 'Emojis' }),
        el('p', { class: 'muted small', text: 'Write :name: in a message to use an emoji. Nitro members can use emojis from every server they belong to.' }),
        list,
        el('div', { class: 'row-split' },
          el('label', { class: 'grow' }, 'Name', name),
          el('label', { class: 'grow' }, 'Image', file)),
        el('div', { class: 'dialog-actions' },
          el('button', { class: 'btn-ghost', type: 'button', onclick: close }, 'Close'),
          el('button', { class: 'btn-primary', type: 'submit' }, 'Add emoji')));
    }, { wide: true, label: 'Emojis' });
  }

  function openEmojiPicker(anchor) {
    if (!state.emojis.length) return toast('No emojis yet. Add one from the Emojis panel.');
    const insert = (name) => {
      const input = $('#message-input');
      if (!input) return;
      const at = input.selectionStart ?? input.value.length;
      const text = `:${name}: `;
      input.value = input.value.slice(0, at) + text + input.value.slice(input.selectionEnd ?? at);
      input.focus();
      input.setSelectionRange(at + text.length, at + text.length);
      closePopovers();
    };
    popover(anchor, [
      el('div', { class: 'picker-grid' },
        state.emojis.map((emoji) => el('button', {
          class: 'picker-item', title: `:${emoji.name}: · ${emoji.serverName}`, 'aria-label': `:${emoji.name}:`,
          onclick: () => insert(emoji.name),
        }, el('img', { src: fileUrl(emoji.fileId), alt: '', loading: 'lazy' })))),
    ], { width: 300, className: 'picker' });
  }

  // ---------- messages ----------

  const isNearBottom = (list) => list.scrollHeight - list.scrollTop - list.clientHeight < 140;

  function renderMessages(scrollToEnd) {
    const list = $('#messages');
    if (!list) return;
    const stick = scrollToEnd || isNearBottom(list);
    if (!state.messages.length) {
      list.replaceChildren(el('div', { class: 'quiet-state' },
        el('div', { class: 'brand-mark' }, icon('hash')),
        el('h3', { text: `Welcome to #${state.channel.name}` }),
        el('p', { class: 'muted', text: 'This is the start of the channel. Say hi!' })));
      return;
    }
    const nodes = [];
    let previous = null;
    for (const message of state.messages) {
      const newDay = !previous || new Date(previous.created_at).toDateString() !== new Date(message.created_at).toDateString();
      if (newDay) nodes.push(el('div', { class: 'day-divider' }, el('span', { text: dayLabel(message.created_at) })));
      const compact = !newDay && previous
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
      el('button', { title: 'Copy text', 'aria-label': 'Copy text', onclick: () => copyText(message.content) }, icon('copy')),
      mine ? el('button', { title: 'Edit message', 'aria-label': 'Edit message', onclick: () => startEdit(message.id) }, icon('pencil')) : null,
      canDelete ? el('button', { class: 'danger', title: 'Delete message', 'aria-label': 'Delete message', onclick: () => deleteMessage(message.id) }, icon('trash')) : null);

    return el('article', { class: 'msg' + (compact ? ' compact' : '') + (message.author.bot ? ' is-bot' : ''), dataset: { id: message.id } },
      compact
        ? el('span', { class: 'time-gutter', text: timeLabel(message.created_at) })
        : el('button', { class: 'avatar-btn', title: `${message.author.username}'s profile`, onclick: () => openProfile(message.author.id) }, avatar(message.author)),
      el('div', { class: 'msg-body' },
        compact ? null : el('header', { class: 'msg-head' },
          el('button', { class: 'author', onclick: () => openProfile(message.author.id) }, message.author.username),
          message.author.bot ? el('span', { class: 'badge bot', text: 'BOT' }) : null,
          el('time', { datetime: new Date(message.created_at).toISOString(), title: new Date(message.created_at).toLocaleString() }, timeLabel(message.created_at))),
        editing ? editForm(message) : el('p', { class: 'msg-text' },
          richText(message.content),
          message.edited_at ? el('span', { class: 'edited', text: ' (edited)' }) : null),
        !editing && message.content ? linkCards(message.content) : null,
        message.file ? attachmentNode(message.file) : null),
      editing ? null : toolbar);
  }

  function toggleMessageActions(event) {
    if (event.target.closest('button, a, input, textarea, audio, video, img')) return;
    const message = event.target.closest('.msg');
    document.querySelectorAll('.msg.show-actions').forEach((node) => { if (node !== message) node.classList.remove('show-actions'); });
    message?.classList.toggle('show-actions');
  }

  function startEdit(messageId) {
    state.editing = messageId;
    renderMessages(false);
    document.querySelector(`.msg[data-id="${messageId}"] .edit-input`)?.focus();
  }

  function editForm(message) {
    const field = el('textarea', { class: 'edit-input', rows: 2, maxlength: LIMITS.message, 'aria-label': 'Edit message' });
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
    navigator.clipboard?.writeText(text).then(() => toast('Copied to clipboard', 'ok'))
      .catch(() => toast('Copy failed', 'error'));
  }

  function attachmentNode(file) {
    const url = fileUrl(file.id);
    if (file.mime.startsWith('image/')) {
      return el('button', { class: 'attach image', type: 'button', title: 'Open image', onclick: () => openLightbox(url, file.name) },
        el('img', { src: url, alt: file.name, loading: 'lazy' }));
    }
    if (file.mime.startsWith('audio/')) {
      return el('div', { class: 'attach audio' },
        el('span', { class: 'attach-name' }, icon('zap'), `${file.name} · ${formatBytes(file.size)}`),
        el('audio', { controls: true, preload: 'metadata', src: url }));
    }
    if (file.mime.startsWith('video/')) {
      return el('div', { class: 'attach video' }, el('video', { controls: true, preload: 'metadata', src: url }));
    }
    return el('a', { class: 'attach file', href: url, rel: 'noopener' },
      el('span', { class: 'file-ico' }, icon('download')),
      el('span', { class: 'file-meta' },
        el('strong', { text: file.name }),
        el('small', { class: 'muted', text: formatBytes(file.size) })));
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
    const label = names.length === 1 ? `${names[0]} is typing` : `${names.slice(0, 2).join(' and ')} are typing`;
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
    const full = state.polls % REFRESH_EVERY_POLLS === 0;
    try {
      const [messagesData, typingData] = await Promise.all([
        api(full ? `channels/${channelId}/messages` : `channels/${channelId}/messages?after=${lastId}`),
        api(`channels/${channelId}/typing`),
      ]);
      if (!state.channel || state.channel.id !== channelId) return;
      state.typing = typingData.typing;
      renderTyping();
      if (full) {
        state.messages = messagesData.messages;
        renderMessages(false);
        return;
      }
      const known = new Set(state.messages.map((m) => m.id));
      const fresh = messagesData.messages.filter((m) => !known.has(m.id));
      if (!fresh.length) return;
      state.messages.push(...fresh);
      renderMessages(false);
    } catch {
      // network hiccup: the next tick tries again
    }
  }

  async function deleteMessage(messageId) {
    if (!confirm('Delete this message?')) return;
    try {
      await api(`messages/${messageId}`, { method: 'DELETE' });
      state.messages = state.messages.filter((m) => m.id !== messageId);
      renderMessages(false);
      toast('Message deleted', 'ok');
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
    input.style.height = Math.min(input.scrollHeight, 200) + 'px';
    const now = Date.now();
    if (input.value.trim() && state.channel && now - state.lastTypingSent > TYPING_SEND_MS) {
      state.lastTypingSent = now;
      api(`channels/${state.channel.id}/typing`, { method: 'POST' }).catch(() => {});
    }
  }

  function takeFile(file) {
    if (!file) return;
    if (file.size > LIMITS.file) return toast('Files can be at most 25 MB.', 'error');
    if (!FILE_TYPES.test(file.type)) return toast('That file type is not allowed.', 'error');
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
      el('span', { class: 'file-ico small' }, icon('paperclip')),
      el('span', { class: 'pending-name', text: `${state.pendingFile.name} · ${formatBytes(state.pendingFile.size)}` }),
      el('button', { class: 'icon-btn small', type: 'button', 'aria-label': 'Remove file', onclick: () => { state.pendingFile = null; renderPending(); } }, icon('x')));
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
      state.messages.push(message);
      state.pendingFile = null;
      input.value = '';
      input.style.height = '';
      renderPending();
      renderMessages(true);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      state.busy = false;
      $('#send').disabled = false;
      $('#message-input')?.focus();
    }
  }

  // ---------- start ----------

  async function init() {
    const pending = new URLSearchParams(location.search).get('invite');
    if (pending) state.pendingInvite = pending;
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
