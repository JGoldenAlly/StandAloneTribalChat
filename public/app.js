'use strict';

// ── State ────────────────────────────────────────────────
const STORAGE_KEY = 'tribal-chat.sessions.v2';
const THEME_KEY   = 'tribal-chat.theme';
let sessions = [];
let activeSessionIndex = 0;
let isLoading = false;
let displayName = 'You';
let authToken = null;

/** @type {Map<string, import('chart.js').Chart>} */
const chartInstances = new Map();

// ── Chart color palette ──────────────────────────────────
const CHART_COLORS = [
  'rgba(59,130,246,0.75)',
  'rgba(16,185,129,0.75)',
  'rgba(245,158,11,0.75)',
  'rgba(239,68,68,0.75)',
  'rgba(139,92,246,0.75)',
  'rgba(236,72,153,0.75)',
  'rgba(20,184,166,0.75)',
  'rgba(251,146,60,0.75)',
];

function generateColors(count) {
  return Array.from({ length: count }, (_, i) => CHART_COLORS[i % CHART_COLORS.length]);
}

// ── Theme ────────────────────────────────────────────────
function applyTheme(theme) {
  document.documentElement.classList.toggle('light-mode', theme === 'light');
  const btn = document.getElementById('btn-theme');
  if (btn) btn.textContent = theme === 'light' ? '🌙' : '☀️';
}

function toggleTheme() {
  const next = document.documentElement.classList.contains('light-mode') ? 'dark' : 'light';
  localStorage.setItem(THEME_KEY, next);
  applyTheme(next);
}

// ── JWT helpers ──────────────────────────────────────────
function getTokenFromUrl() {
  return new URLSearchParams(window.location.search).get('token') || null;
}

function decodeJwt(token) {
  try {
    const b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64.padEnd(b64.length + (4 - (b64.length % 4)) % 4, '=');
    return JSON.parse(atob(padded));
  } catch (e) {
    console.warn('JWT decode failed:', e);
    return null;
  }
}

// ── Session helpers ──────────────────────────────────────
function generateSessionId() {
  return `tribal-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function loadSessions() {
  // Try server first so sessions are shared across devices
  if (authToken) {
    try {
      const res = await fetch('/api/sessions', {
        headers: { 'Authorization': `Bearer ${authToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        sessions = Array.isArray(data) ? data : [];
        // Keep localStorage in sync as a local cache
        localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
        return;
      }
    } catch (e) {
      console.warn('Server session load failed, falling back to localStorage:', e);
    }
  }
  // Fallback: localStorage (offline or no token)
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    sessions = Array.isArray(stored) ? stored : [];
  } catch {
    sessions = [];
  }
}

