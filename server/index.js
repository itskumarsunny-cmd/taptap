require('dotenv').config();
const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const mongoose   = require('mongoose');
const bcrypt     = require('bcryptjs');
const jwt        = require('jsonwebtoken');
const cookieParser = require('cookie-parser');

const app    = express();
const server = http.createServer(app);

// ── CORS: allow your Hostinger domain ────────────────────────
const FRONTEND_URL = process.env.FRONTEND_URL || '*';

const io = new Server(server, {
  cors: {
    origin: FRONTEND_URL,
    methods: ['GET', 'POST'],
    credentials: true
  }
});

app.use(express.json());
app.use(cookieParser());
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', FRONTEND_URL);
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ── DATABASE ──────────────────────────────────────────────────
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.log('⚠️  MongoDB error:', err.message));

// ── USER MODEL ────────────────────────────────────────────────
const userSchema = new mongoose.Schema({
  username:  { type: String, required: true, unique: true, trim: true, minlength: 3, maxlength: 20 },
  email:     { type: String, required: true, unique: true, lowercase: true },
  password:  { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
  lastSeen:  { type: Date, default: Date.now },
  chatCount: { type: Number, default: 0 },
  isBanned:  { type: Boolean, default: false }
});
const User = mongoose.model('User', userSchema);

// ── JWT HELPERS ───────────────────────────────────────────────
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_CHANGE_THIS';

const signToken  = (id) => jwt.sign({ id }, JWT_SECRET, { expiresIn: '7d' });
const verifyToken = (token) => { try { return jwt.verify(token, JWT_SECRET); } catch { return null; } };

function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1] || req.cookies?.token;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  const decoded = verifyToken(token);
  if (!decoded) return res.status(401).json({ error: 'Invalid or expired token' });
  req.userId = decoded.id;
  next();
}

// ── AUTH ROUTES ───────────────────────────────────────────────

// Health check
app.get('/', (req, res) => res.json({ status: 'RandoChat API running ✅', version: '1.0.0' }));

// Register
app.post('/api/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    if (!username || !email || !password)
      return res.status(400).json({ error: 'All fields are required' });
    if (password.length < 6)
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    if (username.length < 3)
      return res.status(400).json({ error: 'Username must be at least 3 characters' });
    if (!/^[a-zA-Z0-9_]+$/.test(username))
      return res.status(400).json({ error: 'Username: only letters, numbers, underscores' });

    const exists = await User.findOne({ $or: [{ email: email.toLowerCase() }, { username }] });
    if (exists) {
      if (exists.email === email.toLowerCase())
        return res.status(400).json({ error: 'Email already registered' });
      return res.status(400).json({ error: 'Username already taken' });
    }

    const hashed = await bcrypt.hash(password, 12);
    const user   = await User.create({ username, email: email.toLowerCase(), password: hashed });
    const token  = signToken(user._id);

    res.json({ success: true, token, user: { id: user._id, username: user.username, email: user.email } });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Login
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ error: 'Email and password required' });

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) return res.status(401).json({ error: 'Invalid email or password' });
    if (user.isBanned) return res.status(403).json({ error: 'Account suspended' });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ error: 'Invalid email or password' });

    user.lastSeen = new Date();
    await user.save();

    const token = signToken(user._id);
    res.json({ success: true, token, user: { id: user._id, username: user.username, email: user.email } });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Get current user (verify token)
app.get('/api/me', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select('-password');
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ user });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

// Live stats
app.get('/api/stats', (req, res) => {
  res.json({ onlineUsers: onlineUsers.size, waitingUsers: waitingQueue.length });
});

// ── MATCHMAKING STATE ─────────────────────────────────────────
const onlineUsers  = new Map();   // socketId → { userId, username, mode }
const waitingQueue = [];          // [{ socketId, mode, userId, username }]
const activePairs  = new Map();   // socketId → partnerSocketId

