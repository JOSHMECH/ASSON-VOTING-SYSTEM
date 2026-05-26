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
    async upload(bucket, path, file) {
      const r = await fetch(`${base}/storage/v1/object/${bucket}/${path}`, {
        method: 'POST',
        headers: {
          'apikey':        CFG.supabaseKey,
          'Authorization': `Bearer ${CFG.supabaseKey}`,
          'Content-Type':  file.type
        },
        body: file
      });
      if (!r.ok) {
        const data = await r.json();
        throw new Error(data.error || data.message || r.statusText);
      }
      return `${base}/storage/v1/object/public/${bucket}/${path}`;
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
let _isSignUpMode  = false;  // toggle between sign-in and sign-up

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

async function loginWithEmail(email, password) {
  const data = await sb.auth('token?grant_type=password', { email, password });
  _session     = data;
  _currentUser = data.user;
  sessionStorage.setItem('asson_session', JSON.stringify(data));
  sessionStorage.setItem('asson_user',    JSON.stringify(data.user));
}

async function signUpWithEmail(email, password) {
  const signupData = await sb.auth('signup', { email, password });

  if (signupData.access_token) {
    // Email confirmation disabled — user is immediately signed in
    _session     = signupData;
    _currentUser = signupData.user;
    sessionStorage.setItem('asson_session', JSON.stringify(_session));
    sessionStorage.setItem('asson_user',    JSON.stringify(_currentUser));

    // Send email alert to admin asynchronously (non-blocking)
    sendEmailNotification('admin', 'New Student Sign Up Alert', `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px; background-color: #ffffff;">
        <h2 style="color: #008751; margin-top: 0;">New Account Registered</h2>
        <p>Hello Admin,</p>
        <p>A new student has just registered an account on the ASSON Voting Portal.</p>
        <div style="background-color: #f8fafc; padding: 15px; border-radius: 6px; margin: 20px 0;">
          <p style="margin: 0; font-size: 14px; color: #475569;"><strong>Student Email:</strong> ${escHtml(email)}</p>
          <p style="margin: 5px 0 0 0; font-size: 14px; color: #475569;"><strong>Registered At:</strong> ${new Date().toLocaleString()}</p>
        </div>
        <p style="font-size: 13px; color: #64748b; margin-bottom: 0;">This is an automated notification from the ASSON Voting System.</p>
      </div>
    `);
  } else {
    // Email confirmation may be enabled — try to sign in directly
    throw new Error('Account created! Please check your email to confirm, then sign in.');
  }
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
  const email = _currentUser?.email || '??';
  const name = email.split('@')[0];
  document.getElementById('headerName').textContent   = email;
  document.getElementById('headerAvatar').textContent = getInitials(name);
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
    section.className = 'accordion-card';
    section.innerHTML = `
      <button class="accordion-header" aria-expanded="false" id="header-${pos.id}">
        <div class="accordion-header-left">
          <div class="section-label-bar"></div>
          <div style="text-align: left;">
            <div class="section-label-title">${escHtml(pos.title)}</div>
            ${pos.description ? `<div class="section-label-desc">${escHtml(pos.description)}</div>` : ''}
          </div>
        </div>
        <div class="accordion-header-right">
          <span class="badge badge-gray category-badge" id="badge-${pos.id}" data-count="${posCandidates.length}">
            ${posCandidates.length} Candidate${posCandidates.length !== 1 ? 's' : ''}
          </span>
          <span class="accordion-icon">
            <svg width="12" height="8" viewBox="0 0 12 8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="m1 1 5 5 5-5"/>
            </svg>
          </span>
        </div>
      </button>
      <div class="accordion-content" id="content-${pos.id}">
        <div class="grid-auto accordion-content-inner" id="pos-${pos.id}"></div>
      </div>
    `;
    container.appendChild(section);

    const header = section.querySelector('.accordion-header');
    const content = section.querySelector('.accordion-content');
    const grid = section.querySelector(`#pos-${pos.id}`);

    // Populate candidates
    posCandidates.forEach(c => {
      grid.appendChild(buildCandidateCard(c, pos));
    });

    if (!posCandidates.length) {
      grid.innerHTML = '<p class="text-muted text-sm" style="text-align: center; padding: 2rem 0; width: 100%; grid-column: 1 / -1;">No candidates added yet.</p>';
    }

    // Toggle expand/collapse
    header.addEventListener('click', function(e) {
      e.preventDefault();
      const isExpanded = this.getAttribute('aria-expanded') === 'true';

      if (isExpanded) {
        this.setAttribute('aria-expanded', 'false');
        // Force the max-height value to allow transition from dynamic height to 0
        content.style.maxHeight = content.scrollHeight + 'px';
        // Force reflow
        content.offsetHeight; 
        content.style.maxHeight = '0px';
        content.style.opacity = '0';
        setTimeout(() => {
          content.classList.remove('expanded');
        }, 400); // matches --transition-slow (400ms)
      } else {
        this.setAttribute('aria-expanded', 'true');
        content.classList.add('expanded');
        content.style.maxHeight = content.scrollHeight + 'px';
        content.style.opacity = '1';
        // After transition finishes, set max-height to none to support window resizing and candidate selection updates
        setTimeout(() => {
          if (this.getAttribute('aria-expanded') === 'true') {
            content.style.maxHeight = 'none';
          }
        }, 400);
      }
    });
  });

  // Dynamically update category badges to show checkmarks for already active cart items
  updateCategoryBadges();
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

  updateCategoryBadges();
}

