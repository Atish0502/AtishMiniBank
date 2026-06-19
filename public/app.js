// Atish Mini bank Frontend Application Logic
const qs = s => document.querySelector(s);
const qsa = s => document.querySelectorAll(s);

// Global Application State
// Theme control system
function initTheme() {
  const savedTheme = localStorage.getItem('atishTheme') || 'dark';
  document.body.classList.toggle('light-theme', savedTheme === 'light');
  updateThemeIcon();
}

function updateThemeIcon() {
  const icon = qs('#themeToggleIcon');
  if (!icon) return;
  const isLight = document.body.classList.contains('light-theme');
  icon.setAttribute('data-lucide', isLight ? 'sun' : 'moon');
  if (window.lucide) window.lucide.createIcons();
}

// Toast notification API
function showToast(message, type = 'success') {
  const container = qs('#toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  
  let icon = 'check-circle';
  if (type === 'error') icon = 'alert-triangle';
  else if (type === 'info') icon = 'info';
  else if (type === 'warning') icon = 'alert-circle';

  toast.innerHTML = `
    <i data-lucide="${icon}" style="width: 18px; height: 18px;"></i>
    <span>${message}</span>
  `;

  container.appendChild(toast);
  if (window.lucide) window.lucide.createIcons();

  // Slide in, then fade out
  setTimeout(() => {
    toast.classList.add('fade-out');
    setTimeout(() => toast.remove(), 400);
  }, 4000);
}

// Promise-based Alert/Confirm
function showCustomAlert(message, title = 'Notification') {
  return new Promise((resolve) => {
    const modal = qs('#customAlertModal');
    const msgEl = qs('#customAlertMessage');
    const titleEl = qs('#customAlertTitle');
    const btn = qs('#btnCustomAlertOk');
    
    if (!modal || !msgEl || !btn) {
      alert(message);
      resolve();
      return;
    }
    
    msgEl.textContent = message;
    if (titleEl) titleEl.textContent = title;
    modal.classList.remove('hidden');
    
    const onClick = () => {
      modal.classList.add('hidden');
      btn.removeEventListener('click', onClick);
      resolve();
    };
    btn.addEventListener('click', onClick);
  });
}

function showCustomConfirm(message, title = 'Confirmation Required') {
  return new Promise((resolve) => {
    const modal = qs('#customConfirmModal');
    const msgEl = qs('#customConfirmMessage');
    const titleEl = qs('#customConfirmTitle');
    const btnOk = qs('#btnCustomConfirmOk');
    const btnCancel = qs('#btnCustomConfirmCancel');
    
    if (!modal || !msgEl || !btnOk || !btnCancel) {
      resolve(confirm(message));
      return;
    }
    
    msgEl.textContent = message;
    if (titleEl) titleEl.textContent = title;
    modal.classList.remove('hidden');
    
    const cleanUp = (result) => {
      modal.classList.add('hidden');
      btnOk.removeEventListener('click', onOk);
      btnCancel.removeEventListener('click', onCancel);
      resolve(result);
    };
    
    const onOk = () => cleanUp(true);
    const onCancel = () => cleanUp(false);
    
    btnOk.addEventListener('click', onOk);
    btnCancel.addEventListener('click', onCancel);
  });
}

// Session Timeout inactivity tracker
let inactivityTimer = null;
const INACTIVITY_TIMEOUT = 180000; // 3 minutes

function resetInactivityTimer() {
  if (!token) return;
  clearTimeout(inactivityTimer);
  inactivityTimer = setTimeout(autoLogout, INACTIVITY_TIMEOUT);
}

function autoLogout() {
  if (!token) return;
  clearAuthState();
  showCustomAlert('Your session has expired due to inactivity. You have been logged out.');
}

['mousemove', 'click', 'keydown', 'scroll'].forEach(evt => {
  window.addEventListener(evt, resetInactivityTimer);
});

// Beautiful empty state generator
function getEmptyStateHTML(title, description, icon = 'folder-open') {
  return `
    <div class="empty-state" style="text-align: center; padding: 40px 20px; display: flex; flex-direction: column; align-items: center; justify-content: center; background: rgba(255, 255, 255, 0.01); border: 1px dashed var(--glass-border); border-radius: 16px; width: 100%; margin: 15px 0; box-sizing: border-box;">
      <div style="width: 50px; height: 50px; border-radius: 50%; background: rgba(255, 255, 255, 0.02); display: flex; align-items: center; justify-content: center; color: var(--text-muted); margin-bottom: 12px;">
        <i data-lucide="${icon}" style="width: 24px; height: 24px;"></i>
      </div>
      <h5 style="font-size: 15px; font-weight: 600; margin-bottom: 6px; color: var(--text-primary);">${title}</h5>
      <p class="muted" style="font-size: 13px; max-width: 280px; margin: 0 auto; line-height: 1.4; color: var(--text-muted);">${description}</p>
    </div>
  `;
}

// Global Application State
let currentUser = null;
let isAdmin = false;
let token = null;
let transactionsCache = [];
let financialChartInstance = null;
let spendingIncomeTrendChartInstance = null;

// Helper: Post JSON to server with Auth Token
async function request(url, method = 'GET', data = null) {
  const headers = { 'content-type': 'application/json' };
  const savedToken = localStorage.getItem('atishToken');
  if (savedToken) headers['authorization'] = `Bearer ${savedToken}`;
  
  const options = { method, headers };
  if (data) options.body = JSON.stringify(data);

  try {
    const res = await fetch(url, options);
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch (e) { json = null; }
    
    if (!res.ok) {
      throw new Error(text || `Request failed with status ${res.status}`);
    }
    return json || text;
  } catch (err) {
    console.error(`API Error on ${url}:`, err);
    throw err;
  }
}

// Navigation / Panel Visibility Controller
function showPanel(panelId) {
  // Clear all result text contents to avoid stale status text hanging across views
  qsa('.result').forEach(r => {
    r.textContent = '';
    r.className = 'result';
  });

  // Hide all panels
  qsa('.panel').forEach(p => p.classList.add('hidden'));
  
  // Show target panel
  const target = qs(`#${panelId}`);
  if (target) target.classList.remove('hidden');

  // Update nav item active states
  qsa('.sb-item').forEach(b => {
    b.classList.toggle('active', b.dataset.target === panelId);
  });

  // Keep page title in sync
  const titleMap = {
    'auth': 'Secure Member Portal',
    'dashboard': 'Account Dashboard',
    'accounts': 'Manage Portfolio Ledgers',
    'transactions': 'Transaction Audit Log',
    'beneficiaries': 'Wire Transfer Directory',
    'statements': 'On-Demand Bank Statements',
    'profile': 'Membership Security Settings',
    'notifications': 'Security Notifications Alert',
    'fd-rd': 'Fixed & Recurring Deposits',
    'loans': 'Loan Portfolios & Amortization',
    'admin-dashboard': 'Atish Mini bank Central Security Console',
    'admin-users': 'Atish Mini bank Central User Directory'
  };
  
  const pageTitle = qs('#pageTitle');
  if (pageTitle) pageTitle.textContent = titleMap[panelId] || 'Atish Mini bank Systems';
  
  // Refresh content on view switch
  if (currentUser || isAdmin) {
    if (panelId === 'dashboard') {
      loadProfileData();
      renderDashboardCharts();
    } else if (panelId === 'accounts') {
      loadAccounts();
    } else if (panelId === 'transactions') {
      loadTransactionsHistory();
    } else if (panelId === 'beneficiaries') {
      loadBeneficiaries();
    } else if (panelId === 'fd-rd') {
      loadFdRd();
      updateFdPreview();
      updateRdPreview();
    } else if (panelId === 'loans') {
      loadLoans();
      updateEmiPreview();
      updateLoanRate();
    } else if (panelId === 'notifications') {
      loadNotifications();
    } else if (panelId === 'admin-dashboard') {
      loadAdminDashboard();
    } else if (panelId === 'admin-users') {
      loadAdminUsersTable();
    }
  }

  // Close mobile sidebar on navigation
  const sidebar = qs('#sidebar');
  if (sidebar) sidebar.classList.remove('open');
}

// Check local storage on application startup
async function initAuth() {
  initTheme();
  token = localStorage.getItem('atishToken');
  const storedRole = localStorage.getItem('atishRole');

  if (token) {
    try {
      const data = await request('/me');
      if (data.admin) {
        isAdmin = true;
        currentUser = data.user;
        setAuthState(true);
        showPanel('admin-dashboard');
      } else if (data.success && data.user) {
        isAdmin = false;
        currentUser = data.user;
        setAuthState(false);
        showPanel('dashboard');
      } else {
        clearAuthState();
      }
    } catch (e) {
      console.warn("Session restore failed. Redirecting to login.");
      clearAuthState();
    }
  } else {
    clearAuthState();
  }
  
  // Re-enable Lucide icon rendering
  if (window.lucide) window.lucide.createIcons();
}

// Set auth state UI adjustments
function setAuthState(adminMode) {
  const loggedIn = !!token;
  const layout = qs('#appLayout');
  if (layout) layout.classList.toggle('logged-in', loggedIn);
  
  const sidebar = qs('#sidebar');
  if (sidebar) sidebar.classList.toggle('hidden', !loggedIn);
  
  const logoutBtn = qs('#logoutBtn');
  if (logoutBtn) logoutBtn.classList.toggle('hidden', !loggedIn);
  
  if (adminMode) {
    const userLabel = qs('#userLabel');
    if (userLabel) userLabel.textContent = 'Administrator';
    
    const userStatus = qs('#userStatusTag');
    if (userStatus) userStatus.innerHTML = `<div class="indicator-dot dot-red"></div><span>Admin Mode</span>`;
    
    const adminNav = qs('#adminNavGroup');
    if (adminNav) adminNav.classList.remove('hidden');
    
    // Hide standard navigation tabs
    const tabs = ['#sb-dashboard', '#sb-accounts', '#sb-beneficiaries', '#sb-fd-rd', '#sb-loans', '#sb-statements', '#sb-profile'];
    tabs.forEach(selector => {
      const el = qs(selector);
      if (el) el.style.display = 'none';
    });
    document.body.classList.add('admin-active');
  } else if (currentUser) {
    document.body.classList.remove('admin-active');
    const userLabel = qs('#userLabel');
    if (userLabel) userLabel.textContent = currentUser.username;
    
    const userStatus = qs('#userStatusTag');
    if (userStatus) userStatus.innerHTML = `<div class="indicator-dot dot-green"></div><span>Standing: Active</span>`;
    
    const adminNav = qs('#adminNavGroup');
    if (adminNav) adminNav.classList.add('hidden');
    
    // Show standard tabs
    const tabs = ['#sb-dashboard', '#sb-accounts', '#sb-beneficiaries', '#sb-fd-rd', '#sb-loans', '#sb-statements', '#sb-profile'];
    tabs.forEach(selector => {
      const el = qs(selector);
      if (el) el.style.display = 'flex';
    });
  }
  
  loadProfileData();
}

function clearAuthState() {
  token = null;
  currentUser = null;
  isAdmin = false;
  localStorage.removeItem('atishToken');
  localStorage.removeItem('atishRole');
  
  const layout = qs('#appLayout');
  if (layout) layout.classList.remove('logged-in');
  
  const sidebar = qs('#sidebar');
  if (sidebar) sidebar.classList.add('hidden');
  
  const logoutBtn = qs('#logoutBtn');
  if (logoutBtn) logoutBtn.classList.add('hidden');
  
  const adminNav = qs('#adminNavGroup');
  if (adminNav) adminNav.classList.add('hidden');
  
  const userLabel = qs('#userLabel');
  if (userLabel) userLabel.textContent = 'Guest';
  
  const userStatus = qs('#userStatusTag');
  if (userStatus) userStatus.innerHTML = `<div class="indicator-dot dot-red"></div><span>Disconnected</span>`;
  
  showPanel('auth');
}

// Fetch active user details and populate templates
async function loadProfileData() {
  if (!token || isAdmin) {
    if (isAdmin) {
      qs('#sidebarUser').innerHTML = `
        <div class="sb-user-card">
          <div class="sb-user-row">
            <div class="sb-user-avatar"><i data-lucide="shield"></i></div>
            <div class="sb-user-meta">
              <span class="sb-user-name">Central Admin</span>
              <span class="sb-user-role">System Master</span>
            </div>
          </div>
        </div>`;
      if (window.lucide) window.lucide.createIcons();
    }
    return;
  }

  try {
    const data = await request('/me');
    if (data.success && data.user) {
      currentUser = data.user;
      
      // Compute balances
      const allAccounts = currentUser.accounts || [];
      const activeAccounts = allAccounts.filter(a => a.status !== 'closed');
      const totalBalance = activeAccounts.reduce((sum, a) => sum + a.balance, 0);
      
      // Update Sidebar Card
      qs('#sidebarUser').innerHTML = `
        <div class="sb-user-card">
          <div class="sb-user-row">
            <div class="sb-user-avatar"><i data-lucide="user"></i></div>
            <div class="sb-user-meta">
              <span class="sb-user-name">${currentUser.name}</span>
              <span class="sb-user-role">Standard User</span>
            </div>
          </div>
          <div class="sb-user-details">
            <span>Portfolio Balance: <strong>₹${totalBalance.toLocaleString(undefined, {minimumFractionDigits: 2})}</strong></span>
            <span>Accounts: <strong>${activeAccounts.length}</strong></span>
          </div>
        </div>`;

      // Update Dashboard totals
      const balanceEl = qs('#dashTotalBalance');
      if (balanceEl) balanceEl.textContent = `₹${totalBalance.toLocaleString(undefined, {minimumFractionDigits: 2})}`;
      
      const countEl = qs('#dashAccountsCount');
      if (countEl) countEl.textContent = activeAccounts.length;

      // Update ATM forms & Transfer Selects
      populateAccountDropdowns(allAccounts);

      // Update Profile page inputs
      const profileName = qs('#profileName');
      if (profileName) {
        profileName.value = currentUser.name;
        qs('#profileEmail').value = currentUser.email;
        qs('#profileMobile').value = currentUser.mobile;
        qs('#profileUsername').textContent = currentUser.username;
        qs('#profileStatusBadge').className = `badge badge-${currentUser.status}`;
        qs('#profileStatusBadge').textContent = currentUser.status;
      }

      // Populate Settings inputs & read-only boxes
      const setName = qs('#setProfileName');
      if (setName) {
        setName.value = currentUser.name || '';
        
        const setUsername = qs('#setProfileUsername');
        if (setUsername) setUsername.value = currentUser.username || '';
        
        const setProfileEmail = qs('#setProfileEmail');
        if (setProfileEmail) setProfileEmail.value = currentUser.email || '';
        
        const setProfileMobile = qs('#setProfileMobile');
        if (setProfileMobile) setProfileMobile.value = currentUser.mobile || '';
        
        const setContactEmail = qs('#setContactEmail');
        if (setContactEmail) setContactEmail.value = currentUser.email || '';
        
        const setContactMobile = qs('#setContactMobile');
        if (setContactMobile) setContactMobile.value = currentUser.mobile || '';

        // Populate Preferences checkboxes
        const prefs = currentUser.preferences || {};
        const setOtp = qs('#setSecurityOtp');
        if (setOtp) setOtp.checked = !!prefs.otpEnabled;
        const setEmailPref = qs('#setNotifEmail');
        if (setEmailPref) setEmailPref.checked = !!prefs.notifyEmail;
        const setTransferPref = qs('#setNotifTransfer');
        if (setTransferPref) setTransferPref.checked = !!prefs.alertTransfer;
        const setDepositPref = qs('#setNotifDeposit');
        if (setDepositPref) setDepositPref.checked = !!prefs.alertDeposit;
        const setWithdrawPref = qs('#setNotifWithdraw');
        if (setWithdrawPref) setWithdrawPref.checked = !!prefs.alertWithdraw;

        // Account Information (Read-only)
        const primaryAcc = allAccounts[0] || { accountNumber: '000000', type: 'Savings', status: 'Active' };
        
        let custId = 'CUST001';
        if (currentUser.username !== 'atish') {
          const hex = String(currentUser._id);
          const num = parseInt(hex.slice(-4), 16) % 1000;
          custId = 'CUST' + String(num).padStart(3, '0');
        }

        const setCustId = qs('#setInfoCustomerId');
        if (setCustId) setCustId.textContent = custId;
        const setAccNo = qs('#setInfoAccountNo');
        if (setAccNo) setAccNo.textContent = 'xxxx' + String(primaryAcc.accountNumber).slice(-4);
        const setType = qs('#setInfoAccountType');
        if (setType) setType.textContent = primaryAcc.type;
        const setStatus = qs('#setInfoAccountStatus');
        if (setStatus) {
          setStatus.textContent = primaryAcc.status;
          setStatus.className = `badge badge-${primaryAcc.status === 'active' ? 'active' : 'frozen'}`;
        }
        
        const createdDate = new Date(currentUser.createdAt || new Date());
        const formattedDate = createdDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).replace(/ /g, '-');
        const setCreated = qs('#setInfoCreatedOn');
        if (setCreated) setCreated.textContent = formattedDate;
      }
      
      // Load Badge Alerts
      loadNotificationsCount();

      if (window.lucide) window.lucide.createIcons();
    }
  } catch (err) {
    console.error("Error updating profile components:", err);
  }
}