function saveSessions() {
  // Always write localStorage synchronously (instant local persistence / offline cache)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
  // Fire-and-forget to server — callers don't need to await this
  if (authToken) {
    fetch('/api/sessions', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`,
      },
      body: JSON.stringify(sessions),
    }).catch(e => console.warn('Server session save failed:', e));
  }
}

function createNewSession() {
  const session = {
    sessionId: generateSessionId(),
    label: 'New Chat',
    createdAt: new Date().toISOString(),
    messages: [],
  };
  sessions.unshift(session);
  activeSessionIndex = 0;
  saveSessions();
  renderSessionList();
  renderMessages();
  updateControls();
  scrollToBottom();
}

function switchSession(index) {
  activeSessionIndex = index;
  renderSessionList();
  renderMessages();
  updateControls();
  scrollToBottom();
}

function deleteSession(index, event) {
  event.stopPropagation();
  sessions.splice(index, 1);
  if (sessions.length === 0) {
    createNewSession();
    return;
  }
  if (activeSessionIndex >= sessions.length) {
    activeSessionIndex = sessions.length - 1;
  }
  saveSessions();
  renderSessionList();
  renderMessages();
  updateControls();
}

function clearCurrentSession() {
  sessions[activeSessionIndex].messages = [];
  sessions[activeSessionIndex].label = 'New Chat';
  saveSessions();
  renderSessionList();
  renderMessages();
  updateControls();
}

// ── Markdown rendering ───────────────────────────────────
marked.setOptions({ gfm: true, breaks: true });

const MD_ALLOWED_TAGS = [
  'p', 'br', 'strong', 'em', 'code', 'pre', 'ul', 'ol', 'li',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote',
  'table', 'thead', 'tbody', 'tr', 'th', 'td',
  'a', 'hr', 'del', 'ins',
];

function renderMarkdown(text) {
  const raw = marked.parse(text);
  return DOMPurify.sanitize(raw, {
    ALLOWED_TAGS: MD_ALLOWED_TAGS,
    ALLOWED_ATTR: ['href', 'title', 'target', 'rel'],
  });
}

// ── Chart rendering ──────────────────────────────────────
function renderChart(container, chartData, msgId) {
  if (chartInstances.has(msgId)) {
    chartInstances.get(msgId).destroy();
    chartInstances.delete(msgId);
  }

  container.innerHTML = '';

  if (chartData.title) {
    const titleEl = document.createElement('div');
    titleEl.className = 'chart-title';
    titleEl.textContent = chartData.title;
    container.appendChild(titleEl);
  }

  const canvas = document.createElement('canvas');
  container.appendChild(canvas);

  const type = chartData.type || 'bar';
  const isPolar = type === 'pie' || type === 'doughnut' || type === 'polarArea';

  const instance = new Chart(canvas, {
    type,
    data: {
      labels: chartData.labels || [],
      datasets: (chartData.datasets || []).map(ds => ({
        ...ds,
        backgroundColor: ds.backgroundColor ?? generateColors(
          isPolar ? (chartData.labels || []).length : (ds.data || []).length
        ),
        borderColor: ds.borderColor ?? (isPolar ? 'rgba(0,0,0,0.2)' : 'rgba(96,165,250,1)'),
        borderWidth: ds.borderWidth ?? 1,
      })),
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: {
          labels: { color: '#9ca3af', font: { size: 12 } },
        },
        title: { display: false },
      },
      scales: isPolar ? {} : {
        x: {
          ticks: { color: '#9ca3af', font: { size: 11 } },
          grid: { color: '#2d3748' },
        },
        y: {
          ticks: {
            color: '#9ca3af',
            font: { size: 11 },
            callback: (v) => typeof v === 'number' && Math.abs(v) >= 1000
              ? v.toLocaleString()
              : v,
          },
          grid: { color: '#2d3748' },
        },
      },
    },
  });

  chartInstances.set(msgId, instance);
}

// ── DOM rendering ────────────────────────────────────────
function renderSessionList() {
  const list = document.getElementById('session-list');
  list.innerHTML = '';
  sessions.forEach((session, i) => {
    const item = document.createElement('div');
    item.className = 'session-item' + (i === activeSessionIndex ? ' active' : '');
    item.addEventListener('click', () => switchSession(i));

    const label = document.createElement('span');
    label.className = 'session-label';
    label.textContent = session.label;

    const del = document.createElement('button');
    del.className = 'session-delete';
    del.title = 'Delete session';
    del.textContent = '×';
    del.addEventListener('click', (e) => deleteSession(i, e));

    item.appendChild(label);
    item.appendChild(del);
    list.appendChild(item);
  });
}

function renderMessages() {
  // Destroy all chart instances before re-building DOM
  chartInstances.forEach(c => c.destroy());
  chartInstances.clear();

  const chatWindow = document.getElementById('chat-window');
  const session = sessions[activeSessionIndex];
  const msgs = session?.messages ?? [];

  // Update topbar title
  document.getElementById('topbar-title').textContent = session?.label ?? 'New Chat';

  if (msgs.length === 0) {
    chatWindow.innerHTML = '<div class="ai-empty">Ask a question to get started.</div>';
    return;
  }

  chatWindow.innerHTML = '';

  msgs.forEach((msg, i) => {
    const bubble = document.createElement('div');
    bubble.className = `ai-bubble bubble-${msg.role}`;

    const roleEl = document.createElement('div');
    roleEl.className = 'bubble-role';
    roleEl.textContent = msg.role === 'user' ? displayName : 'Tribal';

    const textEl = document.createElement('div');
    textEl.className = 'bubble-text';
    if (msg.role === 'user') {
      // Plain text for user messages — no HTML injection risk
      textEl.textContent = msg.content;
    } else {
      textEl.innerHTML = renderMarkdown(msg.content || '');
    }

    const timeEl = document.createElement('div');
    timeEl.className = 'bubble-time';
    timeEl.textContent = new Date(msg.timestamp).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });

    bubble.appendChild(roleEl);
    bubble.appendChild(textEl);

    if (msg.role === 'assistant' && msg.chartData) {
      const chartContainer = document.createElement('div');
      chartContainer.className = 'chart-container';
      bubble.appendChild(chartContainer);
      const msgId = `${session.sessionId}-${i}`;
      renderChart(chartContainer, msg.chartData, msgId);
    }

    bubble.appendChild(timeEl);
    chatWindow.appendChild(bubble);
  });
}

function appendThinkingBubble() {
  const chatWindow = document.getElementById('chat-window');
  // Remove the empty state placeholder if present
  const empty = chatWindow.querySelector('.ai-empty');
  if (empty) empty.remove();

  const bubble = document.createElement('div');
  bubble.id = 'thinking-bubble';
  bubble.className = 'ai-bubble bubble-assistant bubble-loading';
  bubble.innerHTML = '<div class="bubble-role">Tribal</div><div class="bubble-text"><div class="thinking-dots"><span></span><span></span><span></span></div></div>';
  chatWindow.appendChild(bubble);
  scrollToBottom();
}

function removeThinkingBubble() {
  const bubble = document.getElementById('thinking-bubble');
  if (bubble) bubble.remove();
}

function updateControls() {
  const hasMessages = (sessions[activeSessionIndex]?.messages?.length ?? 0) > 0;
  document.getElementById('btn-clear').disabled = !hasMessages || isLoading;
  document.getElementById('send-btn').disabled = isLoading;
  document.getElementById('message-input').disabled = isLoading;
}

function scrollToBottom() {
  setTimeout(() => {
    const chatWindow = document.getElementById('chat-window');
    chatWindow.scrollTop = chatWindow.scrollHeight;
  }, 0);
}

// ── Chart extraction from output text ────────────────────
// n8n sometimes embeds the chart JSON at the start of the output string
// rather than (or in addition to) sending it as a separate field.
// This function extracts it and returns the cleaned text separately.
function extractChartFromOutput(output) {
  if (!output) return { text: output, chartData: null };

  const trimmed = output.trim();
  if (!trimmed.startsWith('{')) return { text: output, chartData: null };

  // Walk the string to find the closing brace of the top-level object
  let depth = 0;
  let end = -1;
  for (let i = 0; i < trimmed.length; i++) {
    if (trimmed[i] === '{') depth++;
    else if (trimmed[i] === '}') {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }

  if (end === -1) return { text: output, chartData: null };

  try {
    const json = JSON.parse(trimmed.slice(0, end + 1));
    // Only treat it as chart data if it has the expected chart shape
    if (json.datasets && Array.isArray(json.datasets)) {
      const remainder = trimmed.slice(end + 1).trim();
      return { text: remainder || output, chartData: json };
    }
  } catch {
    // Not valid JSON — leave output as-is
  }

  return { text: output, chartData: null };
}

// ── Send message ─────────────────────────────────────────
async function sendMessage() {
  const input = document.getElementById('message-input');
  const text = input.value.trim();
  if (!text || isLoading) return;

  const webhookUrl = window.TRIBAL_CONFIG?.webhookUrl;
  if (!webhookUrl) {
    alert('Chat is not configured: WEBHOOK_URL is missing.');
    return;
  }

  // Push user message immediately
  const userMsg = {
    role: 'user',
    content: text,
    timestamp: new Date().toISOString(),
  };
  sessions[activeSessionIndex].messages.push(userMsg);

  if (sessions[activeSessionIndex].label === 'New Chat') {
    sessions[activeSessionIndex].label = text.length > 40 ? text.slice(0, 40) + '…' : text;
  }

  input.value = '';
  isLoading = true;
  saveSessions();
  renderSessionList();
  updateControls();
  renderMessages();
  appendThinkingBubble();

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: displayName,
        chatInput: text,
        sessionId: sessions[activeSessionIndex].sessionId,
      }),
    });

    if (!response.ok) {
      throw new Error(`Webhook responded with HTTP ${response.status}`);
    }

    const data = await response.json();
    const first = Array.isArray(data) ? data[0] : data;

    let outputText = first.output ?? 'No response received.';
    let chartData = first.chartData ?? null;

    // n8n may embed the chart JSON at the start of the output string.
    // Extract it and strip it from the displayed text in either case.
    const extracted = extractChartFromOutput(outputText);
    if (extracted.chartData) {
      outputText = extracted.text;
      if (!chartData) chartData = extracted.chartData;
    }

    sessions[activeSessionIndex].messages.push({
      role: 'assistant',
      content: outputText,
      timestamp: new Date().toISOString(),
      chartData,
    });
  } catch (err) {
    console.error('Chat error:', err);
    sessions[activeSessionIndex].messages.push({
      role: 'assistant',
      content: 'Sorry, something went wrong reaching the AI assistant. Please try again.',
      timestamp: new Date().toISOString(),
      chartData: null,
    });
  } finally {
    isLoading = false;
    saveSessions();
    removeThinkingBubble();
    renderMessages();
    updateControls();
    scrollToBottom();
    setTimeout(() => input.focus(), 0);
  }
}

// ── Init ─────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  // Extract and decode JWT from URL
  authToken = getTokenFromUrl();
  if (authToken) {
    const payload = decodeJwt(authToken);
    displayName = payload?.displayName?.split(' ')[0] ?? 'You';
  }

  // Load sessions (server first, localStorage fallback)
  await loadSessions();
  if (sessions.length === 0) {
    createNewSession();
  } else {
    renderSessionList();
    renderMessages();
    updateControls();
    scrollToBottom();
  }

  // Apply saved theme (default: dark)
  applyTheme(localStorage.getItem(THEME_KEY) || 'dark');

  // Event listeners
  document.getElementById('btn-theme').addEventListener('click', toggleTheme);
  document.getElementById('btn-new-chat').addEventListener('click', createNewSession);

  document.getElementById('btn-clear').addEventListener('click', clearCurrentSession);

  document.getElementById('composer').addEventListener('submit', (e) => {
    e.preventDefault();
    sendMessage();
  });

  document.getElementById('message-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  // Auto-resize textarea as user types
  document.getElementById('message-input').addEventListener('input', (e) => {
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 180) + 'px';
  });
});
