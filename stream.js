/**
 * Stream route - MJPEG over HTTP (multipart/x-mixed-replace)
 * This is the core: pushes VNC frames as JPEG images in an endless HTTP stream
 */
const express = require('express');
const router = express.Router();
const { getSession, touchSession, destroySession } = require('../session');

const BOUNDARY = 'vncboundary';
const FPS = parseInt(process.env.FPS || '10', 10); // 10 FPS default
const JPEG_QUALITY = parseInt(process.env.JPEG_QUALITY || '60', 10);

// GET /stream?id=xxx - MJPEG stream
router.get('/stream', (req, res) => {
  const sessionId = req.query.id;
  if (!sessionId) {
    return res.status(400).send('Missing session id');
  }

  const session = getSession(sessionId);
  if (!session || !session.connected) {
    return res.status(404).send('Session not found or disconnected');
  }

  // Set MJPEG headers
  res.writeHead(200, {
    'Content-Type': `multipart/x-mixed-replace; boundary=${BOUNDARY}`,
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Pragma': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no', // Tell Nginx not to buffer
  });

  console.log(`[Stream] Client connected to session ${sessionId} (${FPS}fps, Q${JPEG_QUALITY})`);

  let streaming = true;
  const intervalMs = Math.max(33, Math.floor(1000 / FPS));
  let lastFrameTime = 0;

  const sendFrame = async () => {
    if (!streaming) return;

    const session = getSession(sessionId);
    if (!session || !session.connected) {
      streaming = false;
      res.end();
      return;
    }

    try {
      const jpeg = await session.vncClient.getJPEG(JPEG_QUALITY);
      if (jpeg && streaming) {
        res.write(
          `--${BOUNDARY}\r\n` +
          `Content-Type: image/jpeg\r\n` +
          `Content-Length: ${jpeg.length}\r\n\r\n`
        );
        res.write(jpeg);
        res.write('\r\n');
      }
    } catch (err) {
      console.error(`[Stream] Frame error: ${err.message}`);
    }

    touchSession(sessionId);

    if (streaming) {
      setTimeout(sendFrame, intervalMs);
    }
  };

  // Start sending frames
  setTimeout(sendFrame, 100);

  // Client disconnected
  req.on('close', () => {
    streaming = false;
    console.log(`[Stream] Client disconnected from session ${sessionId}`);
  });
});

module.exports = { router };