function updateCategoryBadges() {
  if (!_positions || !_positions.length) return;

  _positions.forEach(pos => {
    const badgeEl = document.getElementById(`badge-${pos.id}`);
    if (!badgeEl) return;

    const originalCount = badgeEl.dataset.count || '0';
    
    // Find all cart items in this category
    const posCartItems = Object.values(_cart).filter(item => item.position.id === pos.id);
    if (posCartItems.length > 0) {
      const totalQty = posCartItems.reduce((sum, item) => sum + item.qty, 0);
      badgeEl.className = 'badge badge-green category-badge';
      badgeEl.innerHTML = `✅ ${totalQty} vote${totalQty > 1 ? 's' : ''}`;
    } else {
      badgeEl.className = 'badge badge-gray category-badge';
      badgeEl.innerHTML = `${originalCount} Candidate${originalCount !== '1' ? 's' : ''}`;
    }
  });
}


// ──────────────────────────────────────────────────────────────
// 9.  MANUAL PROOF OF PAYMENT
// ──────────────────────────────────────────────────────────────
let _activeBankDetails = null;

async function initiatePayment() {
  const items = Object.values(_cart);
  if (!items.length) return;

  const rate     = Number(_activeElection?.price_per_vote || 100);
  const totalQty = items.reduce((s, i) => s + i.qty, 0);
  const totalNgn = totalQty * rate;

  // Set amounts in the modal
  document.getElementById('displayTotalAmount').textContent = fmtNaira(totalNgn);

  // Fetch active bank details
  const modal = document.getElementById('paymentModal');
  modal.classList.remove('hidden');

  try {
    const details = await sb.get('bank_details?is_active=eq.true&limit=1');
    if (details.length > 0) {
      _activeBankDetails = details[0];
      document.getElementById('displayBankName').textContent = escHtml(details[0].bank_name);
      document.getElementById('displayAccountNumber').textContent = escHtml(details[0].account_number);
      document.getElementById('displayAccountName').textContent = escHtml(details[0].account_name);
    } else {
      document.getElementById('displayBankName').textContent = 'Admin has not set bank details.';
      document.getElementById('displayAccountNumber').textContent = '—';
      document.getElementById('displayAccountName').textContent = '—';
    }
  } catch (err) {
    showToast('Failed to fetch payment details: ' + err.message, 'error');
  }
}