// Populate account selection boxes throughout dashboards
function populateAccountDropdowns(accounts) {
  const selectors = qsa('.atm-acc-select, #transferFromSelect, #statementAccountSelect');
  selectors.forEach(select => {
    const currentVal = select.value;
    select.innerHTML = '';
    
    const activeAccounts = accounts.filter(a => a.status !== 'closed');
    if (activeAccounts.length === 0) {
      select.innerHTML = '<option value="">No active accounts</option>';
      return;
    }
    
    activeAccounts.forEach(a => {
      const opt = document.createElement('option');
      opt.value = a.accountNumber;
      opt.textContent = `${a.type} Portfolio (${a.accountNumber}) — ₹${a.balance.toFixed(2)}`;
      
      if (a.status === 'frozen') {
        opt.textContent += ' [FROZEN]';
      }
      select.appendChild(opt);
    });

    if (currentVal) select.value = currentVal;
  });
}

// Create live mock SMS/Email toast message in the UI
function createMockToast(title, body, otp = null) {
  const tray = qs('#mockNotificationsArea');
  if (!tray) return;

  const toast = document.createElement('div');
  toast.className = 'mock-toast';
  toast.innerHTML = `
    <div class="mock-toast-icon"><i data-lucide="smartphone"></i></div>
    <div class="mock-toast-content">
      <span class="mock-toast-title">${title}</span>
      <span class="mock-toast-body">${body}</span>
      ${otp ? `<strong class="mock-toast-otp">${otp}</strong>` : ''}
    </div>
  `;

  tray.appendChild(toast);
  if (window.lucide) window.lucide.createIcons();

  // Play a mock sound/visual blink
  toast.style.border = '1px solid var(--warning-amber)';

  // Remove toast automatically after 10 seconds
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    setTimeout(() => toast.remove(), 300);
  }, 10000);
}

// --- ATM TABS TOGGLE ---
qs('#atmTabDeposit')?.addEventListener('click', () => {
  qs('#atmTabDeposit').classList.add('active');
  qs('#atmTabWithdraw').classList.remove('active');
  qs('#depositForm').classList.remove('hidden');
  qs('#withdrawForm').classList.add('hidden');
});

qs('#atmTabWithdraw')?.addEventListener('click', () => {
  qs('#atmTabWithdraw').classList.add('active');
  qs('#atmTabDeposit').classList.remove('active');
  qs('#withdrawForm').classList.remove('hidden');
  qs('#depositForm').classList.add('hidden');
});

// --- SUBMIT: LOG IN ---
qs('#loginForm')?.addEventListener('submit', async e => {
  e.preventDefault();
  const fd = Object.fromEntries(new FormData(e.target));
  const resEl = qs('#loginResult');
  resEl.className = 'result';
  resEl.textContent = 'Verifying identity...';

  try {
    const data = await request('/login', 'POST', fd);
    if (data.success && data.token) {
      localStorage.setItem('atishToken', data.token);
      localStorage.setItem('atishRole', 'user');
      token = data.token;
      isAdmin = false;
      currentUser = data.user;
      resEl.className = 'result success-text';
      resEl.textContent = 'Authenticated. Opening Dashboard...';
      
      setTimeout(() => {
        setAuthState(false);
        showPanel('dashboard');
        e.target.reset();
      }, 100);
    }
  } catch (err) {
    resEl.className = 'result error-text';
    resEl.textContent = err.message || 'Login failed.';
  }
});

// --- SUBMIT: SIGN UP ---
qs('#signupForm')?.addEventListener('submit', async e => {
  e.preventDefault();
  const fd = Object.fromEntries(new FormData(e.target));
  const resEl = qs('#signupResult');
  resEl.className = 'result';
  resEl.textContent = 'Registering member and provisioning ledger...';

  if (fd.password !== fd.confirmPassword) {
    resEl.className = 'result error-text';
    resEl.textContent = 'Passwords do not match.';
    return;
  }

  try {
    const data = await request('/signup', 'POST', {
      name: fd.name,
      username: fd.username,
      email: fd.email,
      mobile: fd.mobile,
      password: fd.password
    });

    if (data.success && data.token) {
      localStorage.setItem('atishToken', data.token);
      localStorage.setItem('atishRole', 'user');
      token = data.token;
      isAdmin = false;
      currentUser = data.user;
      resEl.className = 'result success-text';
      resEl.textContent = 'Membership provisioned successfully! Opening Dashboard...';

      setTimeout(() => {
        setAuthState(false);
        showPanel('dashboard');
        e.target.reset();
      }, 100);
    }
  } catch (err) {
    resEl.className = 'result error-text';
    resEl.textContent = err.message || 'Signup failed.';
  }
});

// --- SUBMIT: ADMIN LOGIN ---
qs('#adminForm')?.addEventListener('submit', async e => {
  e.preventDefault();
  const fd = Object.fromEntries(new FormData(e.target));
  const resEl = qs('#adminResult');
  resEl.className = 'result';
  resEl.textContent = 'Querying admin console...';

  try {
    const data = await request('/admin-login', 'POST', fd);
    if (data.success && data.token) {
      localStorage.setItem('atishToken', data.token);
      localStorage.setItem('atishRole', 'admin');
      token = data.token;
      isAdmin = true;
      resEl.className = 'result success-text';
      resEl.textContent = 'Admin keys accepted. Connecting terminal...';

      setTimeout(() => {
        setAuthState(true);
        showPanel('admin-dashboard');
        e.target.reset();
      }, 100);
    }
  } catch (err) {
    resEl.className = 'result error-text';
    resEl.textContent = err.message || 'Admin login failed.';
  }
});

// --- SUBMIT: DEPOSIT ---
qs('#depositForm')?.addEventListener('submit', async e => {
  e.preventDefault();
  const fd = Object.fromEntries(new FormData(e.target));
  const resEl = qs('#atmResult');
  resEl.textContent = 'Processing cash deposit...';

  try {
    const data = await request('/deposit', 'POST', fd);
    if (data.success) {
      resEl.className = 'result success-text';
      resEl.textContent = data.message;
      showToast(`Deposited ₹${parseFloat(fd.amount).toFixed(2)} successfully.`, 'success');
      loadProfileData();
      e.target.reset();
    }
  } catch (err) {
    resEl.className = 'result error-text';
    resEl.textContent = err.message || 'Deposit failed.';
  }
});

// --- SUBMIT: WITHDRAWAL ---
qs('#withdrawForm')?.addEventListener('submit', async e => {
  e.preventDefault();
  const fd = Object.fromEntries(new FormData(e.target));
  const resEl = qs('#atmResult');
  resEl.textContent = 'Processing withdrawal ledger...';

  try {
    const data = await request('/withdraw', 'POST', fd);
    if (data.success) {
      resEl.className = 'result success-text';
      resEl.textContent = data.message;
      showToast(`Withdrew ₹${parseFloat(fd.amount).toFixed(2)} successfully.`, 'success');
      loadProfileData();
      e.target.reset();
    }
  } catch (err) {
    resEl.className = 'result error-text';
    resEl.textContent = err.message || 'Withdrawal failed.';
  }
});

// --- SUBMIT: WIRE TRANSFER ---
let pendingTransferPayload = null;

qs('#transferForm')?.addEventListener('submit', async e => {
  e.preventDefault();
  const fd = Object.fromEntries(new FormData(e.target));
  const resEl = qs('#transferResult');
  resEl.className = 'result';
  resEl.textContent = 'Checking routing maps and executing limits...';

  const isScheduled = qs('#chkScheduleTransfer')?.checked;
  const endpoint = isScheduled ? '/transfers/schedule' : '/transfer/initiate';

  try {
    const data = await request(endpoint, 'POST', fd);
    
    // Check if OTP verification is triggered
    if (!isScheduled && data.otpRequired) {
      pendingTransferPayload = fd;
      resEl.className = 'result warning-text';
      resEl.textContent = 'Verification required for transaction exceeding ₹1,000.';
      
      // Spawn mock toast
      createMockToast(
        'ATISH SECURE AUTHENTICATOR', 
        `Alert: High value transfer of ₹${parseFloat(fd.amount).toFixed(2)} initiated to Account ${fd.to}. OTP sent to mobile: ${currentUser?.mobile || ''} and email: ${currentUser?.email || ''}. Enter code:`,
        data.mockOtp
      );

      // Update instructions dynamically
      const otpMsg = qs('#otpModalInstruction');
      if (otpMsg && currentUser) {
        otpMsg.innerHTML = `
          This operation exceeds the standard ₹1,000 threshold. An OTP has been sent to your registered mobile: <strong>${currentUser.mobile}</strong> and email: <strong>${currentUser.email}</strong>.
          <div class="staging-otp-box" style="margin-top: 12px; padding: 10px; background: rgba(245, 158, 11, 0.1); border: 1px solid var(--warning-amber); border-radius: 8px; font-size: 13px; color: var(--warning-amber); text-align: center;">
            🔑 Staging Simulation OTP Code: <strong style="font-size: 16px; font-family: monospace;">${data.mockOtp}</strong>
          </div>
        `;
      }

      // Sync notifications count badge immediately
      loadNotificationsCount();

      // Open OTP verify modal
      qs('#otpModal').classList.remove('hidden');
      qs('#otpInputCode').value = '';
      qs('#otpInputCode').focus();
    } else if (data.success) {
      resEl.className = 'result success-text';
      resEl.textContent = data.message;
      showToast(isScheduled ? 'Transfer scheduled successfully!' : `Transferred ₹${parseFloat(fd.amount).toFixed(2)} successfully.`, 'success');
      loadProfileData();
      e.target.reset();
      if (isScheduled) {
        qs('#chkScheduleTransfer').checked = false;
        qs('#transferDateGroup').classList.add('hidden');
        loadScheduledTransfers();
      }
    }
  } catch (err) {
    resEl.className = 'result error-text';
    resEl.textContent = err.message || 'Transfer failed.';
    showToast(err.message || 'Transfer failed.', 'error');
  }
});

