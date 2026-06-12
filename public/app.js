// Frontend interactions for MiniBank
const qs = s => document.querySelector(s);
const qsa = s => document.querySelectorAll(s);

function showPanel(id){
  qsa('.panel').forEach(p=>p.classList.add('hidden'));
  qs('#'+id).classList.remove('hidden');
  qsa('.nav-btn').forEach(b=>b.classList.toggle('active', b.dataset.target===id));
}

// Navigation
qsa('.nav-btn').forEach(b=>b.addEventListener('click', e=>showPanel(b.dataset.target)));

// Helper: post JSON
async function postJSON(url, data){
  const headers = {'content-type':'application/json'};
  const token = localStorage.getItem('bankToken');
  if(token) headers['authorization'] = 'Bearer '+token;
  const res = await fetch(url, {method:'POST',headers,body:JSON.stringify(data)});
  const txt = await res.text();
  try { return JSON.parse(txt); } catch(e){ return txt; }
}

function setAuthState(user, isAdmin, token){
  if(isAdmin){
    localStorage.setItem('bankAdmin','true');
    localStorage.removeItem('bankUser');
    if(token) localStorage.setItem('bankToken', token);
  } else if(user){
    localStorage.setItem('bankUser', JSON.stringify(user));
    localStorage.removeItem('bankAdmin');
    if(token) localStorage.setItem('bankToken', token);
  } else {
    localStorage.removeItem('bankUser');
    localStorage.removeItem('bankAdmin');
    localStorage.removeItem('bankToken');
  }
  // show nav when logged in (either admin or user)
  const loggedIn = !!localStorage.getItem('bankUser') || !!localStorage.getItem('bankAdmin');
  document.querySelector('.nav').style.display = loggedIn ? 'flex' : 'none';
  // user label and logout
  const label = qs('#userLabel');
  const logout = qs('#logoutBtn');
  if(localStorage.getItem('bankUser')){
    const u = JSON.parse(localStorage.getItem('bankUser'));
    label.textContent = u.username || u.name;
    logout.classList.remove('hidden');
  } else if(localStorage.getItem('bankAdmin')){
    label.textContent = 'Admin';
    logout.classList.remove('hidden');
  } else {
    label.textContent = '';
    logout.classList.add('hidden');
  }
  // adjust account inputs for normal users
  const storedUser = JSON.parse(localStorage.getItem('bankUser')||'null');
  qsa('input[name="accountNumber"]').forEach(i=>{
    if(storedUser){ i.value = storedUser.accountNumber; i.readOnly = true; } else { i.value=''; i.readOnly = false; }
  });
  qsa('input[name="from"]').forEach(i=>{
    if(storedUser){ i.value = storedUser.accountNumber; i.readOnly = true; } else { i.value=''; i.readOnly = false; }
  });
}

// Create
qs('#createForm').addEventListener('submit', async e=>{
  e.preventDefault();
  const fd = Object.fromEntries(new FormData(e.target));
  const body = { name: fd.name, accountNumber: parseInt(fd.accountNumber) };
  const r = await postJSON('/create-account', body);
  qs('#createResult').textContent = r;
  e.target.reset();
});

// Signup
qs('#signupForm')?.addEventListener('submit', async e=>{
  e.preventDefault();
  const fd = Object.fromEntries(new FormData(e.target));
  const body = { name: fd.name, username: fd.username, password: fd.password, accountNumber: parseInt(fd.accountNumber) };
  const r = await postJSON('/signup', body);
  if(r && r.success){
    qs('#signupResult').textContent = 'Signup successful';
    setAuthState(r.user, false, r.token);
    showPanel('dashboard');
    loadTransactions();
  } else {
    qs('#signupResult').textContent = typeof r === 'string' ? r : JSON.stringify(r);
  }
});

// Login
qs('#loginForm')?.addEventListener('submit', async e=>{
  e.preventDefault();
  const fd = Object.fromEntries(new FormData(e.target));
  const body = { username: fd.username, password: fd.password };
  const res = await postJSON('/login', body);
  if(!res || res === 'Invalid credentials'){
    qs('#loginResult').textContent = 'Invalid credentials';
    return;
  }
  qs('#loginResult').textContent = 'Logged in';
  setAuthState(res.user, false, res.token);
  showPanel('dashboard');
  loadTransactions();
});

// Admin login
qs('#adminForm')?.addEventListener('submit', async e=>{
  e.preventDefault();
  const fd = Object.fromEntries(new FormData(e.target));
  const r = await postJSON('/admin-login', { password: fd.password });
  if(r && r.admin){
    qs('#adminResult').textContent = 'Admin logged in';
    setAuthState(null, true, r.token);
    showPanel('transactions');
    loadTransactions();
  } else {
    qs('#adminResult').textContent = typeof r === 'string' ? r : 'Invalid';
  }
});

// Deposit
qs('#depositForm').addEventListener('submit', async e=>{
  e.preventDefault();
  const fd = Object.fromEntries(new FormData(e.target));
  const body = { accountNumber: parseInt(fd.accountNumber), amount: Number(fd.amount) };
  const r = await postJSON('/deposit', body);
  qs('#depositResult').textContent = typeof r === 'string' ? r : JSON.stringify(r);
  // clear only amount so account stays filled for repeated deposits
  const amt = e.target.querySelector('input[name="amount"]'); if(amt) amt.value = '';
});

