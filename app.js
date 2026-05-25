/* ============================================================
   ASSON VOTING SYSTEM — app.js
   Responsibilities:
     • Matric/Surname Supabase Auth
     • Load active elections, positions, candidates
     • Voting cart logic + cost calculation
     • Paystack payment popup
     • POST votes to Supabase after payment confirmation
   ============================================================ */

'use strict';

// ──────────────────────────────────────────────────────────────
// 1.  CONFIG & SUPABASE CLIENT (lightweight fetch wrapper)
// ──────────────────────────────────────────────────────────────
const CFG = window.ASSON_CONFIG;

/** Thin Supabase REST helper — no SDK dependency */
const sb = (() => {
  const base    = CFG.supabaseUrl;
  const headers = () => {
    const h = {
      'Content-Type':  'application/json',
      'apikey':        CFG.supabaseKey,
      'Prefer':        'return=representation',
    };
    const token = _session?.access_token;
    if (token) h['Authorization'] = `Bearer ${token}`;
    return h;
  };

  return {
    async get(path) {
      const r = await fetch(`${base}/rest/v1/${path}`, { headers: headers() });
      if (!r.ok) throw new Error((await r.json()).message || r.statusText);
      return r.json();
    },
    async post(table, body) {
      const r = await fetch(`${base}/rest/v1/${table}`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error((await r.json()).message || r.statusText);
      return r.json();
    },
    async auth(action, payload) {
      const r = await fetch(`${base}/auth/v1/${action}`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': CFG.supabaseKey },
        body:    JSON.stringify(payload),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error_description || data.msg || 'Auth error');
      return data;
    },
    async signOut() {
      await fetch(`${base}/auth/v1/logout`, {
        method:  'POST',
        headers: { 'apikey': CFG.supabaseKey, 'Authorization': `Bearer ${_session?.access_token}` },
      });
    },
  };
})();

// ──────────────────────────────────────────────────────────────
// 2.  STATE
// ──────────────────────────────────────────────────────────────
let _session       = JSON.parse(sessionStorage.getItem('asson_session') || 'null');
let _currentUser   = JSON.parse(sessionStorage.getItem('asson_user')    || 'null');
let _elections     = [];
let _activeElection = null;
let _positions     = [];
let _cart          = {};   // { candidateId: { candidate, qty } }

// ──────────────────────────────────────────────────────────────
// 3.  UTILITY HELPERS
// ──────────────────────────────────────────────────────────────
function showToast(msg, type = 'success') {
  const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.innerHTML = `<span class="toast-icon">${icons[type] || '📢'}</span><span>${msg}</span>`;
  document.getElementById('toastContainer').appendChild(el);
  setTimeout(() => {
    el.classList.add('out');
    el.addEventListener('animationend', () => el.remove());
  }, 4000);
}

function fmtCurrency(kobo) {
  return '₦' + (kobo / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 });
}

function fmtNaira(naira) {
  return '₦' + Number(naira).toLocaleString('en-NG', { minimumFractionDigits: 2 });
}

function getInitials(name = '') {
  return name.split(/\s+/).map(w => w[0]).join('').substring(0, 2).toUpperCase();
}

// ──────────────────────────────────────────────────────────────
// 4.  AUTH
// ──────────────────────────────────────────────────────────────
/**
 * Constructs:
 *   email    = matric.trim().toLowerCase() + "@asson.app"
 *   password = surname.trim().toUpperCase()
 */
