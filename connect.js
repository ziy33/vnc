/**
 * Connect route - establish VNC connection to A network
 */
const express = require('express');
const router = express.Router();
const { VNCClient } = require('../clients/vnc');
const { createSession, destroySession, listSessions } = require('../session');

// POST /connect - create a new VNC session
router.post('/connect', async (req, res) => {
  const { host, port, password } = req.body;

  if (!host) {
    return res.status(400).json({ error: 'host is required' });
  }

  const vnc = new VNCClient({
    host,
    port: port || 5900,
    password: password || '',
  });

  try {
    // Wait for connection + first frame
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Connection timeout')), 15000);

      vnc.once('connected', (info) => {
        clearTimeout(timeout);
        resolve(info);
      });

      vnc.once('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });

      vnc.connect().catch(reject);
    });

    const sessionId = createSession(vnc, { host, port: port || 5900 });
    console.log(`[Connect] Session ${sessionId} → ${host}:${port || 5900}`);

    res.json({
      ok: true,
      sessionId,
      width: vnc.frameWidth,
      height: vnc.frameHeight,
    });
  } catch (err) {
    vnc.disconnect();
    console.error(`[Connect] Failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// POST /disconnect - close a session
router.post('/disconnect', (req, res) => {
  const { sessionId } = req.body;
  if (!sessionId) {
    return res.status(400).json({ error: 'sessionId is required' });
  }

  const ok = destroySession(sessionId);
  if (ok) {
    console.log(`[Disconnect] Session ${sessionId} closed`);
    res.json({ ok: true });
  } else {
    res.status(404).json({ error: 'Session not found' });
  }
});

// GET /sessions - list active sessions
router.get('/sessions', (req, res) => {
  res.json({ sessions: listSessions() });
});

module.exports = { router };
