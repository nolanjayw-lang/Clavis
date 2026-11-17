
// ==========================================
// EASYMAIL - STANDALONE JAVASCRIPT (script.js)
// ==========================================

// 1. STATE & CONFIGURATIE
let emails = [];
let currentCategory = 'all';
let currentFolder = 'inbox';
let selectedEmailId = null;
let tokenClient = null;
let googleAccessToken = null;

// Saved data uit LocalStorage
let savedNotes = localStorage.getItem('easymail_notes') || '';
let savedTodos = JSON.parse(localStorage.getItem('easymail_todos') || '[]');
let savedClientId = localStorage.getItem('easymail_client_id') || '';

// Category styling
const CATEGORY_META = {
  school:     { label: 'School',     color: '#38bdf8' },
  security:   { label: 'Security',   color: '#ef4444' },
  business:   { label: 'Business',   color: '#3b82f6' },
  personal:   { label: 'Personal',   color: '#22c55e' },
  promotions: { label: 'Promotions', color: '#f59e0b' },
  spam:       { label: 'Spam',       color: '#a855f7' }
};

// 2. AI CLASSIFICATIE ENGINE
function classifyEmail(sender, subject, snippet) {
  const text = `${sender} ${subject} ${snippet}`.toLowerCase();

  const rules = [
    {
      category: 'school',
      keywords: ['magister', 'somtoday', 'school', 'docent', 'huiswerk', 'opdracht', 'toets', 'cijfer', 'rooster', 'studie', 'klas', 'les', 'examen', 'canvas', 'teams']
    },
    {
      category: 'security',
      keywords: ['beveiliging', 'security', 'wachtwoord', 'password', 'verificatie', '2fa', 'code', 'inlogpoging', 'login', 'account', 'waarschuwing', 'alert']
    },
    {
      category: 'spam',
      keywords: ['gewonnen', 'winnaar', 'gratis geld', 'prijs', 'loterij', 'crypto', 'urgent actie', 'klik hier nu', 'bitcoin', 'miljoen', 'verdien snel']
    },
    {
      category: 'promotions',
      keywords: ['korting', 'sale', 'aanbieding', 'deal', 'actie', 'nieuwsbrief', 'unsubscribe', 'uitschrijven', 'procent', '%', 'webshop', 'bestelling']
    },
    {
      category: 'business',
      keywords: ['factuur', 'invoice', 'offerte', 'vergadering', 'meeting', 'project', 'contract', 'klant', 'collega', 'zakelijk', 'rapport', 'deadline', 'stage']
    }
  ];

  for (const rule of rules) {
    if (rule.keywords.some(word => text.includes(word))) {
      return rule.category;
    }
  }

  return 'personal'; // Standaard categorie als niets anders matcht
}

// 3. GMAIL OAUTH 2.0 KOPPELING (VOOR GITHUB PAGES)
function startGmailOAuth() {
  const clientIdInput = document.getElementById('oauth-client-id');
  const clientId = clientIdInput ? clientIdInput.value.trim() : savedClientId;

  if (!clientId) {
    alert('Vul eerst een geldige Google OAuth Client ID in!');
    return;
  }

  localStorage.setItem('easymail_client_id', clientId);
  savedClientId = clientId;

  if (typeof google === 'undefined' || !google.accounts) {
    alert('Google Identity Services script is nog niet geladen. Controleer je internetverbinding.');
    return;
  }

  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: 'https://www.googleapis.com/auth/gmail.readonly',
    callback: async (tokenResponse) => {
      if (tokenResponse && tokenResponse.access_token) {
        googleAccessToken = tokenResponse.access_token;
        updateApiStatus(true);
        await fetchFirstTenGmailMessages(googleAccessToken);
      }
    }
  });

  tokenClient.requestAccessToken({ prompt: 'consent' });
}