function buildCredentials(matric, surname) {
  const email    = matric.trim().toLowerCase().replace(/\//g, '-') + CFG.dummyDomain;
  const password = surname.trim().toUpperCase();
  return { email, password };
}

async function login(matric, surname) {
  const { email, password } = buildCredentials(matric, surname);

  // Attempt sign-in first
  try {
    const data = await sb.auth('token?grant_type=password', { email, password });
    _session   = data;
    _currentUser = data.user;
    sessionStorage.setItem('asson_session', JSON.stringify(data));
    sessionStorage.setItem('asson_user',    JSON.stringify(data.user));
    return;
  } catch (_) {
    // User may not exist yet — auto-register them
  }

  // Auto-register (sign-up) with matric as display name
  const signupData = await sb.auth('signup', {
    email, password,
    data: { matric_number: matric.trim().toUpperCase(), full_name: surname.trim().toUpperCase() },
  });

  if (signupData.access_token) {
    // Email confirmation disabled (recommended for Supabase settings)
    _session     = signupData;
    _currentUser = signupData.user;
  } else {
    // Supabase requires email confirmation — sign in again
    const data = await sb.auth('token?grant_type=password', { email, password });
    _session     = data;
    _currentUser = data.user;
  }

  sessionStorage.setItem('asson_session', JSON.stringify(_session));
  sessionStorage.setItem('asson_user',    JSON.stringify(_currentUser));
}

async function logout() {
  try { await sb.signOut(); } catch (_) {}
  _session = null; _currentUser = null; _cart = {};
  sessionStorage.removeItem('asson_session');
  sessionStorage.removeItem('asson_user');
  showAuth();
}

// ──────────────────────────────────────────────────────────────
// 5.  SHOW / HIDE PAGES
// ──────────────────────────────────────────────────────────────
function showAuth() {
  document.getElementById('authPage').classList.remove('hidden');
  document.getElementById('votingPage').classList.add('hidden');
}

function showVoting() {
  document.getElementById('authPage').classList.add('hidden');
  document.getElementById('votingPage').classList.remove('hidden');
  populateHeader();
  loadElections();
}

function populateHeader() {
  const matric = _currentUser?.user_metadata?.matric_number || _currentUser?.email?.split('@')[0]?.toUpperCase() || '??';
  document.getElementById('headerName').textContent   = matric;
  document.getElementById('headerAvatar').textContent = getInitials(matric);
}

// ──────────────────────────────────────────────────────────────
// 6.  FETCH ELECTIONS / BALLOT DATA
// ──────────────────────────────────────────────────────────────
async function loadElections() {
  showLoader(true);
  try {
    const elections = await sb.get('elections?is_active=eq.true&order=created_at.desc');
    _elections = elections;

    if (!elections.length) {
      document.getElementById('heroTitle').textContent = 'No Active Elections';
      document.getElementById('heroSub').textContent   = 'There are no active voting sessions right now.';
      showLoader(false);
      return;
    }

    if (elections.length > 1) {
      // Show selector
      const sel = document.getElementById('electionSelect');
      sel.innerHTML = elections.map(e => `<option value="${e.id}">${e.title}</option>`).join('');
      document.getElementById('electionSelector').classList.remove('hidden');
      sel.addEventListener('change', () => loadBallot(sel.value));
    }

    loadBallot(elections[0].id);
  } catch (err) {
    showToast('Failed to load elections: ' + err.message, 'error');
    showLoader(false);
  }
}

async function loadBallot(electionId) {
  _activeElection = _elections.find(e => e.id === electionId);
  showLoader(true);
  _cart = {};
  renderCart();

  // Update hero
  document.getElementById('heroTitle').textContent = _activeElection?.title || 'Election';
  document.getElementById('heroSub').textContent   = _activeElection?.description || 'Cast your votes below.';
  document.getElementById('cartRate').textContent  = fmtNaira(_activeElection?.price_per_vote || 100) + ' / vote';

  try {
    // Fetch positions for this election
    const positions = await sb.get(`positions?election_id=eq.${electionId}&order=created_at.asc`);
    _positions = positions;

    if (!positions.length) {
      document.getElementById('positionsList').innerHTML = `
        <div class="page-loader">
          <span style="font-size:2rem">📭</span>
          <span>No categories have been added to this election yet.</span>
        </div>`;
      showLoader(false);
      document.getElementById('ballotContent').classList.remove('hidden');
      return;
    }

    // Fetch all candidates for these positions
    const posIds    = positions.map(p => `"${p.id}"`).join(',');
    const candidates = await sb.get(`candidates?position_id=in.(${posIds})&order=created_at.asc`);

    renderBallot(positions, candidates);
    showLoader(false);
    document.getElementById('ballotContent').classList.remove('hidden');
  } catch (err) {
    showToast('Failed to load ballot: ' + err.message, 'error');
    showLoader(false);
  }
}

function showLoader(show) {
  document.getElementById('ballotLoader').classList.toggle('hidden', !show);
  if (show) document.getElementById('ballotContent').classList.add('hidden');
}

// ──────────────────────────────────────────────────────────────
// 7.  RENDER BALLOT
// ──────────────────────────────────────────────────────────────
function renderBallot(positions, candidates) {
  const container = document.getElementById('positionsList');
  container.innerHTML = '';

  if (!positions.length) {
    container.innerHTML = '<p class="text-muted">No positions found.</p>';
    return;
  }

  positions.forEach(pos => {
    const posCandidates = candidates.filter(c => c.position_id === pos.id);

    const section = document.createElement('div');
    section.className = 'position-section';
    section.innerHTML = `
      <div class="section-label">
        <div class="section-label-bar"></div>
        <div>
          <div class="section-label-title">${escHtml(pos.title)}</div>
          ${pos.description ? `<div class="section-label-desc">${escHtml(pos.description)}</div>` : ''}
        </div>
      </div>
      <div class="grid-auto" id="pos-${pos.id}"></div>
    `;
    container.appendChild(section);

    const grid = section.querySelector(`#pos-${pos.id}`);
    posCandidates.forEach(c => {
      grid.appendChild(buildCandidateCard(c, pos));
    });

    if (!posCandidates.length) {
      grid.innerHTML = '<p class="text-muted text-sm">No candidates added yet.</p>';
    }
  });
}

function buildCandidateCard(candidate, position) {
  const card = document.createElement('div');
  card.className = 'candidate-card';
  card.dataset.candidateId = candidate.id;

  card.innerHTML = `
    <div class="candidate-photo-wrap">
      <img
        class="candidate-photo"
        src="${escHtml(candidate.photo_url)}"
        alt="${escHtml(candidate.name)}"
        loading="lazy"
        onerror="this.src='https://placehold.co/200x200/008751/ffffff?text=${encodeURIComponent(candidate.name[0])}'"
      />
    </div>
    <div class="candidate-info">
      <div class="candidate-name">${escHtml(candidate.name)}</div>
      <div class="candidate-pos">${escHtml(position.title)}</div>
      <div class="candidate-vote-row">
        <div class="qty-input" id="qty-wrap-${candidate.id}">
          <button class="qty-btn" data-action="dec" data-id="${candidate.id}">−</button>
          <input
            class="qty-number"
            id="qty-${candidate.id}"
            type="number"
            value="1"
            min="1"
            max="999"
            readonly
          />
          <button class="qty-btn" data-action="inc" data-id="${candidate.id}">+</button>
        </div>
        <button class="btn btn-primary btn-sm add-to-cart-btn" data-id="${candidate.id}">
          Add Vote
        </button>
      </div>
    </div>
  `;

  // Qty buttons
  card.querySelectorAll('.qty-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const input = document.getElementById(`qty-${id}`);
      let val = parseInt(input.value, 10) || 1;
      if (btn.dataset.action === 'inc') val = Math.min(999, val + 1);
      if (btn.dataset.action === 'dec') val = Math.max(1, val - 1);
      input.value = val;
    });
  });

  // Add to cart
  card.querySelector('.add-to-cart-btn').addEventListener('click', e => {
    e.stopPropagation();
    const qty = parseInt(document.getElementById(`qty-${candidate.id}`).value, 10) || 1;
    addToCart(candidate, position, qty);
    card.classList.add('selected');
  });

  return card;
}

