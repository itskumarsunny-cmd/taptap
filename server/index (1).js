require('dotenv').config();
const express       = require('express');
const http          = require('http');
const { Server }    = require('socket.io');
const mongoose      = require('mongoose');
const bcrypt        = require('bcryptjs');
const jwt           = require('jsonwebtoken');
const cookieParser  = require('cookie-parser');
const crypto        = require('crypto');

const app    = express();
const server = http.createServer(app);

// ── CORS ──────────────────────────────────────────────────────
const FRONTEND_URL = process.env.FRONTEND_URL || '*';

const io = new Server(server, {
  cors: { origin: FRONTEND_URL, methods: ['GET', 'POST'], credentials: true }
});

app.use(express.json());
app.use(cookieParser());
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', FRONTEND_URL);
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ── DATABASE ──────────────────────────────────────────────────
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.log('⚠️  MongoDB error:', err.message));

// ── COUNTRIES (ISO 3166-1 alpha-2) ───────────────────────────
const COUNTRY_LIST = [
  ['AF','Afghanistan'],['AL','Albania'],['DZ','Algeria'],['AD','Andorra'],['AO','Angola'],
  ['AR','Argentina'],['AM','Armenia'],['AU','Australia'],['AT','Austria'],['AZ','Azerbaijan'],
  ['BS','Bahamas'],['BH','Bahrain'],['BD','Bangladesh'],['BY','Belarus'],['BE','Belgium'],
  ['BZ','Belize'],['BJ','Benin'],['BT','Bhutan'],['BO','Bolivia'],['BA','Bosnia and Herzegovina'],
  ['BW','Botswana'],['BR','Brazil'],['BN','Brunei'],['BG','Bulgaria'],['BF','Burkina Faso'],
  ['BI','Burundi'],['KH','Cambodia'],['CM','Cameroon'],['CA','Canada'],['CV','Cape Verde'],
  ['CF','Central African Republic'],['TD','Chad'],['CL','Chile'],['CN','China'],['CO','Colombia'],
  ['KM','Comoros'],['CG','Congo'],['CD','Congo (DRC)'],['CR','Costa Rica'],['HR','Croatia'],
  ['CU','Cuba'],['CY','Cyprus'],['CZ','Czech Republic'],['DK','Denmark'],['DJ','Djibouti'],
  ['DM','Dominica'],['DO','Dominican Republic'],['EC','Ecuador'],['EG','Egypt'],['SV','El Salvador'],
  ['GQ','Equatorial Guinea'],['ER','Eritrea'],['EE','Estonia'],['SZ','Eswatini'],['ET','Ethiopia'],
  ['FJ','Fiji'],['FI','Finland'],['FR','France'],['GA','Gabon'],['GM','Gambia'],
  ['GE','Georgia'],['DE','Germany'],['GH','Ghana'],['GR','Greece'],['GD','Grenada'],
  ['GT','Guatemala'],['GN','Guinea'],['GW','Guinea-Bissau'],['GY','Guyana'],['HT','Haiti'],
  ['HN','Honduras'],['HK','Hong Kong'],['HU','Hungary'],['IS','Iceland'],['IN','India'],
  ['ID','Indonesia'],['IR','Iran'],['IQ','Iraq'],['IE','Ireland'],['IL','Israel'],
  ['IT','Italy'],['JM','Jamaica'],['JP','Japan'],['JO','Jordan'],['KZ','Kazakhstan'],
  ['KE','Kenya'],['KI','Kiribati'],['KW','Kuwait'],['KG','Kyrgyzstan'],['LA','Laos'],
  ['LV','Latvia'],['LB','Lebanon'],['LS','Lesotho'],['LR','Liberia'],['LY','Libya'],
  ['LI','Liechtenstein'],['LT','Lithuania'],['LU','Luxembourg'],['MO','Macau'],['MG','Madagascar'],
  ['MW','Malawi'],['MY','Malaysia'],['MV','Maldives'],['ML','Mali'],['MT','Malta'],
  ['MR','Mauritania'],['MU','Mauritius'],['MX','Mexico'],['MD','Moldova'],['MC','Monaco'],
  ['MN','Mongolia'],['ME','Montenegro'],['MA','Morocco'],['MZ','Mozambique'],['MM','Myanmar'],
  ['NA','Namibia'],['NP','Nepal'],['NL','Netherlands'],['NZ','New Zealand'],['NI','Nicaragua'],
  ['NE','Niger'],['NG','Nigeria'],['MK','North Macedonia'],['NO','Norway'],['OM','Oman'],
  ['PK','Pakistan'],['PA','Panama'],['PG','Papua New Guinea'],['PY','Paraguay'],['PE','Peru'],
  ['PH','Philippines'],['PL','Poland'],['PT','Portugal'],['PR','Puerto Rico'],['QA','Qatar'],
  ['RO','Romania'],['RU','Russia'],['RW','Rwanda'],['WS','Samoa'],['SM','San Marino'],
  ['SA','Saudi Arabia'],['SN','Senegal'],['RS','Serbia'],['SC','Seychelles'],['SL','Sierra Leone'],
  ['SG','Singapore'],['SK','Slovakia'],['SI','Slovenia'],['SB','Solomon Islands'],['SO','Somalia'],
  ['ZA','South Africa'],['KR','South Korea'],['SS','South Sudan'],['ES','Spain'],['LK','Sri Lanka'],
  ['SD','Sudan'],['SR','Suriname'],['SE','Sweden'],['CH','Switzerland'],['SY','Syria'],
  ['TW','Taiwan'],['TJ','Tajikistan'],['TZ','Tanzania'],['TH','Thailand'],['TL','Timor-Leste'],
  ['TG','Togo'],['TO','Tonga'],['TT','Trinidad and Tobago'],['TN','Tunisia'],['TR','Turkey'],
  ['TM','Turkmenistan'],['UG','Uganda'],['UA','Ukraine'],['AE','United Arab Emirates'],
  ['GB','United Kingdom'],['US','United States'],['UY','Uruguay'],['UZ','Uzbekistan'],
  ['VU','Vanuatu'],['VA','Vatican City'],['VE','Venezuela'],['VN','Vietnam'],['YE','Yemen'],
  ['ZM','Zambia'],['ZW','Zimbabwe']
];