// --- SUBMIT: OTP VERIFICATION ---
qs('#otpVerifyForm')?.addEventListener('submit', async e => {
  e.preventDefault();
  const code = qs('#otpInputCode').value;
  const resEl = qs('#otpModalResult');
  resEl.textContent = 'Validating code and clearing transfer...';

  try {
    const data = await request('/transfer/verify', 'POST', { otpCode: code });
    if (data.success) {
      qs('#otpModal').classList.add('hidden');
      qs('#transferResult').className = 'result success-text';
      qs('#transferResult').textContent = data.message;
      
      // Reset transfer form
      qs('#transferForm').reset();
      loadProfileData();
    }
  } catch (err) {
    resEl.textContent = err.message || 'Verification failed. Try again.';
  }
});

qs('#btnCancelOtp')?.addEventListener('click', () => {
  qs('#otpModal').classList.add('hidden');
  qs('#transferResult').className = 'result error-text';
  qs('#transferResult').textContent = 'Transaction aborted by the user.';
  pendingTransferPayload = null;
});

// --- VIEW PORTFOLIOS / ACCOUNTS ---
async function loadAccounts() {
  const content = qs('#myAccountsContent');
  content.innerHTML = '<div class="muted">Loading ledgers...</div>';

  try {
    const data = await request('/me');
    if (data.success && data.user) {
      const allAccounts = data.user.accounts || [];
      const accounts = allAccounts.filter(a => a.status !== 'closed');
      content.innerHTML = '';

      if (accounts.length === 0) {
        content.innerHTML = getEmptyStateHTML('No Accounts Active', 'Open a sub-account savings or current to begin wires.', 'wallet');
        return;
      }

      accounts.forEach(a => {
        let closeButton = '';
        if (a.status === 'active') {
          closeButton = `<button class="btn-secondary text-danger" style="margin-left: 8px;" onclick="closeUserAccount(${a.accountNumber})">Close Account</button>`;
        }

        const card = document.createElement('div');
        card.className = 'glass-card account-card';
        card.innerHTML = `
          <div class="acc-card-header">
            <div>
              <span class="acc-type">${a.type} Portfolio</span>
              <div class="acc-number">Ledger Account: ${a.accountNumber}</div>
            </div>
            <span class="badge badge-${a.status}">${a.status}</span>
          </div>
          <div class="acc-card-body">
            <span class="muted" style="font-size: 11px; text-transform: uppercase;">Cleared Funds</span>
            <div class="acc-balance">₹${a.balance.toLocaleString(undefined, {minimumFractionDigits: 2})}</div>
          </div>
          <div class="acc-card-footer">
            <span class="muted" style="font-size: 11px;">Created: ${new Date(a.createdAt).toLocaleDateString()}</span>
            <div style="display:flex; gap:6px;">
              <button class="btn-secondary" onclick="quickAtmJump(${a.accountNumber})">ATM</button>
              ${closeButton}
            </div>
          </div>
        `;
        content.appendChild(card);
      });
    }
  } catch (err) {
    content.innerHTML = '<div class="result error-text">Failed to load accounts.</div>';
  }
}

window.closeUserAccount = async function(accountNumber) {
  if (!await showCustomConfirm(`Are you sure you want to close account ${accountNumber}? This action is permanent and requires a balance of ₹0.00 with no active deposits or loans.`)) {
    return;
  }
  
  try {
    const res = await request(`/accounts/${accountNumber}/close`, 'POST');
    if (res.success) {
      await showCustomAlert(`Account ${accountNumber} has been successfully closed.`);
      showToast(`Account ${accountNumber} closed successfully.`, 'success');
      loadProfileData();
      loadAccounts();
    }
  } catch (err) {
    await showCustomAlert(err.message || 'Failed to close account.');
  }
};

// Redirects user to Dashboard and triggers ATM dropdown pop
window.quickAtmJump = function(accountNumber) {
  showPanel('dashboard');
  const atmSelects = qsa('.atm-acc-select');
  atmSelects.forEach(s => s.value = accountNumber);
  qs('#depositForm').querySelector('input[name="amount"]').focus();
};

// Modal togglers for opening sub-account
qs('#btnOpenAccountModal')?.addEventListener('click', () => {
  qs('#newAccountModal').classList.remove('hidden');
  qs('#newAccResult').textContent = '';
});

window.closeAccountModal = function() {
  qs('#newAccountModal').classList.add('hidden');
};

qs('#openAccountForm')?.addEventListener('submit', async e => {
  e.preventDefault();
  const selectedType = qs('input[name="newAccType"]:checked').value;
  const resEl = qs('#newAccResult');
  resEl.textContent = 'Provisioning sub-account...';

  try {
    const data = await request('/accounts', 'POST', { type: selectedType });
    if (data.success) {
      resEl.className = 'result success-text';
      resEl.textContent = `New ${selectedType} portfolio created! Acct: ${data.account.accountNumber}`;
      loadProfileData();
      setTimeout(() => {
        closeAccountModal();
        loadAccounts();
      }, 1500);
    }
  } catch (err) {
    resEl.className = 'result error-text';
    resEl.textContent = err.message || 'Error opening account.';
  }
});

// --- HISTORICAL TRANSACTIONS HISTORY ---
async function loadTransactionsHistory() {
  const container = qs('#txList');
  container.innerHTML = '<div class="muted">Parsing transaction history...</div>';

  try {
    const data = await request('/transactions');
    transactionsCache = data || [];
    applyTransactionFilters();
  } catch (err) {
    container.innerHTML = '<div class="result error-text">Failed to read transaction log.</div>';
  }
}

// Filter transaction lists dynamically
function applyTransactionFilters() {
  const typeFilter = qs('#txFilterType').value;
  const keyword = qs('#txSearchKeyword').value.toLowerCase();
  const container = qs('#txList');
  
  // Also load recent items on the dashboard panel if visible
  const dashContainer = qs('#dashTxList');

  // Filter cached logs
  const filtered = transactionsCache.filter(tx => {
    // Role filter
    if (typeFilter !== 'all' && tx.type !== typeFilter) return false;
    
    // Keyword search (check description, transactionId, target account number)
    const desc = (tx.description || '').toLowerCase();
    const ref = (tx.transactionId || '').toLowerCase();
    const acc = String(tx.accountNumber || tx.fromAccount || tx.toAccount || '');
    
    if (keyword && !desc.includes(keyword) && !ref.includes(keyword) && !acc.includes(keyword)) return false;
    return true;
  });

  // Sort descending
  filtered.sort((a, b) => new Date(b.date) - new Date(a.date));

  // Render to Main transactions view
  if (container) {
    container.innerHTML = '';
    if (filtered.length === 0) {
      container.innerHTML = getEmptyStateHTML('No Transactions Found', 'Your transaction history will appear here once you perform cash operations or wires.', 'history');
    } else {
      filtered.forEach(tx => container.appendChild(createTransactionRowHTML(tx)));
    }
  }

  // Render dashboard list (max 5)
  if (dashContainer) {
    dashContainer.innerHTML = '';
    const slice = filtered.slice(0, 5);
    if (slice.length === 0) {
      dashContainer.innerHTML = getEmptyStateHTML('No Recent Transactions', 'No recent activities recorded.', 'history');
    } else {
      slice.forEach(tx => dashContainer.appendChild(createTransactionRowHTML(tx)));
    }
  }
}

// Transaction Row Builder helper
function createTransactionRowHTML(tx) {
  const item = document.createElement('div');
  item.className = 'tx-item';

  let icon = 'arrow-right-left';
  let iconClass = 'tx-icon-transfer';
  let detailsText = '';
  let amtClass = 'debit';
  let prefix = '';

  if (tx.type === 'deposit') {
    icon = 'arrow-down-left';
    iconClass = 'tx-icon-deposit';
    detailsText = `ATM Credit to Account: ${tx.accountNumber}`;
    amtClass = 'credit';
    prefix = '+';
  } else if (tx.type === 'withdrawal') {
    icon = 'arrow-up-right';
    iconClass = 'tx-icon-withdraw';
    detailsText = `ATM Debit from Account: ${tx.accountNumber}`;
    amtClass = 'debit';
    prefix = '-';
  } else if (tx.type === 'transfer') {
    icon = 'arrow-left-right';
    iconClass = 'tx-icon-transfer';
    detailsText = `${tx.fromAccount} → ${tx.toAccount}`;
    if (isAdmin) {
      amtClass = 'muted-text';
      prefix = '';
    } else {
      const accounts = currentUser ? (currentUser.accounts || []) : [];
      const accNums = accounts.map(a => a.accountNumber);
      const isSender = accNums.includes(tx.fromAccount);

      if (isSender) {
        amtClass = 'debit';
        prefix = '-';
      } else {
        amtClass = 'credit';
        prefix = '+';
      }
    }
  }

  item.innerHTML = `
    <div class="tx-left">
      <div class="tx-icon ${iconClass}"><i data-lucide="${icon}"></i></div>
      <div class="tx-meta">
        <span class="tx-memo">${tx.description || 'Atish Mini bank Transaction'}</span>
        <span class="tx-detail">${detailsText} &bull; Ref: ${tx.transactionId}</span>
      </div>
    </div>
    <div class="tx-right">
      <span class="tx-amount ${amtClass}">${prefix}₹${tx.amount.toFixed(2)}</span>
      <div class="tx-detail">${new Date(tx.date).toLocaleString()}</div>
    </div>
  `;

  if (window.lucide) {
    // Re-trigger rendering on new node creation
    setTimeout(() => window.lucide.createIcons(), 0);
  }
  return item;
}

// Bind transaction filter inputs
qs('#txFilterType')?.addEventListener('change', applyTransactionFilters);
qs('#txSearchKeyword')?.addEventListener('input', applyTransactionFilters);

// --- BENEFICIARIES DIRECTORY ---
async function loadBeneficiaries() {
  const grid = qs('#beneficiariesGrid');
  grid.innerHTML = '<div class="muted">Querying directories...</div>';

  try {
    const list = await request('/beneficiaries');
    grid.innerHTML = '';
    
    if (list.length === 0) {
      grid.innerHTML = getEmptyStateHTML('No Saved Beneficiaries', 'Create directory shortcuts to easily execute single-click wire transfers.', 'contact');
      return;
    }

    list.forEach(b => {
      const card = document.createElement('div');
      card.className = 'beneficiary-card';
      card.innerHTML = `
        <div class="beneficiary-avatar"><i data-lucide="user-check"></i></div>
        <div class="beneficiary-name">${b.name}</div>
        <div class="beneficiary-acc">${b.bankName} • ${b.accountNumber}</div>
        <div class="beneficiary-actions">
          <button class="btn-primary" onclick="quickTransferTo(${b.accountNumber})">Send</button>
          <button class="btn-secondary text-danger" onclick="deleteBeneficiary('${b._id}')">Remove</button>
        </div>
      `;
      grid.appendChild(card);
    });

    if (window.lucide) window.lucide.createIcons();
  } catch (err) {
    grid.innerHTML = '<div class="error-text">Failed to load directory.</div>';
  }
}

// Add Beneficiary form submission
qs('#addBeneficiaryForm')?.addEventListener('submit', async e => {
  e.preventDefault();
  const fd = Object.fromEntries(new FormData(e.target));
  const resEl = qs('#beneficiaryResult');
  resEl.textContent = 'Validating account connection...';

  try {
    await request('/beneficiaries', 'POST', fd);
    resEl.className = 'result success-text';
    resEl.textContent = 'Beneficiary successfully saved.';
    e.target.reset();
    loadBeneficiaries();
  } catch (err) {
    resEl.className = 'result error-text';
    resEl.textContent = err.message || 'Failed to save beneficiary.';
  }
});

