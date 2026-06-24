/**
 * VNC Client - connects to remote VNC server, receives frames, sends input
 */
const net = require('net');
const EventEmitter = require('events');
const sharp = require('sharp');

// RFB protocol constants
const RFB_VERSION = 'RFB 003.008\n';
const SECURITY_NONE = 1;
const SECURITY_VNC_AUTH = 2;
const SECURITY_RESULT_OK = 0;
const CLIENT_INIT_SHARED = 1;

// Pixel format: 32-bit RGBA
const PIXEL_FORMAT = {
  bitsPerPixel: 32,
  depth: 24,
  bigEndian: 0,
  trueColor: 1,
  redMax: 255,
  greenMax: 255,
  blueMax: 255,
  redShift: 16,
  greenShift: 8,
  blueShift: 0,
};

class VNCClient extends EventEmitter {
  constructor(config) {
    super();
    this.host = config.host;
    this.port = config.port || 5900;
    this.password = config.password || '';
    this.socket = null;
    this.connected = false;
    this.frameWidth = 0;
    this.frameHeight = 0;
    this.frameBuffer = null;

    // Protocol state
    this._state = 'disconnected';
    this._buffer = Buffer.alloc(0);
    this._rectsRemaining = 0;
    this._currentRect = null;
    this._rectBytesRemaining = 0;
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.socket = net.createConnection({ host: this.host, port: this.port }, () => {
        this._state = 'version';
        console.log(`[VNC] TCP connected to ${this.host}:${this.port}`);
      });

      this.socket.on('data', (data) => this._onData(data));
      this.socket.on('error', (err) => {
        this.emit('error', err);
        reject(err);
      });
      this.socket.on('close', () => {
        this.connected = false;
        this._state = 'disconnected';
        this.emit('disconnected');
      });

      // Timeout for handshake
      this._connectTimeout = setTimeout(() => {
        if (!this.connected) {
          reject(new Error('VNC connection timeout'));
          this.disconnect();
        }
      }, 10000);
    });
  }

  disconnect() {
    if (this._connectTimeout) clearTimeout(this._connectTimeout);
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
    this.connected = false;
    this._state = 'disconnected';
  }

  // --- Send input events ---

  sendKeyEvent(keysym, down) {
    if (!this.connected) return;
    const buf = Buffer.alloc(8);
    buf.writeUInt8(4, 0);       // message-type: KeyEvent
    buf.writeUInt8(down ? 1 : 0, 1);
    buf.writeUInt16BE(0, 2);     // padding
    buf.writeUInt32BE(keysym, 4);
    this.socket.write(buf);
  }

  sendPointerEvent(x, y, buttonMask) {
    if (!this.connected) return;
    const buf = Buffer.alloc(6);
    buf.writeUInt8(5, 0);       // message-type: PointerEvent
    buf.writeUInt8(buttonMask, 1);
    buf.writeUInt16BE(x, 2);
    buf.writeUInt16BE(y, 4);
    this.socket.write(buf);
  }

  // Request framebuffer update
  requestFrame(incremental = true) {
    if (!this.connected) return;
    const buf = Buffer.alloc(10);
    buf.writeUInt8(3, 0);         // message-type: FramebufferUpdateRequest
    buf.writeUInt8(incremental ? 1 : 0, 1);
    buf.writeUInt16BE(0, 2);     // x
    buf.writeUInt16BE(0, 4);     // y
    buf.writeUInt16BE(this.frameWidth, 6);
    buf.writeUInt16BE(this.frameHeight, 8);
    this.socket.write(buf);
  }

  // --- Protocol parser ---

  _onData(data) {
    this._buffer = Buffer.concat([this._buffer, data]);
    this._processBuffer();
  }

  _processBuffer() {
    switch (this._state) {
      case 'version': this._parseVersion(); break;
      case 'security-types': this._parseSecurityTypes(); break;
      case 'vnc-auth-challenge': this._parseVncAuthChallenge(); break;
      case 'security-result': this._parseSecurityResult(); break;
      case 'server-init': this._parseServerInit(); break;
      case 'frame-update-header': this._parseFrameUpdateHeader(); break;
      case 'frame-rect-header': this._parseRectHeader(); break;
      case 'frame-rect-data': this._parseRectData(); break;
    }
  }

  _consume(n) {
    const data = this._buffer.slice(0, n);
    this._buffer = this._buffer.slice(n);
    return data;
  }

  _parseVersion() {
    if (this._buffer.length < 12) return;
    const version = this._consume(12).toString();
    console.log(`[VNC] Server version: ${version.trim()}`);

    // Send our version
    this.socket.write(RFB_VERSION);
    this._state = 'security-types';
    this._processBuffer();
  }

  _parseSecurityTypes() {
    if (this._buffer.length < 2) return;
    const count = this._buffer.readUInt8(0);
    if (this._buffer.length < 1 + count) return;

    this._consume(1); // count
    const types = [];
    for (let i = 0; i < count; i++) {
      types.push(this._buffer.readUInt8(i));
    }
    this._consume(count);

    console.log(`[VNC] Security types: ${types}`);

    if (this.password && types.includes(SECURITY_VNC_AUTH)) {
      // Use VNC auth
      this.socket.write(Buffer.from([SECURITY_VNC_AUTH]));
      this._state = 'vnc-auth-challenge';
    } else if (types.includes(SECURITY_NONE)) {
      // No auth
      this.socket.write(Buffer.from([SECURITY_NONE]));
      this._state = 'security-result';
    } else {
      this.emit('error', new Error(`Unsupported security types: ${types}`));
      this.disconnect();
      return;
    }
    this._processBuffer();
  }

  _parseVncAuthChallenge() {
    if (this._buffer.length < 16) return;
    const challenge = this._consume(16);

    // VNC DES authentication
    const response = this._vncEncrypt(challenge, this.password);
    this.socket.write(response);
    this._state = 'security-result';
    this._processBuffer();
  }

  _parseSecurityResult() {
    if (this._buffer.length < 4) return;
    const result = this._consume(4).readUInt32BE();
    if (result === SECURITY_RESULT_OK) {
      console.log('[VNC] Authentication successful');

      // ClientInit: shared flag
      const clientInit = Buffer.alloc(1);
      clientInit.writeUInt8(CLIENT_INIT_SHARED, 0);
      this.socket.write(clientInit);

      this._state = 'server-init';
    } else {
      this.emit('error', new Error('VNC authentication failed'));
      this.disconnect();
    }
    this._processBuffer();
  }

  _parseServerInit() {
    if (this._buffer.length < 24) return;
    const header = this._consume(24);

    this.frameWidth = header.readUInt16BE(0);
    this.frameHeight = header.readUInt16BE(2);

    const nameLen = header.readUInt32BE(20);
    if (this._buffer.length < nameLen) return;
    const name = this._consume(nameLen).toString();
    console.log(`[VNC] Server: ${name} (${this.frameWidth}x${this.frameHeight})`);

    // Set pixel format
    this._sendSetPixelFormat();
    // Set encodings (Raw only for simplicity)
    this._sendSetEncodings();

    this.connected = true;
    this._state = 'frame-update-header';
    this.emit('connected', { width: this.frameWidth, height: this.frameHeight, name });

    // Request first full frame
    this.requestFrame(false);

    if (this._connectTimeout) {
      clearTimeout(this._connectTimeout);
      this._connectTimeout = null;
    }
  }

  _sendSetPixelFormat() {
    const buf = Buffer.alloc(20);
    buf.writeUInt8(0, 0);     // message-type: SetPixelFormat
    // bytes 1-3: padding
    buf.writeUInt8(PIXEL_FORMAT.bitsPerPixel, 4);
    buf.writeUInt8(PIXEL_FORMAT.depth, 5);
    buf.writeUInt8(PIXEL_FORMAT.bigEndian, 6);
    buf.writeUInt8(PIXEL_FORMAT.trueColor, 7);
    buf.writeUInt16BE(PIXEL_FORMAT.redMax, 8);
    buf.writeUInt16BE(PIXEL_FORMAT.greenMax, 10);
    buf.writeUInt16BE(PIXEL_FORMAT.blueMax, 12);
    buf.writeUInt8(PIXEL_FORMAT.redShift, 14);
    buf.writeUInt8(PIXEL_FORMAT.greenShift, 15);
    buf.writeUInt8(PIXEL_FORMAT.blueShift, 16);
    // bytes 17-19: padding
    this.socket.write(buf);
  }

  _sendSetEncodings() {
    const encodings = [0]; // Raw only
    const buf = Buffer.alloc(4 + encodings.length * 4);
    buf.writeUInt8(2, 0);     // message-type: SetEncodings
    // byte 1: padding
    buf.writeUInt16BE(encodings.length, 2);
    encodings.forEach((enc, i) => {
      buf.writeInt32BE(enc, 4 + i * 4);
    });
    this.socket.write(buf);
  }

  _parseFrameUpdateHeader() {
    if (this._buffer.length < 4) return;
    const header = this._consume(4);
    const msgType = header.readUInt8(0);
    if (msgType !== 0) {
      console.warn(`[VNC] Unexpected message type: ${msgType}`);
      // Try to recover
      this._state = 'frame-update-header';
      return;
    }
    // byte 1: padding
    this._rectsRemaining = header.readUInt16BE(2);
    this._state = 'frame-rect-header';
    this._processBuffer();
  }

  _parseRectHeader() {
    if (this._buffer.length < 12) return;
    const header = this._consume(12);
    this._currentRect = {
      x: header.readUInt16BE(0),
      y: header.readUInt16BE(2),
      width: header.readUInt16BE(4),
      height: header.readUInt16BE(6),
      encoding: header.readInt32BE(8),
    };
    this._rectBytesRemaining = this._currentRect.width * this._currentRect.height * 4; // RGBA
    this._state = 'frame-rect-data';
    this._processBuffer();
  }

  _parseRectData() {
    if (this._buffer.length < this._rectBytesRemaining) return;
    const pixelData = this._consume(this._rectBytesRemaining);

    // Merge into full framebuffer
    this._mergeRect(this._currentRect, pixelData);

    this._rectsRemaining--;
    if (this._rectsRemaining > 0) {
      this._state = 'frame-rect-header';
    } else {
      // Frame complete - emit and request next
      this.emit('frame', {
        width: this.frameWidth,
        height: this.frameHeight,
        buffer: this.frameBuffer,
      });
      this._state = 'frame-update-header';
      // Request next incremental update
      this.requestFrame(true);
    }
    this._processBuffer();
  }

  _mergeRect(rect, pixelData) {
    // Initialize framebuffer if needed
    if (!this.frameBuffer || this.frameBuffer.length !== this.frameWidth * this.frameHeight * 4) {
      this.frameBuffer = Buffer.alloc(this.frameWidth * this.frameHeight * 4);
    }

    // Copy rect pixels into correct position in framebuffer
    for (let row = 0; row < rect.height; row++) {
      const srcOffset = row * rect.width * 4;
      const dstOffset = ((rect.y + row) * this.frameWidth + rect.x) * 4;
      pixelData.copy(this.frameBuffer, dstOffset, srcOffset, srcOffset + rect.width * 4);
    }
  }

  // --- VNC DES encryption for password authentication ---
  _vncEncrypt(challenge, password) {
    const crypto = require('crypto');

    // Pad/truncate password to 8 bytes, reverse bit order of each byte (VNC spec requirement)
    const key = Buffer.alloc(8);
    for (let i = 0; i < 8; i++) {
      let ch = i < password.length ? password.charCodeAt(i) : 0;
      ch = ((ch & 0x55) << 1) | ((ch & 0xAA) >> 1);
      ch = ((ch & 0x33) << 2) | ((ch & 0xCC) >> 2);
      ch = ((ch & 0x0F) << 4) | ((ch & 0xF0) >> 4);
      key[i] = ch;
    }

    // DES-ECB: each 8-byte block encrypted independently
    const block1 = crypto.createCipheriv('des-ecb', key, null).update(challenge.slice(0, 8));
    const block2 = crypto.createCipheriv('des-ecb', key, null).update(challenge.slice(8, 16));

    return Buffer.concat([block1, block2]);
  }

  /**
   * Get current frame as JPEG buffer
   * @returns {Promise<Buffer>} JPEG image buffer
   */
  async getJPEG(quality = 60) {
    if (!this.frameBuffer) return null;

    // Our pixel format: redShift=16, greenShift=8, blueShift=0 (little-endian → B,G,R,A in memory)
    // sharp needs RGB order, so swap B and R
    const rgbBuffer = Buffer.alloc(this.frameWidth * this.frameHeight * 3);
    for (let i = 0; i < this.frameWidth * this.frameHeight; i++) {
      const src = i * 4;
      const dst = i * 3;
      rgbBuffer[dst] = this.frameBuffer[src + 2];     // R (from byte 2)
      rgbBuffer[dst + 1] = this.frameBuffer[src + 1]; // G (from byte 1)
      rgbBuffer[dst + 2] = this.frameBuffer[src];     // B (from byte 0)
    }

    return sharp(rgbBuffer, {
      raw: {
        width: this.frameWidth,
        height: this.frameHeight,
        channels: 3,
      }
    })
    .jpeg({ quality })
    .toBuffer();
  }
}

module.exports = { VNCClient };