function flagEmoji(code) {
  return code.toUpperCase().replace(/./g, ch => String.fromCodePoint(127397 + ch.charCodeAt(0)));
}

const COUNTRIES = COUNTRY_LIST
  .map(([code, name]) => ({ code, name, flag: flagEmoji(code) }))
  .sort((a, b) => a.name.localeCompare(b.name));

const COUNTRY_MAP = new Map(COUNTRIES.map(c => [c.code, c]));

// ── MODELS ────────────────────────────────────────────────────
const userSchema = new mongoose.Schema({
  username:          { type: String, required: true, unique: true, trim: true, minlength: 3, maxlength: 20 },
  email:             { type: String, required: true, unique: true, lowercase: true },
  password:          { type: String, required: true },
  gender:            { type: String, enum: ['male', 'female', 'other'], required: true },
  countryCode:       { type: String, required: true },
  countryName:       { type: String, required: true },
  countryFlag:       { type: String, required: true },
  isPremium:         { type: Boolean, default: false },
  premiumPlan:       { type: String, default: null },
  premiumExpiresAt:  { type: Date, default: null },
  createdAt:         { type: Date, default: Date.now },
  lastSeen:          { type: Date, default: Date.now },
  chatCount:         { type: Number, default: 0 },
  isBanned:          { type: Boolean, default: false }
});
const User = mongoose.model('User', userSchema);

const followSchema = new mongoose.Schema({
  follower:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  following: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  createdAt: { type: Date, default: Date.now }
});
followSchema.index({ follower: 1, following: 1 }, { unique: true });
const Follow = mongoose.model('Follow', followSchema);

const conversationSchema = new mongoose.Schema({
  participants: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }],
  lastMessage:  { type: String, default: '' },
  lastAt:       { type: Date, default: Date.now },
  unread:       { type: Map, of: Number, default: {} },
  createdAt:    { type: Date, default: Date.now }
});
const Conversation = mongoose.model('Conversation', conversationSchema);

const messageSchema = new mongoose.Schema({
  conversationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', required: true },
  senderId:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  text:           { type: String, required: true, maxlength: 1000 },
  createdAt:      { type: Date, default: Date.now }
});
const Message = mongoose.model('Message', messageSchema);

const matchHistorySchema = new mongoose.Schema({
  userId:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  partnerId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  partnerName: { type: String, default: 'Unknown' },
  mode:        { type: String, default: 'video' },
  duration:    { type: Number, default: 0 },
  matchedAt:   { type: Date, default: Date.now }
});
const MatchHistory = mongoose.model('MatchHistory', matchHistorySchema);