// ── SOCKET.IO ─────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`🔌 Connected: ${socket.id}`);

  // Auth
  socket.on('authenticate', ({ token }) => {
    const decoded = verifyToken(token);
    if (!decoded) { socket.emit('auth-error', 'Invalid token'); return; }

    User.findById(decoded.id).select('-password').then(user => {
      if (!user || user.isBanned) { socket.emit('auth-error', 'Account not found'); return; }
      onlineUsers.set(socket.id, { userId: user._id.toString(), username: user.username, mode: null });
      socket.emit('authenticated', { username: user.username });
      broadcastStats();
      console.log(`✅ Auth: ${user.username}`);
    }).catch(() => socket.emit('auth-error', 'Server error'));
  });

  // Find partner
  socket.on('find-partner', ({ mode }) => {
    const me = onlineUsers.get(socket.id);
    if (!me) { socket.emit('error', 'Not authenticated'); return; }
    if (activePairs.has(socket.id)) return;

    me.mode = mode || 'video';

    // Remove from queue if already in it
    const existing = waitingQueue.findIndex(w => w.socketId === socket.id);
    if (existing !== -1) waitingQueue.splice(existing, 1);

    // Find waiting partner with same mode
    const idx = waitingQueue.findIndex(w => w.mode === me.mode);

    if (idx !== -1) {
      const partner = waitingQueue.splice(idx, 1)[0];
      activePairs.set(socket.id, partner.socketId);
      activePairs.set(partner.socketId, socket.id);

      socket.emit('partner-found', { partnerName: partner.username, isInitiator: true, mode: me.mode });
      io.to(partner.socketId).emit('partner-found', { partnerName: me.username, isInitiator: false, mode: me.mode });

      // Increment chat counts
      User.findByIdAndUpdate(me.userId, { $inc: { chatCount: 1 } }).catch(() => {});
      User.findByIdAndUpdate(partner.userId, { $inc: { chatCount: 1 } }).catch(() => {});

      console.log(`✅ Paired: ${me.username} ↔ ${partner.username} [${me.mode}]`);
    } else {
      waitingQueue.push({ socketId: socket.id, mode: me.mode, userId: me.userId, username: me.username });
      socket.emit('waiting');
      console.log(`⏳ Waiting: ${me.username} [${me.mode}] — queue: ${waitingQueue.length}`);
    }
    broadcastStats();
  });

  // WebRTC signaling — relay between paired users
  socket.on('webrtc-offer',  ({ offer })     => relay(socket.id, 'webrtc-offer',  { offer }));
  socket.on('webrtc-answer', ({ answer })    => relay(socket.id, 'webrtc-answer', { answer }));
  socket.on('webrtc-ice',    ({ candidate }) => relay(socket.id, 'webrtc-ice',    { candidate }));

  // Chat message
  socket.on('chat-message', ({ text }) => {
    const me = onlineUsers.get(socket.id);
    const partnerId = activePairs.get(socket.id);
    if (!me || !partnerId || !text) return;
    io.to(partnerId).emit('chat-message', { text: String(text).substring(0, 500), from: me.username });
  });

  // Skip
  socket.on('skip', () => disconnectPair(socket.id, 'skip'));

  // Report
  socket.on('report', ({ reason }) => {
    const me = onlineUsers.get(socket.id);
    const partnerId = activePairs.get(socket.id);
    console.log(`🚩 REPORT by ${me?.username} against ${partnerId}: ${reason}`);
    // TODO: save to DB for moderation
    disconnectPair(socket.id, 'skip');
  });

  // Disconnect
  socket.on('disconnect', () => {
    disconnectPair(socket.id, 'disconnect');
    onlineUsers.delete(socket.id);
    const qi = waitingQueue.findIndex(w => w.socketId === socket.id);
    if (qi !== -1) waitingQueue.splice(qi, 1);
    broadcastStats();
    console.log(`❌ Disconnected: ${socket.id}`);
  });

  // ── Helpers ──
  function relay(fromId, event, data) {
    const partnerId = activePairs.get(fromId);
    if (partnerId) io.to(partnerId).emit(event, data);
  }

  function disconnectPair(socketId, reason) {
    const partnerId = activePairs.get(socketId);
    if (partnerId) {
      activePairs.delete(socketId);
      activePairs.delete(partnerId);
      io.to(partnerId).emit('partner-left', { reason });
    }
  }

  function broadcastStats() {
    io.emit('stats-update', { onlineUsers: onlineUsers.size, waitingUsers: waitingQueue.length });
  }
});

// ── START ─────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Server on port ${PORT}`));