// ──────────────────────────────────────────────────────────────
// 8.  CART LOGIC
// ──────────────────────────────────────────────────────────────
function addToCart(candidate, position, qty) {
  if (_cart[candidate.id]) {
    _cart[candidate.id].qty += qty;
  } else {
    _cart[candidate.id] = { candidate, position, qty };
  }
  renderCart();
  showToast(`${candidate.name} — ${qty} vote${qty > 1 ? 's' : ''} added to cart`, 'success');
}

function removeFromCart(candidateId) {
  delete _cart[candidateId];
  // Un-select the card
  const card = document.querySelector(`.candidate-card[data-candidate-id="${candidateId}"]`);
  if (card) card.classList.remove('selected');
  renderCart();
}

function renderCart() {
  const items    = Object.values(_cart);
  const isEmpty  = items.length === 0;
  const rate     = Number(_activeElection?.price_per_vote || 100);
  const totalQty = items.reduce((s, i) => s + i.qty, 0);
  const totalAmt = totalQty * rate;

  // Toggle empty state
  document.getElementById('cartEmpty').classList.toggle('hidden', !isEmpty);
  document.getElementById('cartSummaryWrap').classList.toggle('hidden', isEmpty);

  // Count label
  document.getElementById('cartCount').textContent = `${items.length} candidate${items.length !== 1 ? 's' : ''}`;

  // Render items
  const container = document.getElementById('cartItems');
  container.innerHTML = '';
  items.forEach(({ candidate, position, qty }) => {
    const div = document.createElement('div');
    div.className = 'cart-item';
    div.innerHTML = `
      <img class="cart-item-img" src="${escHtml(candidate.photo_url)}"
           alt="${escHtml(candidate.name)}"
           onerror="this.src='https://placehold.co/40x40/008751/ffffff?text=${encodeURIComponent(candidate.name[0])}'"/>
      <div class="cart-item-info">
        <div class="cart-item-name">${escHtml(candidate.name)}</div>
        <div class="cart-item-pos">${escHtml(position.title)}</div>
      </div>
      <div class="cart-item-qty">×${qty}</div>
      <button class="cart-remove" data-id="${candidate.id}" title="Remove">✕</button>
    `;
    div.querySelector('.cart-remove').addEventListener('click', () => removeFromCart(candidate.id));
    container.appendChild(div);
  });

  // Summary
  document.getElementById('cartTotalVotes').textContent = totalQty;
  document.getElementById('cartTotal').textContent      = fmtNaira(totalAmt);

  // Pay button
  const payBtn = document.getElementById('payBtn');
  payBtn.disabled = isEmpty;
  payBtn.textContent = isEmpty
    ? 'Pay & Vote'
    : `Pay ${fmtNaira(totalAmt)}`;
}