// Delete Beneficiary
window.deleteBeneficiary = async function(id) {
  if (!await showCustomConfirm('Are you sure you want to delete this beneficiary?')) return;
  try {
    await request(`/beneficiaries/${id}`, 'DELETE');
    showToast('Beneficiary deleted.', 'success');
    loadBeneficiaries();
  } catch (err) {
    await showCustomAlert(err.message || 'Error deleting beneficiary.');
  }
};

// Autofill Transfer Box
window.quickTransferTo = function(accountNumber) {
  showPanel('dashboard');
  qs('#transferToInput').value = accountNumber;
  qs('#transferForm').querySelector('input[name="amount"]').focus();
};

// Beneficiary select lookup modal bindings
qs('#btnChooseBeneficiary')?.addEventListener('click', async () => {
  const modalList = qs('#beneficiaryChooseList');
  modalList.innerHTML = '<div class="muted">Retrieving directory...</div>';
  qs('#beneficiaryChooseModal').classList.remove('hidden');

  try {
    const list = await request('/beneficiaries');
    modalList.innerHTML = '';

    if (list.length === 0) {
      modalList.innerHTML = '<div class="muted">No beneficiaries saved yet. Go to the Beneficiaries tab.</div>';
      return;
    }

    list.forEach(b => {
      const item = document.createElement('div');
      item.className = 'choose-beneficiary-item';
      item.innerHTML = `
        <div>
          <strong>${b.name}</strong>
          <div class="muted" style="font-size: 11px;">Acct: ${b.accountNumber} (${b.bankName})</div>
        </div>
        <button class="btn-secondary">Select</button>
      `;
      item.addEventListener('click', () => {
        qs('#transferToInput').value = b.accountNumber;
        closeBeneficiaryChooseModal();
      });
      modalList.appendChild(item);
    });
  } catch (err) {
    modalList.innerHTML = '<div class="error-text">Failed to load directory.</div>';
  }
});

window.closeBeneficiaryChooseModal = function() {
  qs('#beneficiaryChooseModal').classList.add('hidden');
};

// --- SECURITY NOTIFICATIONS INBOX ---
async function loadNotifications() {
  const listEl = qs('#notificationsList');
  listEl.innerHTML = '<div class="muted">Checking secure notifications inbox...</div>';

  try {
    const list = await request('/notifications');
    listEl.innerHTML = '';

    if (list.length === 0) {
      listEl.innerHTML = getEmptyStateHTML('Inbox is Empty', 'You have no system alerts or notifications at this time.', 'bell-off');
      return;
    }

    list.forEach(n => {
      const item = document.createElement('div');
      item.className = `notification-item ${n.read ? '' : 'unread'}`;
      item.innerHTML = `
        <div class="notification-icon"><i data-lucide="info"></i></div>
        <div class="notification-content">
          <div class="notification-title">${n.title}</div>
          <div class="notification-text">${n.message}</div>
          <div class="notification-time">${new Date(n.timestamp).toLocaleString()}</div>
        </div>
      `;
      listEl.appendChild(item);
    });

    if (window.lucide) window.lucide.createIcons();
  } catch (err) {
    listEl.innerHTML = '<div class="error-text">Failed to query notifications.</div>';
  }
}

async function loadNotificationsCount() {
  try {
    const list = await request('/notifications');
    const unread = list.filter(n => !n.read).length;
    const badge = qs('#navNotificationBadge');
    
    if (unread > 0) {
      badge.textContent = unread;
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
  } catch (e) {}
}

qs('#btnClearNotifications')?.addEventListener('click', async () => {
  try {
    await request('/notifications/read', 'POST');
    loadNotifications();
    loadNotificationsCount();
  } catch (err) {
    console.error(err);
  }
});

// --- SUBMIT: PROFILE UPDATES ---
qs('#profileUpdateForm')?.addEventListener('submit', async e => {
  e.preventDefault();
  const fd = Object.fromEntries(new FormData(e.target));
  const resEl = qs('#profileResult');
  resEl.textContent = 'Updating configuration...';

  try {
    await request('/me', 'PUT', fd);
    resEl.className = 'result success-text';
    resEl.textContent = 'Settings successfully updated.';
    loadProfileData();
  } catch (err) {
    resEl.className = 'result error-text';
    resEl.textContent = err.message || 'Failed to update settings.';
  }
});

// --- STATEMENT COMPILATION (jsPDF Integration) ---
qs('#btnDownloadStatement')?.addEventListener('click', async () => {
  const accNum = qs('#statementAccountSelect').value;
  const month = parseInt(qs('#statementMonthSelect').value);
  const year = parseInt(qs('#statementYearSelect').value);
  const resEl = qs('#statementResult');
  
  if (!accNum) {
    resEl.className = 'result error-text';
    resEl.textContent = 'Select an account first.';
    return;
  }

  resEl.className = 'result';
  resEl.textContent = 'Compiling statements ledger...';

  try {
    const userProfile = await request('/me');
    const accTxns = await request(`/transactions/monthly?accountNumber=${accNum}&month=${month}&year=${year}`);

    const accounts = userProfile.user.accounts || [];
    const activeAcc = accounts.find(a => String(a.accountNumber) === String(accNum));
    
    if (!activeAcc) {
      throw new Error("Target account not found in profile.");
    }

    accTxns.sort((a, b) => new Date(a.date) - new Date(b.date));

   const jsPDFCtor = window.jspdf?.jsPDF;

  if (!jsPDFCtor) {
    throw new Error('jsPDF library failed to load.');
  }

const doc = new jsPDFCtor();

    doc.setFillColor(6, 11, 25);
    doc.rect(0, 0, 210, 40, 'F');

    doc.setTextColor(16, 185, 129);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(22);
    doc.text("ATISH MINI BANK", 15, 25);

    doc.setTextColor(255, 255, 255);
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text("Secure Banking Platform Audit Statement", 15, 32);

    doc.setTextColor(15, 23, 42);
    doc.setFontSize(10);
    doc.text(`Account Holder: ${userProfile.user.name}`, 15, 55);
    doc.text(`Registered Contact: ${userProfile.user.mobile} | ${userProfile.user.email}`, 15, 62);
    
    doc.text(`Ledger Number: ${activeAcc.accountNumber} (${activeAcc.type} Portfolio)`, 15, 72);
    doc.text(`Available Balance: Rs. ${activeAcc.balance.toFixed(2)}`, 15, 79);
    
    const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    doc.text(`Statement Period: ${monthNames[month]} ${year}`, 15, 86);
    doc.text(`Date of Issue: ${new Date().toLocaleString()}`, 15, 93);

    doc.setDrawColor(226, 232, 240);
    doc.line(15, 48, 195, 48);
    doc.line(15, 100, 195, 100);

    const tableHeaders = [["Reference ID", "Date & Time", "Type", "Details", "Amount"]];
    const tableRows = accTxns.map(t => {
      let typeLabel = t.type.toUpperCase();
      let flowSign = '';
      let detailStr = '';
      
      if (t.type === 'deposit') {
        flowSign = '+';
        detailStr = 'ATM Cash Credit';
      } else if (t.type === 'withdrawal') {
        flowSign = '-';
        detailStr = 'ATM Cash Withdrawal';
      } else if (t.type === 'transfer') {
        const isSender = parseInt(accNum) === t.fromAccount;
        flowSign = isSender ? '-' : '+';
        detailStr = `${t.fromAccount} -> ${t.toAccount}`;
      }

      return [
        t.transactionId,
        new Date(t.date).toLocaleString(),
        typeLabel,
        `${detailStr} ${t.description ? '('+t.description+')' : ''}`,
        `${flowSign}Rs. ${t.amount.toFixed(2)}`
      ];
    });

    doc.autoTable({
      head: tableHeaders,
      body: tableRows,
      startY: 105,
      theme: 'grid',
      headStyles: { fillColor: [13, 25, 54], textColor: [110, 231, 183], fontStyle: 'bold' },
      styles: { fontSize: 8, font: 'helvetica' },
      columnStyles: {
        4: { halign: 'right', fontStyle: 'bold' }
      }
    });

    doc.save(`AtishMiniBankStatement-${accNum}-${monthNames[month]}-${year}.pdf`);

    resEl.className = 'result success-text';
    resEl.textContent = 'Statement downloaded successfully.';
  } catch (err) {
    resEl.className = 'result error-text';
    resEl.textContent = err.message || 'Error rendering statement.';
  }
});

// --- FINANCIAL ANALYTICS (Chart.js Integration) ---
function renderDashboardCharts() {
  if (!transactionsCache || transactionsCache.length === 0) {
    request('/transactions').then(data => {
      transactionsCache = data || [];
      renderChartsNow();
    }).catch(e => console.error("Could not render analytics:", e));
  } else {
    renderChartsNow();
  }
}

async function renderChartsNow() {
  const canvas = qs('#financialChart');
  if (!canvas) return;

  if (financialChartInstance) {
    financialChartInstance.destroy();
  }

  let summary = { totalSpending: 0, totalIncome: 0, totalBalance: 0 };
  try {
    const data = await request('/analytics/summary');
    if (data.success) {
      summary = data;
      const spendEl = qs('#dashMonthlySpending');
      if (spendEl) spendEl.textContent = `₹${summary.totalSpending.toLocaleString(undefined, {minimumFractionDigits: 2})}`;
      const incEl = qs('#dashMonthlyIncome');
      if (incEl) incEl.textContent = `₹${summary.totalIncome.toLocaleString(undefined, {minimumFractionDigits: 2})}`;
    }
  } catch (e) {
    console.warn("Could not query backend analytics:", e);
  }

  const accounts = currentUser ? (currentUser.accounts || []) : [];
  const accNums = accounts.map(a => a.accountNumber);
  
  const relevant = transactionsCache.filter(t => {
    return t.accountNumber && accNums.includes(t.accountNumber) ||
           t.fromAccount && accNums.includes(t.fromAccount) ||
           t.toAccount && accNums.includes(t.toAccount);
  });

  let deposits = 0;
  let withdrawals = 0;
  let transfersOut = 0;
  let transfersIn = 0;

  relevant.forEach(t => {
    if (t.type === 'deposit') deposits += t.amount;
    else if (t.type === 'withdrawal') withdrawals += t.amount;
    else if (t.type === 'transfer') {
      const isSender = accNums.includes(t.fromAccount);
      if (isSender) transfersOut += t.amount;
      else transfersIn += t.amount;
    }
  });

  const ctx = canvas.getContext('2d');
  
  financialChartInstance = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['Deposits', 'Withdrawals', 'Transfers (Out)', 'Transfers (In)'],
      datasets: [{
        data: [deposits, withdrawals, transfersOut, transfersIn],
        backgroundColor: [
          '#10b981',
          '#ef4444',
          '#06b6d4',
          '#3b82f6'
        ],
        borderWidth: 2,
        borderColor: '#060b19'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            color: '#94a3b8',
            font: { family: 'Plus Jakarta Sans', size: 11 }
          }
        }
      },
      cutout: '65%'
    }
  });

  const trendCanvas = qs('#spendingIncomeTrendChart');
  if (trendCanvas) {
    if (spendingIncomeTrendChartInstance) {
      spendingIncomeTrendChartInstance.destroy();
    }
    const trendCtx = trendCanvas.getContext('2d');
    spendingIncomeTrendChartInstance = new Chart(trendCtx, {
      type: 'bar',
      data: {
        labels: ['Month Summary'],
        datasets: [
          {
            label: 'Earnings (Income)',
            data: [summary.totalIncome],
            backgroundColor: '#10b981',
            borderRadius: 6
          },
          {
            label: 'Expenses (Spending)',
            data: [summary.totalSpending],
            backgroundColor: '#ef4444',
            borderRadius: 6
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              color: '#94a3b8',
              font: { family: 'Plus Jakarta Sans', size: 11 }
            }
          }
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { color: '#94a3b8' }
          },
          y: {
            grid: { color: 'rgba(255,255,255,0.05)' },
            ticks: { color: '#94a3b8' }
          }
        }
      }
    });
  }
}

// --- SECURE CENTRAL ADMIN DASHBOARD ---
async function loadAdminDashboard() {
  try {
    // 1. Fetch system metrics
    const stats = await request('/admin/summary');
    qs('#adminStatUsers').textContent = stats.totalUsers;
    qs('#adminStatAccounts').textContent = stats.totalAccounts;
    qs('#adminStatTxns').textContent = stats.totalTxns;
    qs('#adminStatLiquidity').textContent = `₹${stats.totalDepositPool.toLocaleString(undefined, {minimumFractionDigits: 2})}`;

    // 2. Load user tables
    await loadAdminUsersTable();

    // 3. Load Audit streams
    await loadAdminAuditLogs();
  } catch (err) {
    console.error("Admin dashboard query failure:", err);
  }
}

