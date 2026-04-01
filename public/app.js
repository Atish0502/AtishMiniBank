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
  const res = await fetch(url, {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});
  const txt = await res.text();
  try { return JSON.parse(txt); } catch(e){ return txt; }
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

// Deposit
qs('#depositForm').addEventListener('submit', async e=>{
  e.preventDefault();
  const fd = Object.fromEntries(new FormData(e.target));
  const body = { accountNumber: parseInt(fd.accountNumber), amount: Number(fd.amount) };
  const r = await postJSON('/deposit', body);
  qs('#depositResult').textContent = r;
  e.target.reset();
});

// Withdraw
qs('#withdrawForm').addEventListener('submit', async e=>{
  e.preventDefault();
  const fd = Object.fromEntries(new FormData(e.target));
  const body = { accountNumber: parseInt(fd.accountNumber), amount: Number(fd.amount) };
  const r = await postJSON('/withdraw', body);
  qs('#withdrawResult').textContent = r;
  e.target.reset();
});

// Transfer
qs('#transferForm').addEventListener('submit', async e=>{
  e.preventDefault();
  const fd = Object.fromEntries(new FormData(e.target));
  const body = { from: parseInt(fd.from), to: parseInt(fd.to), amount: Number(fd.amount) };
  const r = await postJSON('/transfer', body);
  qs('#transferResult').textContent = r;
  e.target.reset();
  loadTransactions();
});

// Balance
qs('#balanceForm').addEventListener('submit', async e=>{
  e.preventDefault();
  const fd = Object.fromEntries(new FormData(e.target));
  const acc = fd.accountNumber;
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
  const res = await fetch('/balance/'+fd.accountNumber);
  const data = await res.json().catch(()=>null);
  const out = qs('#accountsResult');
  if(!data || data==='Account not found') out.textContent = 'Account not found';
  else out.innerHTML = `<div class="card"><strong>${data.name}</strong><div>Acct: ${data.accountNumber}</div><div>Balance: $${data.balance}</div></div>`;
});

// Transactions
async function loadTransactions(){
  const res = await fetch('/transactions');
  const data = await res.json().catch(()=>[]);
  const list = qs('#txList');
  if(!data || data.length===0){ list.textContent = 'No transactions yet'; return; }
  list.innerHTML = '';
  data.reverse().forEach(tx=>{
    const el = document.createElement('div');
    el.className = 'tx';
    el.innerHTML = `<div>${new Date(tx.date).toLocaleString()}<div class="muted">${tx.from} → ${tx.to}</div></div><div><strong>$${tx.amount}</strong></div>`;
    list.appendChild(el);
  });
}

// Init
showPanel('dashboard');
loadTransactions();

// Auto-refresh transactions every 20s
setInterval(loadTransactions, 20000);