// ──────────────────────────────────────────────────────────────
// 9.  PAYSTACK PAYMENT
// ──────────────────────────────────────────────────────────────
function initiatePayment() {
  const items    = Object.values(_cart);
  if (!items.length) return;

  const rate     = Number(_activeElection?.price_per_vote || 100);
  const totalQty = items.reduce((s, i) => s + i.qty, 0);
  const totalNgn = totalQty * rate;
  const totalKobo= totalNgn * 100;   // Paystack uses kobo

  const email    = _session?.user?.email || `unknown${Date.now()}@asson.app`;
  const matric   = _currentUser?.user_metadata?.matric_number
                || _currentUser?.email?.split('@')[0]?.toUpperCase()
                || 'STUDENT';

  const handler = PaystackPop.setup({
    key:    CFG.paystackPubKey,
    email:  email,
    amount: totalKobo,
    currency: 'NGN',
    ref:    `ASSON-${Date.now()}-${Math.random().toString(36).substring(2,8).toUpperCase()}`,
    metadata: {
      custom_fields: [
        { display_name: 'Matric Number', variable_name: 'matric', value: matric },
        { display_name: 'Total Votes',   variable_name: 'votes',  value: totalQty },
      ],
    },
    onClose() {
      showToast('Payment cancelled.', 'warning');
    },
    async callback(response) {
      // Payment successful — save votes
      await saveVotes(response.reference, totalNgn);
    },
  });

  handler.openIframe();
}

