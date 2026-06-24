/**
 * Session manager - tracks active VNC connections
 */
const { v4: uuidv4 } = require('uuid');

const sessions = new Map();

/**
 * Create a new session with VNC connection
 * @param {object} vncClient - connected VNC client instance
 * @param {object} config - connection config used
 * @returns {string} sessionId
 */
function createSession(vncClient, config) {
  const id = uuidv4();
  const session = {
    id,
    vncClient,
    config: {
      host: config.host,
      port: config.port,
      // never store password
    },
    createdAt: Date.now(),
    lastActivity: Date.now(),
    connected: true,
  };
  sessions.set(id, session);
  return id;
}

function getSession(id) {
  return sessions.get(id) || null;
}

function destroySession(id) {
  const session = sessions.get(id);
  if (!session) return false;
  try {
    if (session.vncClient && session.vncClient.disconnect) {
      session.vncClient.disconnect();
    }
  } catch (_) { /* ignore */ }
  session.connected = false;
  sessions.delete(id);
  return true;
}

function touchSession(id) {
  const session = sessions.get(id);
  if (session) session.lastActivity = Date.now();
}

function listSessions() {
  return Array.from(sessions.values()).map(s => ({
    id: s.id,
    host: s.config.host,
    port: s.config.port,
    connected: s.connected,
    createdAt: s.createdAt,
    lastActivity: s.lastActivity,
  }));
}

// Auto-cleanup: disconnect sessions idle > 30 min
const IDLE_TIMEOUT = 30 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.lastActivity > IDLE_TIMEOUT) {
      console.log(`[Session] Auto-disconnecting idle session: ${id}`);
      destroySession(id);
    }
  }
}, 60 * 1000);

module.exports = {
  createSession,
  getSession,
  destroySession,
  touchSession,
  listSessions,
};
