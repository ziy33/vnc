/**
 * FTP proxy route - HTTP gateway to FTP servers on A network
 * (Phase 2 - basic file browsing and transfer)
 */
const express = require('express');
const router = express.Router();

// Placeholder - FTP functionality to be implemented
// Will use the `basic-ftp` npm package

router.post('/ftp/connect', (req, res) => {
  res.json({ ok: false, message: 'FTP not yet implemented' });
});

module.exports = { router };