// ──────────────────────────────────────────────────────────────
// 10. SAVE VOTES TO SUPABASE
// ──────────────────────────────────────────────────────────────
async function saveVotes(paymentRef, totalAmountPaid) {
  const items  = Object.values(_cart);
  const userId = _currentUser?.id || null;
  const matric = _currentUser?.user_metadata?.matric_number
              || _currentUser?.email?.split('@')[0]?.toUpperCase();
  const rate   = Number(_activeElection?.price_per_vote || 100);

  // Build vote rows — one row per candidate in the cart
  const voteRows = items.map(({ candidate, qty }) => ({
    candidate_id:      candidate.id,
    voter_id:          userId,
    matric_number:     matric,
    number_of_votes:   qty,
    amount_paid:       qty * rate,
    payment_reference: paymentRef,
  }));

  try {
    // Insert all vote rows in a single batch
    await sb.post('votes', voteRows);

    // Show success modal
    const totalVotes = items.reduce((s, i) => s + i.qty, 0);
    document.getElementById('successRef').textContent     = paymentRef;
    document.getElementById('successSummary').textContent =
      `${totalVotes} vote${totalVotes > 1 ? 's' : ''} cast across ${items.length} candidate${items.length > 1 ? 's' : ''}.`;
    document.getElementById('successModal').classList.remove('hidden');

    // Clear cart
    _cart = {};
    renderCart();
    // Un-select all cards
    document.querySelectorAll('.candidate-card.selected').forEach(c => c.classList.remove('selected'));

  } catch (err) {
    showToast(
      `Votes could not be recorded. Ref: ${paymentRef}. Contact admin. (${err.message})`,
      'error'
    );
  }
}

// ──────────────────────────────────────────────────────────────
// 11. XSS HELPER
// ──────────────────────────────────────────────────────────────
function escHtml(str = '') {
  return String(str)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#039;');
}

// ──────────────────────────────────────────────────────────────
// 12. EVENT LISTENERS
// ──────────────────────────────────────────────────────────────
document.getElementById('loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  const matric  = document.getElementById('matricInput').value.trim();
  const surname = document.getElementById('surnameInput').value.trim();

  if (!matric || !surname) {
    showAuthError('Please enter both your Matric Number and Surname.');
    return;
  }

  setLoginLoading(true);
  hideAuthError();

  try {
    await login(matric, surname);
    showVoting();
  } catch (err) {
    showAuthError(err.message || 'Login failed. Please try again.');
  } finally {
    setLoginLoading(false);
  }
});

document.getElementById('logoutBtn').addEventListener('click', logout);

document.getElementById('payBtn').addEventListener('click', initiatePayment);

document.getElementById('successCloseBtn').addEventListener('click', () => {
  document.getElementById('successModal').classList.add('hidden');
});

// ──────────────────────────────────────────────────────────────
// 13. AUTH UI HELPERS
// ──────────────────────────────────────────────────────────────
function showAuthError(msg) {
  const el = document.getElementById('authError');
  document.getElementById('authErrorMsg').textContent = msg;
  el.classList.remove('hidden');
}
function hideAuthError() {
  document.getElementById('authError').classList.add('hidden');
}
function setLoginLoading(loading) {
  document.getElementById('loginBtn').disabled      = loading;
  document.getElementById('loginBtnText').textContent = loading ? 'Signing in…' : 'Sign In & Vote';
  document.getElementById('loginSpinner').classList.toggle('hidden', !loading);
}

// ──────────────────────────────────────────────────────────────
// 14. BOOTSTRAP — check existing session
// ──────────────────────────────────────────────────────────────
(function init() {
  if (_session?.access_token) {
    showVoting();
  } else {
    showAuth();
  }
})();