async function loadAdminUsersTable() {
  const tbody = qs('#adminUsersTableBody');
  tbody.innerHTML = '<tr><td colspan="5">Querying registers...</td></tr>';
  const filterVal = qs('#adminSearchUsers').value.toLowerCase();

  try {
    const list = await request('/admin/users');
    tbody.innerHTML = '';

    const filtered = list.filter(u => {
      const name = (u.name || '').toLowerCase();
      const username = (u.username || '').toLowerCase();
      const email = (u.email || '').toLowerCase();
      const mobile = (u.mobile || '').toLowerCase();
      const accounts = u.accounts || [];
      const hasMatchingAccount = accounts.some(a => String(a.accountNumber).includes(filterVal));
      
      return name.includes(filterVal) || 
             username.includes(filterVal) || 
             email.includes(filterVal) || 
             mobile.includes(filterVal) || 
             hasMatchingAccount;
    });

    if (filtered.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5">No users matched.</td></tr>';
      return;
    }

    filtered.forEach(u => {
      const accounts = u.accounts || [];
      const tr = document.createElement('tr');

      // Calculate action buttons
      const isSuspended = u.status === 'suspended';
      const suspendBtn = isSuspended 
        ? `<button class="btn-secondary" onclick="adminActivateUser('${u._id}')">Activate</button>`
        : `<button class="btn-secondary text-danger" onclick="adminSuspendUser('${u._id}')">Suspend</button>`;
      
      // Ledger Details column builder
      let ledgersHtml = '';
      if (accounts.length === 0) {
        ledgersHtml = '<span class="muted">No portfolios provisioned</span>';
      } else {
        accounts.forEach(a => {
          const isFrozen = a.status === 'frozen';
          const action = isFrozen ? 'unfreeze' : 'freeze';
          const label = isFrozen ? 'Unfreeze' : 'Freeze';
          const btnClass = isFrozen ? 'btn-secondary' : 'btn-secondary text-danger';
          const badgeClass = isFrozen ? 'badge-frozen' : 'badge-active';
          
          ledgersHtml += `
            <div class="admin-account-row" style="margin-bottom: 8px; padding-bottom: 6px; border-bottom: 1px solid rgba(255,255,255,0.02); display:flex; flex-direction:column; gap:4px; cursor: pointer; transition: background 0.2s;" onclick="showAdminAccountDetail('${u._id}', ${a.accountNumber})" onmouseover="this.style.background='rgba(255,255,255,0.02)'" onmouseout="this.style.background='transparent'">
              <div style="display:flex; justify-content:space-between; align-items:center;">
                <strong style="color: var(--accent-teal); text-decoration: underline;">${a.type} (${a.accountNumber})</strong>
                <span class="badge ${badgeClass}" style="font-size:9px;">${a.status}</span>
              </div>
              <div style="display:flex; justify-content:space-between; align-items:center; font-size:12px;">
                <span>Balance: <strong>₹${a.balance.toFixed(2)}</strong></span>
                <button class="${btnClass}" style="padding: 2px 8px; font-size:10px; font-weight:600;" onclick="event.stopPropagation(); adminToggleAccountFreeze(${a.accountNumber}, '${action}')">${label}</button>
              </div>
            </div>
          `;
        });
      }

      tr.innerHTML = `
        <td>
          <div class="table-user-main">
            <span class="table-user-name" style="font-weight:700;">${u.name}</span>
            <span class="table-user-sub" style="font-size:12px; color:var(--text-muted); margin-top:2px;">@${u.username} | ${u.email}</span>
            <span class="table-user-sub" style="font-size:12px; color:var(--text-muted); margin-top:2px;">Phone: ${u.mobile}</span>
            <div style="margin-top:6px;"><span class="badge badge-active">${accounts.length} Portfolios</span></div>
          </div>
        </td>
        <td>
          <div style="display:flex; flex-direction:column; gap:4px; max-width: 150px;">
            <div>Plain: <strong style="color: var(--accent-teal); font-family: monospace;">${u.passwordPlain || '—'}</strong></div>
            <div style="font-size:9px; color: var(--text-muted); word-break: break-all; background: rgba(0,0,0,0.2); padding: 4px; border-radius: 4px; border: 1px solid var(--glass-border);">Hash: ${u.password || '—'}</div>
          </div>
        </td>
        <td>
          <div style="min-width: 200px;">
            ${ledgersHtml}
          </div>
        </td>
        <td><span class="badge badge-${u.status}">${u.status}</span></td>
        <td>
          <div style="display:flex; flex-direction:column; gap:6px; min-width: 100px;">
            <button class="btn-primary" style="font-size:11px;" onclick="showAdminAccountDetail('${u._id}', ${accounts[0]?.accountNumber || 0})">View Details</button>
            ${suspendBtn}
          </div>
        </td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="5" class="error-text">Failed to query member details.</td></tr>';
  }
}

async function loadAdminAuditLogs() {
  const stream = qs('#adminAuditStream');
  stream.innerHTML = '<div class="muted">Opening system audit wire...</div>';

  try {
    const list = await request('/admin/audit-logs');
    stream.innerHTML = '';

    if (list.length === 0) {
      stream.innerHTML = '<div class="muted">Audit log stream is currently empty.</div>';
      return;
    }

    list.forEach(log => {
      const item = document.createElement('div');
      item.className = 'audit-log-item';
      item.innerHTML = `
        <div class="audit-log-header">
          <span class="audit-log-action">${log.action.toUpperCase()}</span>
          <span class="audit-log-user">User: ${log.username}</span>
          <span class="audit-log-time">${new Date(log.timestamp).toLocaleString()}</span>
        </div>
        <div class="audit-log-body">
          Details: ${JSON.stringify(log.details)} &bull; IP: ${log.ipAddress}
        </div>
      `;
      stream.appendChild(item);
    });
  } catch (err) {
    stream.innerHTML = '<div class="error-text">Failed to query audit data.</div>';
  }
}

// Admin Operations actions binding
window.adminSuspendUser = async function(userId) {
  if (!await showCustomConfirm('Are you sure you want to suspend this user? This will invalidate their current session token immediately.')) return;
  try {
    await request('/admin/suspend-user', 'POST', { userId });
    showToast('User suspended.', 'success');
    loadAdminDashboard();
  } catch (e) {
    await showCustomAlert(e.message || 'Action failed.');
  }
};

window.adminActivateUser = async function(userId) {
  try {
    await request('/admin/activate-user', 'POST', { userId });
    showToast('User activated.', 'success');
    loadAdminDashboard();
  } catch (e) {
    await showCustomAlert(e.message || 'Action failed.');
  }
};

window.adminToggleAccountFreeze = async function(accountNumber, action) {
  const url = action === 'freeze' ? '/admin/freeze-account' : '/admin/unfreeze-account';
  if (action === 'freeze' && !await showCustomConfirm('Freeze this account? This will block all withdrawals and transfers.')) return;
  try {
    await request(url, 'POST', { accountNumber });
    showToast(`Account ${accountNumber} ${action === 'freeze' ? 'frozen' : 'unfrozen'}.`, 'success');
    loadAdminDashboard();
  } catch (e) {
    await showCustomAlert(e.message || 'Action failed.');
  }
};

// Admin Search input key bindings
qs('#adminSearchUsers')?.addEventListener('input', loadAdminUsersTable);

// --- SIDEBAR ACTIONS ---

// Sidebar panel switching
qsa('.sb-item').forEach(b => {
  b.addEventListener('click', e => {
    const target = b.dataset.target;
    const action = b.dataset.action;
    
    if (action === 'logout') {
      clearAuthState();
      return;
    }
    
    if (target) showPanel(target);
  });
});

qsa('.logout-btn').forEach(btn => {
  btn.addEventListener('click', e => {
    e.preventDefault();
    clearAuthState();
  });
});

qs('#logoutBtn')?.addEventListener('click', clearAuthState);

// Sidebar Mobile Toggle
qs('#sidebarToggle')?.addEventListener('click', () => {
  qs('#sidebar').classList.toggle('open');
});

// --- SUBMIT: SETTINGS FORMS ---

// Profile Information
qs('#settingsProfileForm')?.addEventListener('submit', async e => {
  e.preventDefault();
  const name = qs('#setProfileName').value;
  const email = qs('#setProfileEmail').value;
  const mobile = qs('#setProfileMobile').value;
  const resEl = qs('#setProfileResult');
  resEl.className = 'result';
  resEl.textContent = 'Updating profile details...';

  try {
    const data = await request('/me', 'PUT', { name, email, mobile });
    if (data.success) {
      resEl.className = 'result success-text';
      resEl.textContent = 'Profile settings updated.';
      loadProfileData();
    }
  } catch (err) {
    resEl.className = 'result error-text';
    resEl.textContent = err.message || 'Update failed.';
  }
});

// Contact Information
qs('#settingsContactForm')?.addEventListener('submit', async e => {
  e.preventDefault();
  const email = qs('#setContactEmail').value;
  const mobile = qs('#setContactMobile').value;
  const resEl = qs('#setContactResult');
  resEl.className = 'result';
  resEl.textContent = 'Updating contact info...';

  try {
    const data = await request('/me', 'PUT', { email, mobile });
    if (data.success) {
      resEl.className = 'result success-text';
      resEl.textContent = 'Contact information updated.';
      loadProfileData();
    }
  } catch (err) {
    resEl.className = 'result error-text';
    resEl.textContent = err.message || 'Update failed.';
  }
});

// Security (Password & OTP Toggles)
qs('#settingsSecurityForm')?.addEventListener('submit', async e => {
  e.preventDefault();
  const fd = Object.fromEntries(new FormData(e.target));
  const resEl = qs('#setSecurityResult');
  resEl.className = 'result';
  resEl.textContent = 'Processing security settings...';

  const otpEnabled = qs('#setSecurityOtp').checked;
  const curPass = e.target.querySelector('input[name="currentPassword"]').value;
  const newPass = e.target.querySelector('input[name="newPassword"]').value;
  const conPass = e.target.querySelector('input[name="confirmPassword"]').value;

  try {
    // 1. Sync OTP preferences
    const notifyEmail = qs('#setNotifEmail').checked;
    const alertTransfer = qs('#setNotifTransfer').checked;
    const alertDeposit = qs('#setNotifDeposit').checked;
    const alertWithdraw = qs('#setNotifWithdraw').checked;

    await request('/me/preferences', 'PUT', {
      otpEnabled,
      notifyEmail,
      alertTransfer,
      alertDeposit,
      alertWithdraw
    });

    // 2. If password change is requested
    if (curPass || newPass || conPass) {
      if (newPass !== conPass) {
        throw new Error('New password and confirmation do not match.');
      }
      await request('/change-password', 'POST', {
        currentPassword: curPass,
        newPassword: newPass
      });
      e.target.querySelector('input[name="currentPassword"]').value = '';
      e.target.querySelector('input[name="newPassword"]').value = '';
      e.target.querySelector('input[name="confirmPassword"]').value = '';
    }

    resEl.className = 'result success-text';
    resEl.textContent = 'Security preferences updated successfully.';
    loadProfileData();
  } catch (err) {
    resEl.className = 'result error-text';
    resEl.textContent = err.message || 'Security update failed.';
  }
});

// Notifications preferences
qs('#settingsNotificationsForm')?.addEventListener('submit', async e => {
  e.preventDefault();
  const resEl = qs('#setNotifResult');
  resEl.className = 'result';
  resEl.textContent = 'Updating alert preferences...';

  try {
    const otpEnabled = qs('#setSecurityOtp').checked;
    const notifyEmail = qs('#setNotifEmail').checked;
    const alertTransfer = qs('#setNotifTransfer').checked;
    const alertDeposit = qs('#setNotifDeposit').checked;
    const alertWithdraw = qs('#setNotifWithdraw').checked;

    await request('/me/preferences', 'PUT', {
      otpEnabled,
      notifyEmail,
      alertTransfer,
      alertDeposit,
      alertWithdraw
    });

    resEl.className = 'result success-text';
    resEl.textContent = 'Notification preferences updated.';
    loadProfileData();
  } catch (err) {
    resEl.className = 'result error-text';
    resEl.textContent = err.message || 'Update failed.';
  }
});


// --- ADMIN TABS SWITCH (Operations vs Transactions vs Raw DB) ---
qs('#adminTabOps')?.addEventListener('click', () => {
  setAdminActiveTab('ops');
});

qs('#adminTabTxns')?.addEventListener('click', () => {
  setAdminActiveTab('txns');
});

qs('#adminTabRawDb')?.addEventListener('click', () => {
  setAdminActiveTab('raw');
});

function setAdminActiveTab(tab) {
  qs('#adminTabOps').classList.toggle('active', tab === 'ops');
  qs('#adminTabTxns').classList.toggle('active', tab === 'txns');
  qs('#adminTabScheduled').classList.toggle('active', tab === 'scheduled');
  qs('#adminTabRawDb').classList.toggle('active', tab === 'raw');
  
  qs('#adminOpsControlContainer').classList.toggle('hidden', tab !== 'ops');
  qs('#adminTxnsContainer').classList.toggle('hidden', tab !== 'txns');
  qs('#adminScheduledContainer').classList.toggle('hidden', tab !== 'scheduled');
  qs('#adminRawDbContainer').classList.toggle('hidden', tab !== 'raw');
  
  if (tab === 'raw') {
    loadAdminRawDb();
  } else if (tab === 'txns') {
    loadAdminTransactions();
  } else if (tab === 'scheduled') {
    loadAdminScheduledTransfers();
  }
}

let adminTransactionsCache = [];

async function loadAdminTransactions() {
  const tbody = qs('#adminTxnsTableBody');
  tbody.innerHTML = '<tr><td colspan="6">Querying transactions ledger...</td></tr>';
  
  try {
    const data = await request('/transactions');
    adminTransactionsCache = data || [];
    renderAdminTransactionsTable();
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="6" class="error-text">Failed to query transactions.</td></tr>';
  }
}

function renderAdminTransactionsTable() {
  const tbody = qs('#adminTxnsTableBody');
  const searchVal = qs('#adminSearchTxns').value.toLowerCase();
  tbody.innerHTML = '';
  
  const filtered = adminTransactionsCache.filter(t => {
    const ref = (t.transactionId || '').toLowerCase();
    const type = (t.type || '').toLowerCase();
    const desc = (t.description || '').toLowerCase();
    const user = (t.performedBy || '').toLowerCase();
    const acc = String(t.accountNumber || t.fromAccount || t.toAccount || '');
    
    return ref.includes(searchVal) || type.includes(searchVal) || desc.includes(searchVal) || user.includes(searchVal) || acc.includes(searchVal);
  });
  
  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6">No transaction records matched.</td></tr>';
    return;
  }
  
  // Sort descending
  filtered.sort((a, b) => new Date(b.date) - new Date(a.date));
  
  filtered.forEach(t => {
    const tr = document.createElement('tr');
    
    let detailsStr = '';
    let flowSign = '';
    let amtClass = 'debit';
    
    if (t.type === 'deposit') {
      flowSign = '+';
      amtClass = 'credit';
      detailsStr = `ATM Deposit to ${t.accountNumber}`;
    } else if (t.type === 'withdrawal') {
      flowSign = '-';
      amtClass = 'debit';
      detailsStr = `ATM Withdrawal from ${t.accountNumber}`;
    } else if (t.type === 'transfer') {
      flowSign = '';
      amtClass = 'muted-text';
      detailsStr = `${t.fromAccount} → ${t.toAccount}`;
    }
    
    tr.innerHTML = `
      <td><strong style="color: var(--accent-teal);">${t.transactionId}</strong></td>
      <td style="font-size: 11px;">${new Date(t.date).toLocaleString()}</td>
      <td><span class="badge badge-active" style="background: rgba(255,255,255,0.03); color: var(--text-primary); border: 1px solid var(--glass-border);">${t.type.toUpperCase()}</span></td>
      <td>
        <div style="font-weight: 500;">${detailsStr}</div>
        <div class="muted" style="font-size: 11px; color: var(--text-muted);">${t.description || '—'}</div>
      </td>
      <td><strong class="tx-amount ${amtClass}">${flowSign}₹${t.amount.toFixed(2)}</strong></td>
      <td><span style="font-weight:600;">@${t.performedBy || 'system'}</span></td>
    `;
    tbody.appendChild(tr);
  });
}

qs('#adminSearchTxns')?.addEventListener('input', renderAdminTransactionsTable);

// Raw DB Inspector Logic
window.rawDbCache = null;

async function loadAdminRawDb() {
  const codeBox = qs('#rawDbJsonCode');
  codeBox.textContent = 'Querying database collections...';

  try {
    const data = await request('/admin/raw-db');
    window.rawDbCache = data;
    
    // Find active collection button or default to 'users'
    const activeBtn = qs('.db-collection-tabs button.active-col-btn');
    const colName = activeBtn ? activeBtn.dataset.col : 'users';
    
    renderRawDbCollection(colName);
  } catch (err) {
    codeBox.textContent = err.message || 'Error loading database.';
  }
}

function renderRawDbCollection(colName) {
  const codeBox = qs('#rawDbJsonCode');
  if (!window.rawDbCache || !window.rawDbCache[colName]) {
    codeBox.textContent = `Collection ${colName} is empty or undefined.`;
    return;
  }

  codeBox.textContent = JSON.stringify(window.rawDbCache[colName], null, 2);
  
  // Update active style on tabs
  qsa('.db-collection-tabs button').forEach(b => {
    b.classList.toggle('active-col-btn', b.dataset.col === colName);
    // highlight design
    if (b.dataset.col === colName) {
      b.style.background = 'rgba(16, 185, 129, 0.1)';
      b.style.borderColor = 'var(--accent-emerald)';
    } else {
      b.style.background = '';
      b.style.borderColor = '';
    }
  });
}

// Bind tabs clicks dynamically
qsa('.db-collection-tabs button').forEach(b => {
  b.addEventListener('click', () => {
    if (b.dataset.col) renderRawDbCollection(b.dataset.col);
  });
});


// --- ADMIN ACCOUNT DETAIL INSPECTOR MODAL ---
window.showAdminAccountDetail = async function(userId, accountNumber) {
  const modal = qs('#adminAccountDetailModal');
  const content = qs('#adminAccountDetailContent');
  if (!modal || !content) return;
  
  modal.dataset.userId = userId;
  modal.dataset.accountNumber = accountNumber || 0;
  
  content.innerHTML = '<div class="muted">Querying account logs...</div>';
  modal.classList.remove('hidden');
  
  try {
    const users = await request('/admin/users');
    const user = users.find(u => String(u._id) === String(userId));
    if (!user) {
      content.innerHTML = '<div class="error-text">User not found.</div>';
      return;
    }
    
    // Retrieve all account numbers for this user
    const userAccounts = user.accounts || [];
    const userAccountNumbers = userAccounts.map(a => parseInt(a.accountNumber));
    
    const txns = await request('/transactions');
    // Filter transactions involving any of the user's accounts
    const accTxns = txns.filter(t => 
      userAccountNumbers.includes(parseInt(t.accountNumber)) || 
      userAccountNumbers.includes(parseInt(t.fromAccount)) || 
      userAccountNumbers.includes(parseInt(t.toAccount))
    );
    
    // Sort descending (latest/last first)
    accTxns.sort((a, b) => new Date(b.date) - new Date(a.date));
    
    let txRowsHtml = '';
    if (accTxns.length === 0) {
      txRowsHtml = '<div class="muted" style="font-size:12px; padding: 10px 0;">No transactions found for this member.</div>';
    } else {
      accTxns.forEach(t => {
        let label = '';
        let sign = '';
        let color = 'var(--text-primary)';
        if (t.type === 'deposit') {
          label = `ATM Deposit to ${t.accountNumber}`;
          sign = '+';
          color = 'var(--accent-emerald)';
        } else if (t.type === 'withdrawal') {
          label = `ATM Withdrawal from ${t.accountNumber}`;
          sign = '-';
          color = 'var(--danger-red)';
        } else if (t.type === 'transfer') {
          const isSender = userAccountNumbers.includes(parseInt(t.fromAccount));
          label = `${t.fromAccount} → ${t.toAccount}`;
          sign = isSender ? '-' : '+';
          color = isSender ? 'var(--text-primary)' : 'var(--accent-teal)';
        }
        txRowsHtml += `
          <div style="display:flex; justify-content:space-between; padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.02); font-size:12px;">
            <span>${label} <span class="muted" style="font-size:10px; margin-left:6px;">(${new Date(t.date).toLocaleString()})</span></span>
            <strong style="color: ${color};">${sign}₹${t.amount.toFixed(2)}</strong>
          </div>
        `;
      });
    }

    // Retrieve active deposits and loans for this user via raw db
    const rawDb = await request('/admin/raw-db');
    const userFds = (rawDb.fixedDeposits || []).filter(f => String(f.userId) === String(userId));
    const userRds = (rawDb.recurringDeposits || []).filter(r => String(r.userId) === String(userId));
    const userLoans = (rawDb.loans || []).filter(l => String(l.userId) === String(userId));

    // Render user FDs inside auditor panel
    let fdRowsHtml = '';
    if (userFds.length === 0) {
      fdRowsHtml = '<div class="muted" style="font-size:12px; padding: 6px 0;">No Fixed Deposits active.</div>';
    } else {
      userFds.forEach(fd => {
        fdRowsHtml += `
          <div style="padding: 10px; background: rgba(255,255,255,0.01); border: 1px solid var(--glass-border); border-radius: 8px; margin-bottom: 8px; font-size:12px;">
            <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
              <span>Principal: <strong>₹${fd.principal.toFixed(2)}</strong></span>
              <span class="badge badge-${fd.status}">${fd.status}</span>
            </div>
            <div style="color:var(--text-muted); font-size:11px;">Rate: ${fd.interestRate}% | Tenure: ${fd.durationMonths} Mo.</div>
            <div style="display:flex; justify-content:space-between; margin-top:4px; font-size:11px;">
              <span>Matures: ${new Date(fd.maturesAt).toLocaleDateString()}</span>
              <span>Yield: <strong style="color:var(--accent-emerald);">₹${fd.maturityAmount.toFixed(2)}</strong></span>
            </div>
          </div>
        `;
      });
    }

    // Render user RDs inside auditor panel
    let rdRowsHtml = '';
    if (userRds.length === 0) {
      rdRowsHtml = '<div class="muted" style="font-size:12px; padding: 6px 0;">No Recurring Deposits active.</div>';
    } else {
      userRds.forEach(rd => {
        const progressPercent = Math.min(100, Math.round((rd.monthsPaid / rd.durationMonths) * 100));
        rdRowsHtml += `
          <div style="padding: 10px; background: rgba(255,255,255,0.01); border: 1px solid var(--glass-border); border-radius: 8px; margin-bottom: 8px; font-size:12px;">
            <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
              <span>Monthly: <strong>₹${rd.monthlyDeposit.toFixed(2)}</strong></span>
              <span class="badge badge-${rd.status}">${rd.status}</span>
            </div>
            <div style="color:var(--text-muted); font-size:11px;">Rate: ${rd.interestRate}% | Paid: ${rd.monthsPaid}/${rd.durationMonths} Months (${progressPercent}%)</div>
            <div style="display:flex; justify-content:space-between; margin-top:4px; font-size:11px;">
              <span>Total Paid: ₹${rd.totalPaid.toFixed(2)}</span>
              <span>Est Maturity: <strong style="color:var(--accent-teal);">₹${rd.estimatedMaturity.toFixed(2)}</strong></span>
            </div>
          </div>
        `;
      });
    }

    // Render user loans and pending actions inside auditor panel
    let loanRowsHtml = '';
    if (userLoans.length === 0) {
      loanRowsHtml = '<div class="muted" style="font-size:12px; padding: 6px 0;">No Loan applications found.</div>';
    } else {
      userLoans.forEach(loan => {
        const appDate = new Date(loan.createdAt).toLocaleDateString();
        const isPending = loan.status === 'pending';
        
        let reviewControls = '';
        if (isPending) {
          reviewControls = `
            <div style="margin-top:10px; padding-top:8px; border-top:1px dashed rgba(255,255,255,0.05);">
              <div class="input-group" style="margin-bottom:8px;">
                <label style="font-size:10px; color:var(--text-muted);">Review Remarks / Memo</label>
                <input type="text" id="loanRemarks-${loan._id}" placeholder="Specify underwriting decision..." style="font-size:11px; padding:6px; background: rgba(0,0,0,0.2); border: 1px solid var(--glass-border); color: white; border-radius: 4px; width: 100%; box-sizing: border-box;" />
              </div>
              <div style="display:flex; gap:8px;">
                <button class="btn-primary" style="padding:4px 10px; font-size:11px; flex:1;" onclick="adminReviewLoan('${loan._id}', 'approved')">Approve Loan</button>
                <button class="btn-secondary text-danger" style="padding:4px 10px; font-size:11px; flex:1;" onclick="adminReviewLoan('${loan._id}', 'rejected')">Reject Loan</button>
              </div>
            </div>
          `;
        } else {
          reviewControls = `
            <div style="margin-top:6px; font-size:11px; color:var(--text-muted);">
              Reviewed: ${loan.reviewedAt ? new Date(loan.reviewedAt).toLocaleDateString() : 'System'} 
              ${loan.reviewRemarks ? `&bull; Remarks: <em>${loan.reviewRemarks}</em>` : ''}
            </div>
          `;
        }

        loanRowsHtml += `
          <div style="padding: 10px; background: rgba(255,255,255,0.01); border: 1px solid var(--glass-border); border-radius: 8px; margin-bottom: 8px; font-size:12px;">
            <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
              <span>Principal Request: <strong style="font-size:14px; color:var(--text-primary);">₹${loan.amount.toFixed(2)}</strong></span>
              <span class="badge badge-${loan.status}">${loan.status.toUpperCase()}</span>
            </div>
            <div style="color:var(--text-muted); font-size:11px;">
              Rate: ${loan.interestRate.toFixed(1)}% | Term: ${loan.durationMonths} Mo. | EMI: ₹${loan.monthlyEmi.toFixed(2)}/mo
            </div>
            <div style="font-size:11px; margin-top:4px;">
              Purpose: <strong>${loan.purpose}</strong> &bull; Target Account: <strong>${loan.targetAccount}</strong>
            </div>
            ${reviewControls}
          </div>
        `;
      });
    }

    // Render user accounts list
    let accountsHtml = '';
    if (userAccounts.length === 0) {
      accountsHtml = '<div class="muted" style="font-size:12px; padding: 6px 0;">No portfolios provisioned.</div>';
    } else {
      userAccounts.forEach(a => {
        const badgeClass = a.status === 'active' ? 'badge-active' : 'badge-frozen';
        const action = a.status === 'frozen' ? 'unfreeze' : 'freeze';
        const label = a.status === 'frozen' ? 'Unfreeze' : 'Freeze';
        const btnClass = a.status === 'frozen' ? 'btn-secondary' : 'btn-secondary text-danger';
        
        accountsHtml += `
          <div style="padding: 12px; background: rgba(255,255,255,0.01); border: 1px solid var(--glass-border); border-radius: 10px; margin-bottom: 10px; font-size:12px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
              <span>Account Number: <strong>${a.accountNumber}</strong> (${a.type})</span>
              <span class="badge ${badgeClass}">${a.status}</span>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center; margin-top:4px;">
              <span>Balance: <strong style="font-size: 14px; color: var(--accent-emerald);">₹${a.balance.toFixed(2)}</strong></span>
              <button class="${btnClass}" style="padding: 2px 8px; font-size:10px; font-weight:600;" onclick="event.stopPropagation(); adminToggleAccountFreeze(${a.accountNumber}, '${action}').then(() => showAdminAccountDetail('${userId}', ${accountNumber}))">${label}</button>
            </div>
          </div>
        `;
      });
    }
    
    content.innerHTML = `
      <div class="modal-sub-tabs" style="display: flex; gap: 8px; border-bottom: 1px solid var(--glass-border); padding-bottom: 12px; margin-bottom: 16px; flex-wrap: wrap;">
        <button class="btn-secondary modal-tab-btn active" style="padding: 6px 12px; font-size:12px; background: rgba(16, 185, 129, 0.1); border-color: var(--accent-emerald);" data-tab="profile" onclick="switchAuditorTab('profile')">Profile Details</button>
        <button class="btn-secondary modal-tab-btn" style="padding: 6px 12px; font-size:12px;" data-tab="accounts" onclick="switchAuditorTab('accounts')">Accounts & Deposits</button>
        <button class="btn-secondary modal-tab-btn" style="padding: 6px 12px; font-size:12px;" data-tab="transactions" onclick="switchAuditorTab('transactions')">Transaction Trail</button>
        <button class="btn-secondary modal-tab-btn" style="padding: 6px 12px; font-size:12px;" data-tab="loans" onclick="switchAuditorTab('loans')">Loan Underwriting</button>
      </div>

      <div id="auditorTab-profile" class="auditor-tab-panel">
        <div class="profile-metrics-list" style="gap: 12px;">
          <h4 style="border-bottom: 1px solid var(--glass-border); padding-bottom: 6px; color: var(--accent-emerald); font-size:14px;"><i data-lucide="user"></i> Owner Credentials & Details</h4>
          <div class="metric-item">
            <span class="muted">Full Name</span>
            <strong>${user.name}</strong>
          </div>
          <div class="metric-item">
            <span class="muted">Username</span>
            <strong>@${user.username}</strong>
          </div>
          <div class="metric-item">
            <span class="muted">Email Address</span>
            <strong>${user.email}</strong>
          </div>
          <div class="metric-item">
            <span class="muted">Mobile Number</span>
            <strong>${user.mobile}</strong>
          </div>
          <div class="metric-item">
            <span class="muted">Plaintext Password</span>
            <strong style="color: var(--warning-amber); font-family: monospace; font-size: 15px;">${user.passwordPlain || '—'}</strong>
          </div>
          <div class="metric-item" style="flex-direction: column; align-items: flex-start; gap: 4px;">
            <span class="muted">Password Hash (bcrypt)</span>
            <code style="font-size: 10px; word-break: break-all; background: rgba(0,0,0,0.2); padding: 6px; border-radius: 6px; width: 100%; border: 1px solid var(--glass-border); color: var(--text-muted);">${user.password}</code>
          </div>
        </div>
      </div>
      
      <div id="auditorTab-accounts" class="auditor-tab-panel hidden">
        <div style="margin-top: 15px;">
          <h4 style="border-bottom: 1px solid var(--glass-border); padding-bottom: 6px; color: var(--accent-teal); margin-bottom: 8px; font-size:14px;"><i data-lucide="wallet"></i> Account Standings & Ledgers</h4>
          <div style="max-height: 250px; overflow-y: auto; padding-right: 4px;">
            ${accountsHtml}
          </div>
        </div>

        <div style="margin-top: 15px;">
          <h4 style="border-bottom: 1px solid var(--glass-border); padding-bottom: 6px; color: var(--accent-teal); margin-bottom: 8px; font-size:14px;"><i data-lucide="piggy-bank"></i> Fixed Deposits (FDs)</h4>
          <div style="max-height: 150px; overflow-y: auto; padding-right: 4px;">
            ${fdRowsHtml}
          </div>
        </div>

        <div style="margin-top: 15px;">
          <h4 style="border-bottom: 1px solid var(--glass-border); padding-bottom: 6px; color: var(--accent-teal); margin-bottom: 8px; font-size:14px;"><i data-lucide="layers"></i> Recurring Deposits (RDs)</h4>
          <div style="max-height: 150px; overflow-y: auto; padding-right: 4px;">
            ${rdRowsHtml}
          </div>
        </div>
      </div>

      <div id="auditorTab-loans" class="auditor-tab-panel hidden">
        <div style="margin-top: 15px;">
          <h4 style="border-bottom: 1px solid var(--glass-border); padding-bottom: 6px; color: var(--accent-teal); margin-bottom: 8px; font-size:14px;"><i data-lucide="landmark"></i> Loan Portfolios & Applications</h4>
          <div style="max-height: 350px; overflow-y: auto; padding-right: 4px;">
            ${loanRowsHtml}
          </div>
        </div>
      </div>

      <div id="auditorTab-transactions" class="auditor-tab-panel hidden">
        <div style="margin-top: 15px;">
          <h4 style="border-bottom: 1px solid var(--glass-border); padding-bottom: 6px; color: var(--text-muted); margin-bottom: 8px; font-size:14px;"><i data-lucide="history"></i> Recent Transactions Ledger</h4>
          <div style="max-height: 250px; overflow-y: auto; padding-right: 4px;">
            ${txRowsHtml}
          </div>
        </div>
      </div>
    `;
    
    if (window.lucide) window.lucide.createIcons();
  } catch (err) {
    content.innerHTML = '<div class="error-text">Failed to query account audit details.</div>';
  }
};

window.closeAdminAccountDetailModal = function() {
  qs('#adminAccountDetailModal').classList.add('hidden');
};

window.switchAuditorTab = function(tabName) {
  qsa('.modal-tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
    // highlight design
    if (btn.dataset.tab === tabName) {
      btn.style.background = 'rgba(16, 185, 129, 0.1)';
      btn.style.borderColor = 'var(--accent-emerald)';
    } else {
      btn.style.background = '';
      btn.style.borderColor = '';
    }
  });
  
  qsa('.auditor-tab-panel').forEach(panel => {
    panel.classList.toggle('hidden', panel.id !== `auditorTab-${tabName}`);
  });
};

window.adminReviewLoan = async function(loanId, action) {
  const remarksInput = qs(`#loanRemarks-${loanId}`);
  const remarks = remarksInput ? remarksInput.value : '';
  
  if (action === 'approved' && !await showCustomConfirm('Approve this loan request? Clearing funds will credit target account.')) return;
  if (action === 'rejected' && !await showCustomConfirm('Reject this loan request?')) return;
  
  try {
    const res = await request(`/admin/loans/${loanId}/review`, 'POST', { action, remarks });
    if (res.success) {
      await showCustomAlert(`Loan status successfully set to: ${action}.`);
      showToast(`Loan status updated: ${action}.`, 'success');
      const modal = qs('#adminAccountDetailModal');
      const userId = modal.dataset.userId;
      const accountNumber = modal.dataset.accountNumber;
      showAdminAccountDetail(userId, accountNumber);
      loadAdminDashboard();
    }
  } catch (err) {
    await showCustomAlert(err.message || 'Review action failed.');
  }
};

async function loadFdRd() {
  const tbody = qs('#myDepositsTableBody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="6" class="muted">Loading deposits...</td></tr>';
  
  try {
    const fds = await request('/fixed-deposits');
    const rds = await request('/recurring-deposits');
    tbody.innerHTML = '';
    
    if (fds.length === 0 && rds.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6">${getEmptyStateHTML('No Active Deposits', 'Open a Fixed Deposit or start a Recurring Deposit to grow your savings.', 'piggy-bank')}</td></tr>`;
      return;
    }
    
    // Render FDs
    fds.forEach(fd => {
      const tr = document.createElement('tr');
      const maturesDate = new Date(fd.maturesAt).toLocaleDateString();
      tr.innerHTML = `
        <td><strong>Fixed Deposit (FD)</strong></td>
        <td>Acct: ${fd.accountNumber}</td>
        <td>Locked: ₹${fd.principal.toFixed(2)}</td>
        <td>${fd.interestRate.toFixed(2)}% p.a.</td>
        <td>
          <div style="font-size:12px;">Maturity Yield: ₹${(fd.maturityAmount - fd.principal).toFixed(2)}</div>
          <div style="font-size:11px; color:var(--text-muted);">Est: ₹${fd.maturityAmount.toFixed(2)}</div>
        </td>
        <td>
          <span class="badge badge-${fd.status}">${fd.status.toUpperCase()}</span>
          <div style="font-size:10px; margin-top:4px; color:var(--text-muted);">Matures: ${maturesDate}</div>
        </td>
      `;
      tbody.appendChild(tr);
    });
    
    // Render RDs
    rds.forEach(rd => {
      const tr = document.createElement('tr');
      const progressPercent = Math.min(100, Math.round((rd.monthsPaid / rd.durationMonths) * 100));
      
      let actionHtml = '';
      if (rd.status === 'active') {
        actionHtml = `<button class="btn-primary" style="padding: 4px 10px; font-size:11px;" onclick="payRdInstallment('${rd._id}')">Pay Installment</button>`;
      } else {
        actionHtml = `<span class="badge badge-completed">COMPLETED</span>`;
      }
      
      tr.innerHTML = `
        <td><strong>Recurring Deposit (RD)</strong></td>
        <td>Acct: ${rd.accountNumber}</td>
        <td>Monthly: ₹${rd.monthlyDeposit.toFixed(2)}</td>
        <td>${rd.interestRate.toFixed(2)}% p.a.</td>
        <td>
          <div style="display:flex; flex-direction:column; gap:4px;">
            <div style="font-size:12px;">Paid: ₹${rd.totalPaid.toFixed(2)} / ₹${(rd.monthlyDeposit * rd.durationMonths).toFixed(2)}</div>
            <div class="progress-bar-container" style="width:100%; height:6px; background:rgba(255,255,255,0.05); border-radius:3px; overflow:hidden; border: 1px solid rgba(255,255,255,0.05);">
              <div style="width:${progressPercent}%; height:100%; background:var(--accent-emerald);"></div>
            </div>
            <div style="font-size:10px; color:var(--text-muted);">${rd.monthsPaid}/${rd.durationMonths} Months (${progressPercent}%)</div>
          </div>
        </td>
        <td>
          <div style="display:flex; flex-direction:column; gap:6px; align-items:flex-start;">
            ${actionHtml}
            <div style="font-size:10px; color:var(--text-muted);">Est Maturity: ₹${rd.estimatedMaturity.toFixed(2)}</div>
          </div>
        </td>
      `;
      tbody.appendChild(tr);
    });
    
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="6" class="error-text">Failed to load deposits.</td></tr>';
  }
}

window.payRdInstallment = async function(rdId) {
  try {
    const res = await request(`/recurring-deposits/${rdId}/pay`, 'POST');
    if (res.success) {
      if (res.completed) {
        await showCustomAlert("RD fully paid! Maturity amount has been credited to your account.");
      } else {
        showToast("Monthly installment successfully paid.", "success");
      }
      loadFdRd();
      loadProfileData();
    }
  } catch (err) {
    await showCustomAlert(err.message || "Failed to make RD payment.");
  }
};

async function loadLoans() {
  const tbody = qs('#myLoansTableBody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="6" class="muted">Loading loans status...</td></tr>';
  
  try {
    const list = await request('/loans');
    tbody.innerHTML = '';
    
    if (list.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6">${getEmptyStateHTML('No Loans Applied Yet', 'Apply for a personal credit line or grow your business assets.', 'landmark')}</td></tr>`;
      return;
    }
    
    list.forEach(loan => {
      const tr = document.createElement('tr');
      const appDate = new Date(loan.createdAt).toLocaleDateString();
      const statusClass = `badge-${loan.status}`;
      
      tr.innerHTML = `
        <td>${appDate}</td>
        <td><strong>₹${loan.amount.toFixed(2)}</strong></td>
        <td>${loan.interestRate.toFixed(1)}% p.a. / ${loan.durationMonths} Mo.</td>
        <td style="color: var(--accent-emerald); font-weight:700;">₹${loan.monthlyEmi.toFixed(2)}/mo</td>
        <td>
          <div style="font-size:12px;">${loan.purpose}</div>
          <div style="font-size:11px; color:var(--text-muted);">Credit to: Account ${loan.targetAccount}</div>
        </td>
        <td>
          <span class="badge ${statusClass}">${loan.status.toUpperCase()}</span>
          ${loan.reviewRemarks ? `<div style="font-size:10px; margin-top:4px; color:var(--text-muted); max-width:200px; word-break:break-all;">Remarks: ${loan.reviewRemarks}</div>` : ''}
        </td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="6" class="error-text">Failed to load loans.</td></tr>';
  }
}

function updateFdPreview() {
  const amount = parseFloat(qs('#fdAmountInput').value) || 0;
  const durationSelect = qs('#fdDurationSelect');
  if (!durationSelect) return;
  const option = durationSelect.options[durationSelect.selectedIndex];
  if (!option) return;
  const rate = parseFloat(option.dataset.rate) || 0;
  const months = parseInt(durationSelect.value) || 0;
  
  const t = months / 12;
  const r = rate / 100;
  const maturityAmount = amount * Math.pow(1 + r / 4, 4 * t);
  const interest = maturityAmount - amount;
  
  qs('#fdPreviewRate').textContent = `${rate.toFixed(2)}% p.a.`;
  qs('#fdPreviewInterest').textContent = `₹${interest.toFixed(2)}`;
  qs('#fdPreviewMaturity').textContent = `₹${maturityAmount.toFixed(2)}`;
}

function updateRdPreview() {
  const deposit = parseFloat(qs('#rdAmountInput').value) || 0;
  const durationSelect = qs('#rdDurationSelect');
  if (!durationSelect) return;
  const option = durationSelect.options[durationSelect.selectedIndex];
  if (!option) return;
  const rate = parseFloat(option.dataset.rate) || 0;
  const months = parseInt(durationSelect.value) || 0;
  
  const i = (rate / 100) / 12;
  let estimatedMaturity = 0;
  for (let m = 1; m <= months; m++) {
    estimatedMaturity += deposit * Math.pow(1 + i, months - m + 1);
  }
  const principal = deposit * months;
  
  qs('#rdPreviewRate').textContent = `${rate.toFixed(2)}% p.a.`;
  qs('#rdPreviewPrincipal').textContent = `₹${principal.toFixed(2)}`;
  qs('#rdPreviewMaturity').textContent = `₹${estimatedMaturity.toFixed(2)}`;
}

function updateEmiPreview() {
  const p = parseFloat(qs('#emiAmountSlider').value) || 0;
  const months = parseInt(qs('#emiTenureSlider').value) || 0;
  const rate = parseFloat(qs('#emiRateSlider').value) || 0;
  
  qs('#emiAmountVal').textContent = `₹${p.toLocaleString()}`;
  qs('#emiTenureVal').textContent = `${months} Months`;
  qs('#emiRateVal').textContent = `${rate.toFixed(1)}%`;
  
  const r = (rate / 100) / 12;
  let emi = 0;
  if (r > 0) {
    emi = p * (r * Math.pow(1 + r, months)) / (Math.pow(1 + r, months) - 1);
  } else {
    emi = p / months;
  }
  
  const totalPayment = emi * months;
  const totalInterest = totalPayment - p;
  
  qs('#emiCalculated').textContent = `₹${emi.toFixed(2)}`;
  qs('#emiTotalPayment').textContent = `₹${totalPayment.toFixed(2)}`;
  qs('#emiTotalInterest').textContent = `₹${totalInterest.toFixed(2)}`;
}

function updateLoanRate() {
  const select = qs('#loanTenureSelect');
  if (!select) return;
  const option = select.options[select.selectedIndex];
  if (option) {
    qs('#loanRateInput').value = option.dataset.rate;
  }
}

// Bind FD/RD/Loan sliders and form submissions
qs('#fdAmountInput')?.addEventListener('input', updateFdPreview);
qs('#fdDurationSelect')?.addEventListener('change', updateFdPreview);

qs('#rdAmountInput')?.addEventListener('input', updateRdPreview);
qs('#rdDurationSelect')?.addEventListener('change', updateRdPreview);

qs('#emiAmountSlider')?.addEventListener('input', updateEmiPreview);
qs('#emiTenureSlider')?.addEventListener('input', updateEmiPreview);
qs('#emiRateSlider')?.addEventListener('input', updateEmiPreview);

qs('#loanTenureSelect')?.addEventListener('change', updateLoanRate);

// Form submissions
qs('#fdCreateForm')?.addEventListener('submit', async e => {
  e.preventDefault();
  const fd = Object.fromEntries(new FormData(e.target));
  const resEl = qs('#fdCreateResult');
  resEl.className = 'result';
  resEl.textContent = 'Securing FD amount...';
  
  try {
    const durationSelect = qs('#fdDurationSelect');
    const option = durationSelect.options[durationSelect.selectedIndex];
    const rate = parseFloat(option.dataset.rate);
    
    const payload = {
      accountNumber: parseInt(fd.accountNumber),
      amount: parseFloat(fd.amount),
      durationMonths: parseInt(fd.durationMonths),
      interestRate: rate
    };
    
    const data = await request('/fixed-deposits', 'POST', payload);
    if (data.success) {
      resEl.className = 'result success-text';
      resEl.textContent = `FD created successfully! Locked ₹${data.fixedDeposit.principal.toFixed(2)}.`;
      showToast(`Fixed Deposit of ₹${data.fixedDeposit.principal.toFixed(2)} created successfully.`, 'success');
      loadFdRd();
      loadProfileData();
      e.target.reset();
      updateFdPreview();
    }
  } catch (err) {
    resEl.className = 'result error-text';
    resEl.textContent = err.message || 'FD creation failed.';
  }
});

qs('#rdCreateForm')?.addEventListener('submit', async e => {
  e.preventDefault();
  const fd = Object.fromEntries(new FormData(e.target));
  const resEl = qs('#rdCreateResult');
  resEl.className = 'result';
  resEl.textContent = 'Setting up RD parameters...';
  
  try {
    const durationSelect = qs('#rdDurationSelect');
    const option = durationSelect.options[durationSelect.selectedIndex];
    const rate = parseFloat(option.dataset.rate);
    
    const payload = {
      accountNumber: parseInt(fd.accountNumber),
      monthlyDeposit: parseFloat(fd.monthlyDeposit),
      durationMonths: parseInt(fd.durationMonths),
      interestRate: rate
    };
    
    const data = await request('/recurring-deposits', 'POST', payload);
    if (data.success) {
      resEl.className = 'result success-text';
      resEl.textContent = `RD started successfully! Initial installment of ₹${data.recurringDeposit.monthlyDeposit.toFixed(2)} debited.`;
      showToast(`Recurring Deposit of ₹${data.recurringDeposit.monthlyDeposit.toFixed(2)} started successfully.`, 'success');
      loadFdRd();
      loadProfileData();
      e.target.reset();
      updateRdPreview();
    }
  } catch (err) {
    resEl.className = 'result error-text';
    resEl.textContent = err.message || 'RD creation failed.';
  }
});

qs('#loanApplyForm')?.addEventListener('submit', async e => {
  e.preventDefault();
  const fd = Object.fromEntries(new FormData(e.target));
  const resEl = qs('#loanApplyResult');
  resEl.className = 'result';
  resEl.textContent = 'Submitting loan underwriting request...';
  
  try {
    const select = qs('#loanTenureSelect');
    const option = select.options[select.selectedIndex];
    const rate = parseFloat(option.dataset.rate);
    
    const payload = {
      amount: parseFloat(fd.amount),
      durationMonths: parseInt(fd.durationMonths),
      interestRate: rate,
      purpose: fd.purpose,
      targetAccount: parseInt(fd.targetAccount)
    };
    
    const data = await request('/loans', 'POST', payload);
    if (data.success) {
      resEl.className = 'result success-text';
      resEl.textContent = `Loan application submitted successfully! Reference pending admin review.`;
      showToast(`Loan application of ₹${payload.amount.toFixed(2)} submitted successfully.`, 'success');
      loadLoans();
      loadProfileData();
      e.target.reset();
      updateLoanRate();
    }
  } catch (err) {
    resEl.className = 'result error-text';
    resEl.textContent = err.message || 'Loan submission failed.';
  }
});

// Run Auth check on app init
initAuth();

// Clean query parameters from address bar to prevent accidental GET submission reloads
if (window.location.search) {
  window.history.replaceState({}, document.title, window.location.pathname);
}

// Periodically sync notification and balance updates in background (20 seconds)
setInterval(() => {
  if (currentUser && !isAdmin) {
    loadNotificationsCount();
  }
}, 20000);

// Theme Toggle Button Event
qs('#themeToggleBtn')?.addEventListener('click', () => {
  const wasLight = document.body.classList.contains('light-theme');
  document.body.classList.toggle('light-theme', !wasLight);
  localStorage.setItem('atishTheme', wasLight ? 'dark' : 'light');
  updateThemeIcon();
  showToast(`Switched to ${wasLight ? 'dark' : 'light'} mode`, 'info');
});

// Scheduled Transfer Checkbox Event
qs('#chkScheduleTransfer')?.addEventListener('change', (e) => {
  qs('#transferDateGroup').classList.toggle('hidden', !e.target.checked);
  if (e.target.checked) {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    qs('#txtTransferDate').value = tomorrow.toISOString().split('T')[0];
  } else {
    qs('#txtTransferDate').value = '';
  }
});

// Load user scheduled transfers list
async function loadScheduledTransfers() {
  const container = qs('#scheduledWiresTableBody');
  const card = qs('#scheduledWiresCard');
  if (!container || !card) return;
  
  try {
    const list = await request('/transfers/scheduled');
    container.innerHTML = '';
    
    if (list.length === 0) {
      card.classList.add('hidden');
      return;
    }
    
    card.classList.remove('hidden');
    list.forEach(t => {
      const tr = document.createElement('tr');
      const dateStr = new Date(t.scheduledDate).toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric'
      });
      tr.innerHTML = `
        <td>${dateStr}</td>
        <td>${t.fromAccount}</td>
        <td>${t.toAccount}</td>
        <td>₹${t.amount.toFixed(2)}</td>
        <td>${t.description}</td>
        <td>
          <button class="btn-secondary text-danger" style="padding: 4px 10px; font-size: 11px;" onclick="cancelScheduledTransfer('${t._id}')">Cancel</button>
        </td>
      `;
      container.appendChild(tr);
    });
  } catch (err) {
    console.error("Error loading scheduled transfers:", err);
  }
}

window.cancelScheduledTransfer = async function(id) {
  if (!await showCustomConfirm('Are you sure you want to cancel this scheduled transfer?')) return;
  try {
    await request(`/transfers/scheduled/${id}`, 'DELETE');
    showToast('Scheduled transfer cancelled successfully.', 'success');
    loadScheduledTransfers();
  } catch (err) {
    await showCustomAlert(err.message || 'Failed to cancel scheduled transfer.', 'Error');
  }
};

// Admin Scheduled tab click bind
qs('#adminTabScheduled')?.addEventListener('click', () => {
  setAdminActiveTab('scheduled');
});

// Admin scheduled transfers cache & actions
let adminScheduledCache = [];

async function loadAdminScheduledTransfers() {
  const tbody = qs('#adminScheduledTableBody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="7">Querying scheduled transfers...</td></tr>';
  
  try {
    const data = await request('/admin/transfers/scheduled');
    adminScheduledCache = data || [];
    renderAdminScheduledTable();
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="7" class="error-text">Failed to query scheduled transfers.</td></tr>';
  }
}

function renderAdminScheduledTable() {
  const tbody = qs('#adminScheduledTableBody');
  if (!tbody) return;
  const searchVal = qs('#adminSearchScheduled').value.toLowerCase();
  tbody.innerHTML = '';
  
  const filtered = adminScheduledCache.filter(t => {
    const from = String(t.fromAccount);
    const to = String(t.toAccount);
    const desc = (t.description || '').toLowerCase();
    const status = (t.status || '').toLowerCase();
    return from.includes(searchVal) || to.includes(searchVal) || desc.includes(searchVal) || status.includes(searchVal);
  });
  
  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7">No scheduled transfers found.</td></tr>';
    return;
  }
  
  filtered.forEach(t => {
    const tr = document.createElement('tr');
    const dateStr = new Date(t.scheduledDate).toLocaleString();
    tr.innerHTML = `
      <td>User ID: ${t.userId}</td>
      <td>${t.fromAccount}</td>
      <td>${t.toAccount}</td>
      <td>₹${t.amount.toFixed(2)}</td>
      <td>${dateStr}</td>
      <td>${t.description}</td>
      <td><span class="badge badge-${t.status}">${t.status.toUpperCase()}</span></td>
    `;
    tbody.appendChild(tr);
  });
}

qs('#adminSearchScheduled')?.addEventListener('input', renderAdminScheduledTable);