// ── JWT HELPERS ───────────────────────────────────────────────
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_CHANGE_THIS';

const signToken   = (id) => jwt.sign({ id }, JWT_SECRET, { expiresIn: '7d' });
const verifyToken = (token) => { try { return jwt.verify(token, JWT_SECRET); } catch { return null; } };

function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1] || req.cookies?.token;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  const decoded = verifyToken(token);
  if (!decoded) return res.status(401).json({ error: 'Invalid or expired token' });
  req.userId = decoded.id;
  next();
}

function toPublicUser(u) {
  return {
    id: u._id,
    username: u.username,
    email: u.email,
    gender: u.gender,
    countryCode: u.countryCode,
    countryName: u.countryName,
    countryFlag: u.countryFlag,
    isPremium: u.isPremium,
    premiumPlan: u.premiumPlan,
    premiumExpiresAt: u.premiumExpiresAt,
    chatCount: u.chatCount,
    createdAt: u.createdAt
  };
}

function toOtherUser(u) {
  return {
    _id: u._id,
    id: u._id,
    username: u.username,
    gender: u.gender,
    countryCode: u.countryCode,
    countryName: u.countryName,
    countryFlag: u.countryFlag,
    isPremium: u.isPremium
  };
}

async function isMutual(userIdA, userIdB) {
  const [aFollowsB, bFollowsA] = await Promise.all([
    Follow.exists({ follower: userIdA, following: userIdB }),
    Follow.exists({ follower: userIdB, following: userIdA })
  ]);
  return !!(aFollowsB && bFollowsA);
}

// ── HEALTH ────────────────────────────────────────────────────
app.get('/', (req, res) => res.json({ status: 'TapTap API running ✅', version: '2.0.0' }));

// ── COUNTRIES ─────────────────────────────────────────────────
app.get('/api/countries', (req, res) => res.json({ countries: COUNTRIES }));

