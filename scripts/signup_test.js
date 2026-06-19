const http = require('http');
const data = JSON.stringify({ name: 'Signup Node', username: 'apnode', password: 'pass123', accountNumber: 777777, email: 'node@test.com', mobile: '7770001111' });
const opts = { hostname: 'localhost', port: 3000, path: '/signup', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } };
const req = http.request(opts, res => {
  let body = '';
  res.on('data', d => body += d);
  res.on('end', () => { console.log('STATUS', res.statusCode); console.log(body); });
});
req.on('error', e => console.error(e));
req.write(data);
req.end();