async function fetchFirstTenGmailMessages(accessToken) {
  const listContainer = document.getElementById('email-list');
  if (listContainer) {
    listContainer.innerHTML = `<div style="padding: 40px; text-align: center; color: #888;">Bezig met ophalen en AI-sorteren van je eerste 10 mails...</div>`;
  }

  try {
    // Stap 1: Haal de ID's van de eerste 10 inbox berichten op
    const listRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=10&labelIds=INBOX', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const listData = await listRes.json();

    if (!listData.messages || listData.messages.length === 0) {
      emails = [];
      renderEmails();
      return;
    }

    // Stap 2: Haal de details van elk bericht op
    const loadedEmails = await Promise.all(
      listData.messages.map(async (msg) => {
        const msgRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=full`, {
          headers: { Authorization: `Bearer ${accessToken}` }
        });
        const detail = await msgRes.json();
        return parseGmailMessage(detail);
      })
    );

    emails = loadedEmails;
    renderEmails();
    updateCounts();

  } catch (error) {
    console.error('Fout bij ophalen van Gmail:', error);
    alert('Er ging iets mis bij het ophalen van je mails. Bekijk de console (F12) voor details.');
  }
}

function parseGmailMessage(detail) {
  const headers = detail.payload?.headers || [];
  const getHeader = (name) => {
    const found = headers.find(h => h.name.toLowerCase() === name.toLowerCase());
    return found ? found.value : '';
  };

  const rawFrom = getHeader('From') || 'Onbekend';
  const senderMatch = rawFrom.match(/^"?([^"<]+)"?\s*</);
  const sender = senderMatch ? senderMatch[1].trim() : rawFrom.split('@')[0];
  const subject = getHeader('Subject') || '(Geen onderwerp)';
  const snippet = detail.snippet || '';
  const dateObj = new Date(parseInt(detail.internalDate, 10));
  const dateStr = isNaN(dateObj) ? 'Vandaag' : dateObj.toLocaleDateString('nl-NL', { day: '2-digit', month: 'short' });

  // Automatisch categoriseren met onze AI-functie
  const category = classifyEmail(sender, subject, snippet);

  return {
    id: detail.id,
    sender,
    senderEmail: rawFrom,
    subject,
    snippet,
    body: snippet,
    date: dateStr,
    category,
    folder: 'inbox',
    unread: (detail.labelIds || []).includes('UNREAD')
  };
}

// 4. UI RENDERING & FILTERING
function renderEmails() {
  const listContainer = document.getElementById('email-list');
  if (!listContainer) return;

  const searchInput = document.getElementById('search-input');
  const query = searchInput ? searchInput.value.toLowerCase().trim() : '';

  const filtered = emails.filter(mail => {
    const matchesFolder = mail.folder === currentFolder;
    const matchesCategory = currentCategory === 'all' || mail.category === currentCategory;
    const matchesSearch = !query ||
      mail.sender.toLowerCase().includes(query) ||
      mail.subject.toLowerCase().includes(query) ||
      mail.snippet.toLowerCase().includes(query);

    return matchesFolder && matchesCategory && matchesSearch;
  });

  if (filtered.length === 0) {
    listContainer.innerHTML = `
      <div style="padding: 60px 20px; text-align: center; color: #71717a;">
        <p style="font-size: 16px; margin-bottom: 8px;">Geen e-mails gevonden in deze weergave</p>
        <p style="font-size: 13px;">Koppel je Gmail-account of voeg een testmail toe om te beginnen.</p>
      </div>
    `;
    return;
  }

  listContainer.innerHTML = filtered.map(mail => {
    const meta = CATEGORY_META[mail.category] || CATEGORY_META.personal;
    return `
      <div class="email-row ${mail.unread ? 'unread' : ''}" onclick="openEmail('${mail.id}')">
        <div class="email-sender">${escapeHtml(mail.sender)}</div>
        <div class="email-content">
          <span class="badge" style="background:${meta.color}20; color:${meta.color}; border:1px solid ${meta.color}40;">
            ${meta.label}
          </span>
          <span class="email-subject">${escapeHtml(mail.subject)}</span>
          <span class="email-snippet"> — ${escapeHtml(mail.snippet)}</span>
        </div>
        <div class="email-date">${escapeHtml(mail.date)}</div>
      </div>
    `;
  }).join('');
}

function updateCounts() {
  const inboxMails = emails.filter(m => m.folder === 'inbox');
  const allBadge = document.getElementById('count-all');
  if (allBadge) allBadge.textContent = inboxMails.length;

  Object.keys(CATEGORY_META).forEach(cat => {
    const el = document.getElementById(`count-${cat}`);
    if (el) {
      el.textContent = inboxMails.filter(m => m.category === cat).length;
    }
  });
}

function setCategory(category) {
  currentCategory = category;
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.category === category);
  });
  renderEmails();
}

function setFolder(folder) {
  currentFolder = folder;
  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.toggle('active', item.dataset.folder === folder);
  });
  renderEmails();
}

// 5. E-MAIL OPENEN & TESTMAIL TOEVOEGEN
function openEmail(id) {
  const mail = emails.find(m => m.id === id);
  if (!mail) return;

  mail.unread = false;
  selectedEmailId = id;
  renderEmails();

  const reader = document.getElementById('email-reader');
  if (reader) {
    const meta = CATEGORY_META[mail.category] || CATEGORY_META.personal;
    reader.style.display = 'flex';
    reader.innerHTML = `
      <div class="reader-card">
        <div class="reader-header">
          <div>
            <span class="badge" style="background:${meta.color}20; color:${meta.color};">${meta.label}</span>
            <h2 style="margin: 10px 0 4px;">${escapeHtml(mail.subject)}</h2>
            <small style="color:#a1a1aa;">Van: ${escapeHtml(mail.senderEmail)} • ${escapeHtml(mail.date)}</small>
          </div>
          <button onclick="closeReader()" class="btn-secondary">Sluiten ✕</button>
        </div>
        <div class="reader-body">${escapeHtml(mail.body)}</div>
      </div>
    `;
  }
}

function closeReader() {
  const reader = document.getElementById('email-reader');
  if (reader) reader.style.display = 'none';
  selectedEmailId = null;
}

function addTestEmail(sender, subject, snippet) {
  const category = classifyEmail(sender, subject, snippet);
  emails.unshift({
    id: 'mail_' + Date.now(),
    sender,
    senderEmail: `${sender.toLowerCase().replace(/\s+/g, '')}@voorbeeld.nl`,
    subject,
    snippet,
    body: snippet,
    date: 'Zojuist',
    category,
    folder: 'inbox',
    unread: true
  });
  updateCounts();
  renderEmails();
}

// 6. THEMA SWITCHER & STATUS
function setTheme(themeName) {
  document.body.setAttribute('data-theme', themeName);
  localStorage.setItem('easymail_theme', themeName);
}

function updateApiStatus(connected) {
  const statusEl = document.getElementById('gmail-status');
  if (statusEl) {
    statusEl.textContent = connected ? 'Verbonden met Gmail' : 'Niet verbonden';
    statusEl.style.color = connected ? '#22c55e' : '#ef4444';
  }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// 7. INITIALISATIE BIJ OPSTARTEN
document.addEventListener('DOMContentLoaded', () => {
  const savedTheme = localStorage.getItem('easymail_theme') || 'black';
  setTheme(savedTheme);

  const clientIdInput = document.getElementById('oauth-client-id');
  if (clientIdInput && savedClientId) {
    clientIdInput.value = savedClientId;
  }

  const searchInput = document.getElementById('search-input');
  if (searchInput) {
    searchInput.addEventListener('input', renderEmails);
  }

  // Ondersteuning voor Google Apps Script (als je Code.gs gebruikt)
  if (typeof google !== 'undefined' && google.script) {
    google.script.run
      .withSuccessHandler((gmailList) => {
        emails = gmailList.map(m => ({
          id: m.id,
          sender: m.sender,
          senderEmail: m.senderEmail,
          subject: m.subject,
          snippet: m.snippet,
          body: m.body,
          date: m.date,
          category: classifyEmail(m.sender, m.subject, m.snippet),
          folder: 'inbox',
          unread: m.isUnread
        }));
        updateCounts();
        renderEmails();
      })
      .getFirstTenEmails();
  }

  updateCounts();
  renderEmails();
});