// Bind close and upload events
document.getElementById('paymentCancelBtn').addEventListener('click', () => {
  document.getElementById('paymentModal').classList.add('hidden');
  document.getElementById('receiptFile').value = '';
});

document.getElementById('submitProofBtn').addEventListener('click', async () => {
  const fileInput = document.getElementById('receiptFile');
  if (!fileInput.files || !fileInput.files[0]) {
    showToast('Please upload a screenshot/image of your transfer receipt.', 'error');
    return;
  }

  const items = Object.values(_cart);
  if (!items.length) return;

  const btn  = document.getElementById('submitProofBtn');
  const spin = document.getElementById('proofSpinner');
  const txt  = document.getElementById('submitProofBtnText');

  btn.disabled = true;
  spin.classList.remove('hidden');
  txt.textContent = 'Submitting…';

  try {
    const file = fileInput.files[0];
    const fileExt = file.name.split('.').pop();
    const uniqueFileName = `receipt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.${fileExt}`;
    
    // Upload receipt to Supabase Storage
    const receiptUrl = await sb.upload('payment-receipts', uniqueFileName, file);
    
    const rate     = Number(_activeElection?.price_per_vote || 100);
    const totalQty = items.reduce((s, i) => s + i.qty, 0);
    const totalNgn = totalQty * rate;
    const ref = `ASSON-${Date.now()}-${Math.random().toString(36).substring(2,8).toUpperCase()}`;

    await saveVotes(ref, totalNgn, receiptUrl);
    
    document.getElementById('paymentModal').classList.add('hidden');
    fileInput.value = '';
  } catch (err) {
    showToast('Failed to upload proof of payment: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    spin.classList.add('hidden');
    txt.textContent = 'Submit Proof & Vote';
  }
});

// ──────────────────────────────────────────────────────────────
// 10. SAVE VOTES TO SUPABASE
// ──────────────────────────────────────────────────────────────
async function saveVotes(paymentRef, totalAmountPaid, receiptUrl = null) {
  const items  = Object.values(_cart);
  const userId = _currentUser?.id || null;
  const userEmail = _currentUser?.email || 'unknown';
  const rate   = Number(_activeElection?.price_per_vote || 100);

  // Build vote rows — one row per candidate in the cart
  const voteRows = items.map(({ candidate, qty }) => ({
    candidate_id:      candidate.id,
    voter_id:          userId,
    matric_number:     userEmail,
    number_of_votes:   qty,
    amount_paid:       qty * rate,
    payment_reference: paymentRef,
    receipt_url:       receiptUrl,
    status:            'pending', // explicit pending
  }));

  try {
    // Insert all vote rows in a single batch
    await sb.post('votes', voteRows);

    // Send email alert to admin asynchronously (non-blocking)
    const totalVotes = items.reduce((s, i) => s + i.qty, 0);
    const cartSummaryHtml = items.map(i => `<li>${escHtml(i.candidate.name)} (×${i.qty} votes)</li>`).join('');
    sendEmailNotification('admin', 'New Payment Receipt Uploaded', `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px; background-color: #ffffff;">
        <h2 style="color: #ca8a04; margin-top: 0;">New Payment Pending Approval</h2>
        <p>Hello Admin,</p>
        <p>A student has uploaded a payment receipt and cast their votes. Please review the transfer details on the dashboard to approve or reject the transaction.</p>
        <div style="background-color: #f8fafc; padding: 15px; border-radius: 6px; margin: 20px 0;">
          <p style="margin: 0 0 10px 0; font-size: 14px; color: #475569;"><strong>Student Email:</strong> ${escHtml(userEmail)}</p>
          <p style="margin: 0 0 10px 0; font-size: 14px; color: #475569;"><strong>Reference:</strong> <code style="background-color:#e2e8f0; padding:2px 4px; border-radius:3px;">${escHtml(paymentRef)}</code></p>
          <p style="margin: 0 0 10px 0; font-size: 14px; color: #475569;"><strong>Votes Selected:</strong> ${totalVotes} votes</p>
          <p style="margin: 0 0 10px 0; font-size: 14px; color: #475569;"><strong>Amount Paid:</strong> ₦${totalAmountPaid.toLocaleString()}</p>
          <p style="margin: 0; font-size: 14px; color: #475569;"><strong>Proof Link:</strong> <a href="${escHtml(receiptUrl)}" target="_blank" style="color:#008751; text-decoration:underline;">View Receipt</a></p>
        </div>
        <h3 style="color:#334155; font-size: 15px;">Ballot Selections:</h3>
        <ul style="color:#475569; font-size: 14px; padding-left:20px; margin-top:5px;">
          ${cartSummaryHtml}
        </ul>
        <p style="margin-top:20px;"><a href="${window.location.origin}/admin.html" style="background-color:#008751; color:#ffffff; padding:10px 16px; text-decoration:none; border-radius:6px; font-weight:bold; display:inline-block;">Go to Admin Dashboard</a></p>
        <p style="font-size: 13px; color: #64748b; margin-top:25px; margin-bottom: 0;">This is an automated notification from the ASSON Voting System.</p>
      </div>
    `);

    // Show success modal
    document.getElementById('successRef').textContent     = paymentRef;
    document.getElementById('successSummary').textContent =
      `${totalVotes} vote${totalVotes > 1 ? 's' : ''} cast pending approval.`;
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
// 11.5 EMAIL NOTIFICATIONS HELPER
// ──────────────────────────────────────────────────────────────
async function sendEmailNotification(to, subject, html) {
  try {
    const res = await fetch('/api/send-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to, subject, html })
    });
    if (!res.ok) {
      console.warn('Failed to send email notification:', await res.text());
    }
  } catch (error) {
    console.error('Error sending email notification:', error);
  }
}

// ──────────────────────────────────────────────────────────────
// 12. EVENT LISTENERS
// ──────────────────────────────────────────────────────────────
document.getElementById('loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  const email    = document.getElementById('emailInput').value.trim();
  const password = document.getElementById('passwordInput').value.trim();

  if (!email || !password) {
    showAuthError('Please enter both your Email and Password.');
    return;
  }

  if (_isSignUpMode && password.length < 6) {
    showAuthError('Password must be at least 6 characters long.');
    return;
  }

  setLoginLoading(true);
  hideAuthError();

  try {
    if (_isSignUpMode) {
      await signUpWithEmail(email, password);
    } else {
      await loginWithEmail(email, password);
    }
    showVoting();
  } catch (err) {
    showAuthError(err.message || 'Authentication failed. Please try again.');
  } finally {
    setLoginLoading(false);
  }
});

// Auth toggle (sign-in <-> sign-up)
document.getElementById('authToggleLink').addEventListener('click', e => {
  e.preventDefault();
  _isSignUpMode = !_isSignUpMode;
  document.getElementById('authSubtitle').textContent =
    _isSignUpMode ? 'Student Portal \u2014 Create Account' : 'Student Portal \u2014 Sign In';
  document.getElementById('loginBtnText').textContent =
    _isSignUpMode ? 'Create Account' : 'Sign In & Vote';
  document.getElementById('authToggleText').textContent =
    _isSignUpMode ? 'Already have an account?' : "Don't have an account?";
  document.getElementById('authToggleLink').textContent =
    _isSignUpMode ? 'Sign In' : 'Sign Up';
  document.getElementById('passwordHint').textContent =
    _isSignUpMode ? 'Minimum 6 characters' : 'Your account password';
  hideAuthError();
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
  document.getElementById('loginBtnText').textContent = loading
    ? (_isSignUpMode ? 'Creating account\u2026' : 'Signing in\u2026')
    : (_isSignUpMode ? 'Create Account' : 'Sign In & Vote');
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
