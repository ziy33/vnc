/**
 * Input route - forward keyboard/mouse events to VNC
 */
const express = require('express');
const router = express.Router();
const { getSession, touchSession } = require('../session');

// X11 keysym mapping for common keys
const KEYSYM_MAP = {
  'Backspace': 0xFF08,
  'Tab': 0xFF09,
  'Enter': 0xFF0D,
  'Escape': 0xFF1B,
  'Delete': 0xFFFF,
  'Home': 0xFF50,
  'End': 0xFF57,
  'PageUp': 0xFF55,
  'PageDown': 0xFF56,
  'ArrowLeft': 0xFF51,
  'ArrowUp': 0xFF52,
  'ArrowRight': 0xFF53,
  'ArrowDown': 0xFF54,
  'F1': 0xFFBE, 'F2': 0xFFBF, 'F3': 0xFFC0, 'F4': 0xFFC1,
  'F5': 0xFFC2, 'F6': 0xFFC3, 'F7': 0xFFC4, 'F8': 0xFFC5,
  'F9': 0xFFC6, 'F10': 0xFFC7, 'F11': 0xFFC8, 'F12': 0xFFC9,
  'ShiftLeft': 0xFFE1, 'ShiftRight': 0xFFE2,
  'ControlLeft': 0xFFE3, 'ControlRight': 0xFFE4,
  'AltLeft': 0xFFE9, 'AltRight': 0xFFEA,
  'MetaLeft': 0xFFEB, 'MetaRight': 0xFFEC,
  'CapsLock': 0xFFE5, 'NumLock': 0xFF7F,
  'Insert': 0xFF63,
  'ContextMenu': 0xFF67,
  'ScrollLock': 0xFF14,
  'PrintScreen': 0xFF61,
  'Pause': 0xFF13,
};

function charToKeysym(ch) {
  const code = ch.charCodeAt(0);
  if (code >= 0x20 && code <= 0x7E) return code; // printable ASCII
  if (code >= 0x100) return code | 0x01000000; // Unicode keysym
  return 0;
}

// Mouse button masks
const BUTTON_MASK = {
  left: 1,
  middle: 2,
  right: 4,
  scrollUp: 8,
  scrollDown: 16,
};

// POST /input - send keyboard/mouse event
router.post('/input', (req, res) => {
  const { sessionId, type, data } = req.body;

  if (!sessionId) {
    return res.status(400).json({ error: 'sessionId is required' });
  }

  const session = getSession(sessionId);
  if (!session || !session.connected) {
    return res.status(404).json({ error: 'Session not found' });
  }

  const vnc = session.vncClient;

  try {
    switch (type) {
      case 'keydown': {
        const keysym = KEYSYM_MAP[data.key] || charToKeysym(data.key || '');
        if (keysym) vnc.sendKeyEvent(keysym, true);
        break;
      }
      case 'keyup': {
        const keysym = KEYSYM_MAP[data.key] || charToKeysym(data.key || '');
        if (keysym) vnc.sendKeyEvent(keysym, false);
        break;
      }
      case 'mousedown': {
        const mask = (vnc._buttonMask || 0) | (BUTTON_MASK[data.button] || 1);
        vnc._buttonMask = mask;
        vnc.sendPointerEvent(data.x || 0, data.y || 0, mask);
        break;
      }
      case 'mouseup': {
        const mask = (vnc._buttonMask || 0) & ~(BUTTON_MASK[data.button] || 1);
        vnc._buttonMask = mask;
        vnc.sendPointerEvent(data.x || 0, data.y || 0, mask);
        break;
      }
      case 'mousemove': {
        vnc.sendPointerEvent(data.x || 0, data.y || 0, vnc._buttonMask || 0);
        break;
      }
      case 'wheel': {
        const btn = data.deltaY > 0 ? 'scrollDown' : 'scrollUp';
        const mask = (vnc._buttonMask || 0) | BUTTON_MASK[btn];
        vnc.sendPointerEvent(data.x || 0, data.y || 0, mask);
        // Release after brief moment
        setTimeout(() => {
          vnc.sendPointerEvent(data.x || 0, data.y || 0, vnc._buttonMask || 0);
        }, 20);
        break;
      }
      default:
        return res.status(400).json({ error: `Unknown input type: ${type}` });
    }

    touchSession(sessionId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = { router };