// ── AUTH ──────────────────────────────────────────────────────
app.post('/api/register', async (req, res) => {
  try {
    const { username, email, password, gender, countryCode } = req.body;
    if (!username || !email || !password)
      return res.status(400).json({ error: 'All fields are required' });
    if (password.length < 6)
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    if (username.length < 3)
      return res.status(400).json({ error: 'Username must be at least 3 characters' });
    if (!/^[a-zA-Z0-9_]+$/.test(username))
      return res.status(400).json({ error: 'Username: only letters, numbers, underscores' });
    if (!['male', 'female', 'other'].includes(gender))
      return res.status(400).json({ error: 'Please select a valid gender' });
    const country = COUNTRY_MAP.get(countryCode);
    if (!country)
      return res.status(400).json({ error: 'Please select a valid country' });

    const exists = await User.findOne({ $or: [{ email: email.toLowerCase() }, { username } ] });
    if (exists) {
      if (exists.email === email.toLowerCase())
        return res.status(400).json({ error: 'Email already registered' });
      return res.status(400).json({ error: 'Username already taken' });
    }

    const hashed = await bcrypt.hash(password, 12);
    const user = await User.create({
      username, email: email.toLowerCase(), password: hashed, gender,
      countryCode: country.code, countryName: country.name, countryFlag: country.flag
    });
    const token = signToken(user._id);

    res.json({ success: true, token, user: toPublicUser(user) });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

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
    res.json({ success: true, token, user: toPublicUser(user) });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/me', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ user: toPublicUser(user) });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/stats', (req, res) => {
  res.json({ onlineUsers: onlineUsers.size, waitingUsers: waitingQueue.length });
});

// ── PREMIUM ───────────────────────────────────────────────────
app.post('/api/premium/activate', authMiddleware, async (req, res) => {
  try {
    const plan = ['monthly', 'annual'].includes(req.body.plan) ? req.body.plan : 'monthly';
    const days = plan === 'annual' ? 365 : 30;

    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    user.isPremium = true;
    user.premiumPlan = plan;
    user.premiumExpiresAt = new Date(Date.now() + days * 86400000);
    await user.save();

    res.json({ success: true, user: toPublicUser(user) });
  } catch (err) {
    console.error('Premium activate error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── FOLLOW SYSTEM ─────────────────────────────────────────────
app.post('/api/follow/:id', authMiddleware, async (req, res) => {
  try {
    const targetId = req.params.id;
    if (targetId === req.userId) return res.status(400).json({ error: "You can't follow yourself" });

    const target = await User.findById(targetId);
    if (!target) return res.status(404).json({ error: 'User not found' });

    await Follow.findOneAndUpdate(
      { follower: req.userId, following: targetId },
      { follower: req.userId, following: targetId },
      { upsert: true, setDefaultsOnInsert: true }
    );

    const mutual = await isMutual(req.userId, targetId);
    res.json({ success: true, mutual });
  } catch (err) {
    console.error('Follow error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.delete('/api/follow/:id', authMiddleware, async (req, res) => {
  try {
    await Follow.deleteOne({ follower: req.userId, following: req.params.id });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/follow/status/:id', authMiddleware, async (req, res) => {
  try {
    const iFollow = await Follow.exists({ follower: req.userId, following: req.params.id });
    res.json({ iFollow: !!iFollow });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/following', authMiddleware, async (req, res) => {
  try {
    const follows = await Follow.find({ follower: req.userId }).populate('following');
    const following = follows.filter(f => f.following).map(f => toOtherUser(f.following));
    res.json({ following });
  } catch (err) {
    console.error('Following list error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/followers', authMiddleware, async (req, res) => {
  try {
    const follows = await Follow.find({ following: req.userId }).populate('follower');
    const followers = follows.filter(f => f.follower).map(f => toOtherUser(f.follower));
    res.json({ followers });
  } catch (err) {
    console.error('Followers list error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/mutual-follows', authMiddleware, async (req, res) => {
  try {
    const followingIds = await Follow.find({ follower: req.userId }).distinct('following');
    const mutuals = await Follow.find({ follower: { $in: followingIds }, following: req.userId }).populate('follower');
    const mutualFollows = mutuals.filter(f => f.follower).map(f => toOtherUser(f.follower));
    res.json({ mutualFollows });
  } catch (err) {
    console.error('Mutual follows error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── HISTORY ───────────────────────────────────────────────────
app.get('/api/history', authMiddleware, async (req, res) => {
  try {
    const history = await MatchHistory.find({ userId: req.userId }).sort({ matchedAt: -1 }).limit(50);
    res.json({
      history: history.map(h => ({
        partnerId: h.partnerId, partnerName: h.partnerName,
        mode: h.mode, duration: h.duration, matchedAt: h.matchedAt
      }))
    });
  } catch (err) {
    console.error('History error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── CONVERSATIONS / DMs ───────────────────────────────────────
app.post('/api/conversations/start', authMiddleware, async (req, res) => {
  try {
    const { partnerId } = req.body;
    if (!partnerId) return res.status(400).json({ error: 'partnerId is required' });
    if (partnerId === req.userId) return res.status(400).json({ error: "You can't message yourself" });

    const partner = await User.findById(partnerId);
    if (!partner) return res.status(404).json({ error: 'User not found' });

    const me = await User.findById(req.userId);
    const mutual = await isMutual(req.userId, partnerId);
    if (!mutual && !me.isPremium) {
      return res.status(403).json({ error: 'premium_required' });
    }

    let convo = await Conversation.findOne({ participants: { $all: [req.userId, partnerId], $size: 2 } });
    if (!convo) {
      convo = await Conversation.create({ participants: [req.userId, partnerId] });
    }

    res.json({ success: true, conversationId: convo._id });
  } catch (err) {
    console.error('Conversation start error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/conversations', authMiddleware, async (req, res) => {
  try {
    const convos = await Conversation.find({ participants: req.userId })
      .sort({ lastAt: -1 })
      .populate('participants');

    const list = convos.map(c => {
      const partner = c.participants.find(p => p && String(p._id) !== req.userId);
      return {
        id: c._id,
        partnerId: partner ? partner._id : null,
        partnerName: partner ? partner.username : 'Unknown',
        lastMessage: c.lastMessage || '',
        lastAt: c.lastAt,
        unread: (c.unread && c.unread.get(req.userId)) || 0
      };
    });

    res.json({ conversations: list });
  } catch (err) {
    console.error('Conversations list error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/conversations/:id/messages', authMiddleware, async (req, res) => {
  try {
    const convo = await Conversation.findById(req.params.id);
    if (!convo || !convo.participants.map(String).includes(req.userId))
      return res.status(404).json({ error: 'Conversation not found' });

    const messages = await Message.find({ conversationId: convo._id }).sort({ createdAt: 1 });

    convo.unread.set(req.userId, 0);
    await convo.save();

    res.json({ messages: messages.map(m => ({ senderId: m.senderId, text: m.text, createdAt: m.createdAt })) });
  } catch (err) {
    console.error('Messages fetch error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/conversations/:id/messages', authMiddleware, async (req, res) => {
  try {
    const { text } = req.body;
    if (!text || !text.trim()) return res.status(400).json({ error: 'Message text is required' });

    const convo = await Conversation.findById(req.params.id);
    if (!convo || !convo.participants.map(String).includes(req.userId))
      return res.status(404).json({ error: 'Conversation not found' });

    const trimmed = String(text).substring(0, 1000);
    const message = await Message.create({ conversationId: convo._id, senderId: req.userId, text: trimmed });

    convo.lastMessage = trimmed;
    convo.lastAt = message.createdAt;
    const otherId = convo.participants.map(String).find(p => p !== req.userId);
    convo.unread.set(otherId, (convo.unread.get(otherId) || 0) + 1);
    await convo.save();

    const otherSocketId = userSockets.get(otherId);
    if (otherSocketId) {
      io.to(otherSocketId).emit('dm-message', {
        conversationId: convo._id,
        message: { senderId: req.userId, text: trimmed, createdAt: message.createdAt }
      });
      io.to(otherSocketId).emit('dm-notify');
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Message send error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── REALTIME STATE ────────────────────────────────────────────
const onlineUsers  = new Map();  // socketId → { userId, username, mode, gender, countryCode, isPremium, genderFilter, countryFilter }
const waitingQueue = [];         // [{ socketId, ...filters }]
const activePairs  = new Map();  // socketId → partnerSocketId
const pairStart    = new Map();  // socketId → timestamp (ms) when pairing began
const userSockets  = new Map();  // userId → socketId (for DMs / calls, last connection wins)
const callRooms    = new Map();  // roomId → { callerSocketId, targetSocketId, callType }

io.on('connection', (socket) => {
  console.log(`🔌 Connected: ${socket.id}`);

  // ── AUTH ──
  socket.on('authenticate', async ({ token }) => {
    const decoded = verifyToken(token);
    if (!decoded) { socket.emit('auth-error', 'Invalid token'); return; }

    try {
      const user = await User.findById(decoded.id);
      if (!user || user.isBanned) { socket.emit('auth-error', 'Account not found'); return; }

      onlineUsers.set(socket.id, {
        userId: user._id.toString(), username: user.username, mode: null,
        gender: user.gender, countryCode: user.countryCode, isPremium: user.isPremium,
        genderFilter: 'any', countryFilter: 'any'
      });
      userSockets.set(user._id.toString(), socket.id);

      socket.emit('authenticated', { username: user.username, isPremium: user.isPremium });
      broadcastStats();
      console.log(`✅ Auth: ${user.username}`);
    } catch (err) {
      socket.emit('auth-error', 'Server error');
    }
  });

  // ── FIND PARTNER (with gender/country filters, premium-gated) ──
  socket.on('find-partner', async ({ mode, genderFilter, countryFilter }) => {
    const me = onlineUsers.get(socket.id);
    if (!me) { socket.emit('auth-error', 'Not authenticated'); return; }
    if (activePairs.has(socket.id)) return;

    me.mode = mode === 'text' ? 'text' : 'video';
    const wantsGenderFilter  = genderFilter && genderFilter !== 'any';
    const wantsCountryFilter = countryFilter && countryFilter !== 'any';

    if (wantsGenderFilter || wantsCountryFilter) {
      // Re-check premium fresh from DB in case it changed since auth
      const fresh = await User.findById(me.userId).select('isPremium').catch(() => null);
      const premiumNow = fresh ? fresh.isPremium : me.isPremium;
      me.isPremium = premiumNow;
      if (!premiumNow) {
        socket.emit('premium-required', { reason: 'filter' });
        return;
      }
    }

    me.genderFilter  = wantsGenderFilter ? genderFilter : 'any';
    me.countryFilter = wantsCountryFilter ? countryFilter : 'any';

    const existing = waitingQueue.findIndex(w => w.socketId === socket.id);
    if (existing !== -1) waitingQueue.splice(existing, 1);

    const idx = waitingQueue.findIndex(w =>
      w.mode === me.mode &&
      (me.genderFilter === 'any' || w.gender === me.genderFilter) &&
      (w.genderFilter === 'any' || me.gender === w.genderFilter) &&
      (me.countryFilter === 'any' || w.countryCode === me.countryFilter) &&
      (w.countryFilter === 'any' || me.countryCode === w.countryFilter)
    );

    if (idx !== -1) {
      const partner = waitingQueue.splice(idx, 1)[0];
      activePairs.set(socket.id, partner.socketId);
      activePairs.set(partner.socketId, socket.id);
      const now = Date.now();
      pairStart.set(socket.id, now);
      pairStart.set(partner.socketId, now);

      socket.emit('partner-found', { partnerName: partner.username, partnerId: partner.userId, isInitiator: true, mode: me.mode });
      io.to(partner.socketId).emit('partner-found', { partnerName: me.username, partnerId: me.userId, isInitiator: false, mode: me.mode });

      User.findByIdAndUpdate(me.userId, { $inc: { chatCount: 1 } }).catch(() => {});
      User.findByIdAndUpdate(partner.userId, { $inc: { chatCount: 1 } }).catch(() => {});

      console.log(`✅ Paired: ${me.username} ↔ ${partner.username} [${me.mode}]`);
    } else {
      waitingQueue.push({
        socketId: socket.id, mode: me.mode, userId: me.userId, username: me.username,
        gender: me.gender, countryCode: me.countryCode,
        genderFilter: me.genderFilter, countryFilter: me.countryFilter
      });
      socket.emit('waiting');
      console.log(`⏳ Waiting: ${me.username} [${me.mode}] — queue: ${waitingQueue.length}`);
    }
    broadcastStats();
  });

  // ── WebRTC signaling (random chat) ──
  socket.on('webrtc-offer',  ({ offer })     => relay(socket.id, 'webrtc-offer',  { offer }));
  socket.on('webrtc-answer', ({ answer })    => relay(socket.id, 'webrtc-answer', { answer }));
  socket.on('webrtc-ice',    ({ candidate }) => relay(socket.id, 'webrtc-ice',    { candidate }));

  socket.on('chat-message', ({ text }) => {
    const me = onlineUsers.get(socket.id);
    const partnerId = activePairs.get(socket.id);
    if (!me || !partnerId || !text) return;
    io.to(partnerId).emit('chat-message', { text: String(text).substring(0, 500), from: me.username });
  });

  socket.on('skip', () => disconnectPair(socket.id, 'skip'));

  socket.on('report', ({ reason }) => {
    const me = onlineUsers.get(socket.id);
    const partnerId = activePairs.get(socket.id);
    console.log(`🚩 REPORT by ${me?.username} against socket ${partnerId}: ${reason}`);
    disconnectPair(socket.id, 'skip');
  });

  // ── PRIVATE CALLS (mutual-follow or premium gated) ──
  socket.on('private-call', async ({ targetUserId, callType }) => {
    const me = onlineUsers.get(socket.id);
    if (!me || !targetUserId) return;

    const meDoc = await User.findById(me.userId).catch(() => null);
    const mutual = await isMutual(me.userId, targetUserId).catch(() => false);
    if (!mutual && !(meDoc && meDoc.isPremium)) {
      socket.emit('call-rejected', { reason: 'premium_required', message: 'Private calls require Premium or a mutual follow.' });
      return;
    }

    const targetSocketId = userSockets.get(String(targetUserId));
    const targetSocket = targetSocketId && onlineUsers.get(targetSocketId);
    if (!targetSocketId || !targetSocket) {
      socket.emit('call-rejected', { reason: 'offline', message: 'This user is currently offline.' });
      return;
    }

    const roomId = crypto.randomBytes(12).toString('hex');
    callRooms.set(roomId, { callerSocketId: socket.id, targetSocketId, callType: callType === 'video' ? 'video' : 'audio' });

    socket.emit('call-ringing', { calleeName: targetSocket.username });
    io.to(targetSocketId).emit('incoming-call', {
      roomId, callType: callType === 'video' ? 'video' : 'audio',
      callerName: me.username, callerUserId: me.userId
    });
  });

  socket.on('call-answer', ({ roomId, accepted }) => {
    const room = callRooms.get(roomId);
    if (!room) return;

    if (accepted) {
      io.to(room.callerSocketId).emit('call-accepted', { roomId });
    } else {
      io.to(room.callerSocketId).emit('call-rejected', { reason: 'declined', message: 'Call declined.' });
      callRooms.delete(roomId);
    }
  });

  socket.on('priv-offer',  ({ roomId, offer })     => relayCall(roomId, socket.id, 'priv-offer',  { roomId, offer }));
  socket.on('priv-answer', ({ roomId, answer })    => relayCall(roomId, socket.id, 'priv-answer', { roomId, answer }));
  socket.on('priv-ice',    ({ roomId, candidate }) => relayCall(roomId, socket.id, 'priv-ice',    { roomId, candidate }));

  socket.on('call-end', ({ roomId }) => {
    const room = callRooms.get(roomId);
    if (!room) return;
    const otherSocketId = room.callerSocketId === socket.id ? room.targetSocketId : room.callerSocketId;
    io.to(otherSocketId).emit('call-ended');
    callRooms.delete(roomId);
  });

  // ── DMs (live, socket-based) ──
  socket.on('dm-send', async ({ conversationId, text }) => {
    const me = onlineUsers.get(socket.id);
    if (!me || !text || !conversationId) return;
    try {
      const convo = await Conversation.findById(conversationId);
      if (!convo || !convo.participants.map(String).includes(me.userId)) return;

      const trimmed = String(text).substring(0, 1000);
      const message = await Message.create({ conversationId, senderId: me.userId, text: trimmed });

      convo.lastMessage = trimmed;
      convo.lastAt = message.createdAt;
      const otherId = convo.participants.map(String).find(p => p !== me.userId);
      convo.unread.set(otherId, (convo.unread.get(otherId) || 0) + 1);
      await convo.save();

      const otherSocketId = userSockets.get(otherId);
      if (otherSocketId) {
        io.to(otherSocketId).emit('dm-message', {
          conversationId,
          message: { senderId: me.userId, text: trimmed, createdAt: message.createdAt }
        });
        io.to(otherSocketId).emit('dm-notify');
      }
    } catch (err) {
      console.error('dm-send error:', err);
    }
  });

  // ── DISCONNECT ──
  socket.on('disconnect', () => {
    disconnectPair(socket.id, 'disconnect');

    // Clean up any active call rooms involving this socket
    for (const [roomId, room] of callRooms) {
      if (room.callerSocketId === socket.id || room.targetSocketId === socket.id) {
        const otherSocketId = room.callerSocketId === socket.id ? room.targetSocketId : room.callerSocketId;
        io.to(otherSocketId).emit('call-ended');
        callRooms.delete(roomId);
      }
    }

    const me = onlineUsers.get(socket.id);
    if (me && userSockets.get(me.userId) === socket.id) userSockets.delete(me.userId);
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

  function relayCall(roomId, fromSocketId, event, data) {
    const room = callRooms.get(roomId);
    if (!room) return;
    const otherSocketId = room.callerSocketId === fromSocketId ? room.targetSocketId : room.callerSocketId;
    io.to(otherSocketId).emit(event, data);
  }

  function disconnectPair(socketId, reason) {
    const partnerId = activePairs.get(socketId);
    if (!partnerId) return;

    const me = onlineUsers.get(socketId);
    const partner = onlineUsers.get(partnerId);
    const startedAt = pairStart.get(socketId) || Date.now();
    const duration = Math.max(0, Math.round((Date.now() - startedAt) / 1000));

    activePairs.delete(socketId);
    activePairs.delete(partnerId);
    pairStart.delete(socketId);
    pairStart.delete(partnerId);

    if (me && partner) {
      MatchHistory.create({ userId: me.userId, partnerId: partner.userId, partnerName: partner.username, mode: me.mode, duration, matchedAt: new Date(startedAt) }).catch(() => {});
      MatchHistory.create({ userId: partner.userId, partnerId: me.userId, partnerName: me.username, mode: partner.mode, duration, matchedAt: new Date(startedAt) }).catch(() => {});
    }

    io.to(partnerId).emit('partner-left', { reason });
  }

  function broadcastStats() {
    io.emit('stats-update', { onlineUsers: onlineUsers.size, waitingUsers: waitingQueue.length });
  }
});

// ── START ─────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Server on port ${PORT}`));
