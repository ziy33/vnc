const express = require('express');
const path = require('path');
const { router: connectRouter } = require('./routes/connect');
const { router: streamRouter } = require('./routes/stream');
const { router: inputRouter } = require('./routes/input');
const { router: statusRouter } = require('./routes/status');
const { router: ftpRouter } = require('./routes/ftp');

const app = express();
const PORT = process.env.PORT || 3000;

// --- Middleware ---
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// --- Routes ---
app.use(connectRouter);
app.use(streamRouter);
app.use(inputRouter);
app.use(statusRouter);
app.use(ftpRouter);

// --- Start ---
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[HTTP-VNC-Proxy] Listening on http://0.0.0.0:${PORT}`);
});
