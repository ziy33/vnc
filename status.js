/**
 * Status route - connection health check
 */
const express = require('express');
const router = express.Router();
const { getSession } = require('../session');

// GET /status?id=xxx
router.get('/status', (req, res) => {
  const sessionId = req.query.id;
  if (!sessionId) {
    return res.status(400).json({ error: 'id is required' });
  }

  const session = getSession(sessionId);
  if (!session) {
    return res.status(404).json({ connected: false, error: 'Session not found' });
  }

  res.json({
    connected: session.connected,
    host: session.config.host,
    port: session.config.port,
    width: session.vncClient?.frameWidth,
    height: session.vncClient?.frameHeight,
    lastActivity: session.lastActivity,
    uptime: Date.now() - session.createdAt,
  });
});

module.exports = { router };