// Withdraw
qs('#withdrawForm').addEventListener('submit', async e=>{
  e.preventDefault();
  const fd = Object.fromEntries(new FormData(e.target));
  const body = { accountNumber: parseInt(fd.accountNumber), amount: Number(fd.amount) };
  const r = await postJSON('/withdraw', body);
  qs('#withdrawResult').textContent = typeof r === 'string' ? r : JSON.stringify(r);
  const amt = e.target.querySelector('input[name="amount"]'); if(amt) amt.value = '';
  loadTransactions();
});

// Transfer
qs('#transferForm').addEventListener('submit', async e=>{
  e.preventDefault();
  const fd = Object.fromEntries(new FormData(e.target));
  const body = { from: parseInt(fd.from), to: parseInt(fd.to), amount: Number(fd.amount) };
  const r = await postJSON('/transfer', body);
  qs('#transferResult').textContent = typeof r === 'string' ? r : JSON.stringify(r);
  // clear only 'to' and 'amount' so logged-in user's 'from' remains
  const to = e.target.querySelector('input[name="to"]'); if(to) to.value = '';
  const amt = e.target.querySelector('input[name="amount"]'); if(amt) amt.value = '';
  loadTransactions();
});

// Balance
qs('#balanceForm').addEventListener('submit', async e=>{
  e.preventDefault();
  const fd = Object.fromEntries(new FormData(e.target));
  // If a regular user is logged in, force their account only
  const isAdmin = !!localStorage.getItem('bankAdmin');
  const storedUser = JSON.parse(localStorage.getItem('bankUser')||'null');
  const acc = (!isAdmin && storedUser) ? storedUser.accountNumber : fd.accountNumber;
  const res = await fetch('/balance/'+acc);
  const data = await res.json().catch(()=>null);
  if(!data || data === "Account not found"){
    qs('#balanceResult').textContent = 'Account not found';
  } else {
    qs('#balanceResult').innerHTML = `<strong>${data.name}</strong> — ${data.accountNumber} — Balance: $${data.balance}`;
  }
});

// Accounts lookup (same as balance)
qs('#accountsLookup').addEventListener('submit', async e=>{
  e.preventDefault();
  const fd = Object.fromEntries(new FormData(e.target));
  // If a regular user is logged in, force their account only
  const isAdmin = !!localStorage.getItem('bankAdmin');
  const storedUser = JSON.parse(localStorage.getItem('bankUser')||'null');
  const acc = (!isAdmin && storedUser) ? storedUser.accountNumber : fd.accountNumber;
  const res = await fetch('/balance/'+acc);
  const data = await res.json().catch(()=>null);
  const out = qs('#accountsResult');
  if(!data || data==='Account not found') out.textContent = 'Account not found';
  else out.innerHTML = `<div class="card"><strong>${data.name}</strong><div>Acct: ${data.accountNumber}</div><div>Balance: $${data.balance}</div></div>`;
});

// Transactions
async function loadTransactions(){
  const isAdmin = !!localStorage.getItem('bankAdmin');
  let data = [];
  const token = localStorage.getItem('bankToken');
  if(isAdmin){
    const res = await fetch('/transactions', { headers: token?{ authorization: 'Bearer '+token }:{} });
    data = await res.json().catch(()=>[]);
  } else {
    const user = JSON.parse(localStorage.getItem('bankUser')||'null');
    if(!user){
      qs('#txList').textContent = 'Login to view transactions';
      return;
    }
    const res = await fetch('/my-transactions/'+user.accountNumber, { headers: token?{ authorization: 'Bearer '+token }:{} });
    data = await res.json().catch(()=>[]);
  }
  const list = qs('#txList');
  if(!data || data.length===0){ list.textContent = 'No transactions yet'; return; }
  list.innerHTML = '';
  data.reverse().forEach(tx=>{
    const el = document.createElement('div');
    el.className = 'tx';
    let body = '';
    if(tx.type === 'deposit') body = `<div class="muted">Deposit to ${tx.account}</div>`;
    else if(tx.type === 'withdraw') body = `<div class="muted">Withdraw from ${tx.account}</div>`;
    else body = `<div class="muted">${tx.from} → ${tx.to}</div>`;
    el.innerHTML = `<div>${new Date(tx.date).toLocaleString()}${body}</div><div><strong>$${tx.amount}</strong></div>`;
    list.appendChild(el);
  });
}

// Init: show auth panel first
// logout
qs('#logoutBtn')?.addEventListener('click', ()=>{ setAuthState(null,false); showPanel('auth'); loadTransactions(); });

setAuthState(JSON.parse(localStorage.getItem('bankUser')||'null'), !!localStorage.getItem('bankAdmin'), localStorage.getItem('bankToken'));
showPanel(localStorage.getItem('bankUser')||localStorage.getItem('bankAdmin') ? 'dashboard' : 'auth');
loadTransactions();

// Auto-refresh transactions every 20s
setInterval(loadTransactions, 20000);
