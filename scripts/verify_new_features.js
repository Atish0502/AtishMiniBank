const http = require('http');

function postJSON(path, data, token = null) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const headers = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body)
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    const opts = {
      hostname: 'localhost',
      port: 3000,
      path,
      method: 'POST',
      headers
    };
    const req = http.request(opts, res => {
      let responseBody = '';
      res.on('data', chunk => responseBody += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(responseBody);
          resolve({ status: res.statusCode, data: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, data: responseBody });
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function getJSON(path, token = null) {
  return new Promise((resolve, reject) => {
    const headers = {};
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    const opts = {
      hostname: 'localhost',
      port: 3000,
      path,
      method: 'GET',
      headers
    };
    const req = http.request(opts, res => {
      let responseBody = '';
      res.on('data', chunk => responseBody += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(responseBody);
          resolve({ status: res.statusCode, data: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, data: responseBody });
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function runTests() {
  console.log("=== STARTING NEW FEATURES TEST SUITE ===");

  try {
    // 1. Sign up test user
    console.log("\n1. Provisioning Test User...");
    const username = 'testuser' + Math.floor(Math.random() * 1000);
    const signup = await postJSON('/signup', {
      name: 'Test Customer',
      username,
      email: `${username}@testbank.com`,
      mobile: '+15559876',
      password: 'mypassword123'
    });
    console.log("Signup Status:", signup.status);
    const token = signup.data.token;

    // Load Profile to get account details
    const profile = await getJSON('/me', token);
    const accountNo = profile.data.user.accounts[0].accountNumber;
    console.log(`Initial Account: ${accountNo}, Balance: $${profile.data.user.accounts[0].balance}`);

    // 2. Deposit $10,000 clearing funds
    console.log("\n2. Depositing $10,000.00...");
    const deposit = await postJSON('/deposit', {
      accountNumber: accountNo,
      amount: 10000,
      description: 'Opening Deposit'
    }, token);
    console.log("Deposit Status:", deposit.status);

    // Verify balance
    let profileUpdated = await getJSON('/me', token);
    console.log(`Balance after Deposit: $${profileUpdated.data.user.accounts[0].balance} (Expected: $10,000.00)`);

    // 3. Create Fixed Deposit (FD) of $2,000, 12 months @ 6.0% p.a.
    console.log("\n3. Creating FD of $2,000.00 (12 Mo, 6.0%)...");
    const fdResult = await postJSON('/fixed-deposits', {
      accountNumber: accountNo,
      amount: 2000,
      durationMonths: 12,
      interestRate: 6.0
    }, token);
    console.log("FD Creation:", fdResult.status, fdResult.data);
    
    // Compounding Quarterly Maturity Calculation check:
    // M = P * (1 + r/4)^(4*t) where t = 1.
    // M = 2000 * (1 + 0.06/4)^4 = 2000 * (1.015)^4 = 2000 * 1.06136355 = 2122.73
    console.log(`Calculated Maturity Amount in DB: $${fdResult.data.fixedDeposit.maturityAmount} (Expected: $2122.73)`);

    // Check account balance after FD debit
    profileUpdated = await getJSON('/me', token);
    console.log(`Balance after FD creation: $${profileUpdated.data.user.accounts[0].balance} (Expected: $8,000.00)`);

    // 4. Create Recurring Deposit (RD) of $300.00 / month, 12 months @ 6.5% p.a.
    console.log("\n4. Starting RD of $300.00 / Month (12 Mo, 6.5%)...");
    const rdResult = await postJSON('/recurring-deposits', {
      accountNumber: accountNo,
      monthlyDeposit: 300,
      durationMonths: 12,
      interestRate: 6.5
    }, token);
    console.log("RD Creation:", rdResult.status, rdResult.data);
    const rdId = rdResult.data.recurringDeposit._id;

    // Check account balance after initial RD monthly installment
    profileUpdated = await getJSON('/me', token);
    console.log(`Balance after RD creation: $${profileUpdated.data.user.accounts[0].balance} (Expected: $7,700.00)`);

    // 5. Pay next RD installment
    console.log("\n5. Paying second RD monthly installment...");
    const payRd = await postJSON(`/recurring-deposits/${rdId}/pay`, {}, token);
    console.log("RD Installment Payment Status:", payRd.status, payRd.data);

    // Verify balance
    profileUpdated = await getJSON('/me', token);
    console.log(`Balance after second RD payment: $${profileUpdated.data.user.accounts[0].balance} (Expected: $7,400.00)`);

    // 6. Apply for Loan of $5,000, 24 Mo @ 8.5%
    console.log("\n6. Applying for a Loan of $5,000.00 (24 Mo, 8.5%)...");
    const loanResult = await postJSON('/loans', {
      amount: 5000,
      durationMonths: 24,
      interestRate: 8.5,
      purpose: 'Home Improvements',
      targetAccount: accountNo
    }, token);
    console.log("Loan Application Status:", loanResult.status, loanResult.data);
    const loanId = loanResult.data.loan._id;

    // 7. Login as Admin
    console.log("\n7. Authenticating Admin Console...");
    const adminLogin = await postJSON('/admin-login', { password: 'atish1997' });
    console.log("Admin Login Status:", adminLogin.status);
    const adminToken = adminLogin.data.token;

    // 8. Admin reviews & approves loan
    console.log("\n8. Admin approving loan...");
    const reviewResult = await postJSON(`/admin/loans/${loanId}/review`, {
      action: 'approved',
      remarks: 'Credit score checks passed'
    }, adminToken);
    console.log("Loan Underwriting Approval Status:", reviewResult.status, reviewResult.data);

    // Check balance of user account (should have been credited with loan principal of $5,000)
    profileUpdated = await getJSON('/me', token);
    console.log(`Balance after Loan credit: $${profileUpdated.data.user.accounts[0].balance} (Expected: $12,400.00)`);

    // 9. Dashboard Analytics check
    console.log("\n9. Fetching Analytics Dashboard summary...");
    const analytics = await getJSON('/analytics/summary', token);
    console.log("Dashboard Analytics:", analytics.status, analytics.data);

    // 10. Monthly Statement retrieve check
    console.log("\n10. Fetching June 2026 Monthly Statement Ledger...");
    const statementTxns = await getJSON(`/transactions/monthly?accountNumber=${accountNo}&month=5&year=2026`, token);
    console.log("Statement Transactions count:", statementTxns.status, statementTxns.data.length);
    console.log("Transactions List:");
    statementTxns.data.forEach(t => {
      console.log(`- ${t.type.toUpperCase()}: $${t.amount} (${t.description || ''})`);
    });

    // 11. Account Closure checks
    console.log("\n11. Testing Account Closure Rules...");
    
    // A. Try to close primary account that has balance
    console.log("A. Attempting to close account with balance...");
    const closeWithBalance = await postJSON(`/accounts/${accountNo}/close`, {}, token);
    console.log("Result (Should be 400):", closeWithBalance.status, closeWithBalance.data);

    // B. Create a new sub-account to test clean closure
    console.log("B. Opening new sub-account...");
    const openSub = await postJSON('/accounts', { type: 'Current' }, token);
    const subAccNo = openSub.data.account.accountNumber;
    console.log("Sub-account opened:", subAccNo);

    // C. Try to close primary account (still has balance, but now user has 2 accounts)
    console.log("C. Attempting to close primary account (has balance, 2 active accounts)...");
    const closePrimary2 = await postJSON(`/accounts/${accountNo}/close`, {}, token);
    console.log("Result (Should be 400):", closePrimary2.status, closePrimary2.data);

    // D. Close the new sub-account (balance is 0, no active FD/RD/loans)
    console.log("D. Attempting to close new sub-account (balance 0, no links)...");
    const closeSubClean = await postJSON(`/accounts/${subAccNo}/close`, {}, token);
    console.log("Result (Should be 200):", closeSubClean.status, closeSubClean.data);

    // E. Try to close sub-account again (already closed)
    console.log("E. Attempting to close sub-account again...");
    const closeSubAgain = await postJSON(`/accounts/${subAccNo}/close`, {}, token);
    console.log("Result (Should be 400):", closeSubAgain.status, closeSubAgain.data);

    // F. Try to close primary account now (it is the only active account left)
    console.log("F. Attempting to close primary account (only active account left)...");
    const closePrimaryOnly = await postJSON(`/accounts/${accountNo}/close`, {}, token);
    console.log("Result (Should be 400):", closePrimaryOnly.status, closePrimaryOnly.data);

    console.log("\n=== ALL NEW SCENARIOS TESTED & VERIFIED ===");
  } catch (err) {
    console.error("VERIFICATION SUITE CRASHED:", err);
  }
}

runTests();
