// ============================================================
// ShieldBot — Serveur OAuth2 Discord (Express)
// Gère la connexion Discord du dashboard
// Install: npm install express axios express-session
// ============================================================

const express    = require('express');
const axios      = require('axios');
const session    = require('express-session');
const path       = require('path');

const app = express();

// ==================== CONFIG ====================
const CLIENT_ID     = process.env.CLIENT_ID     || 'YOUR_CLIENT_ID';
const CLIENT_SECRET = process.env.CLIENT_SECRET || 'YOUR_CLIENT_SECRET';
const REDIRECT_URI  = process.env.REDIRECT_URI  || 'http://localhost:3000/callback';
const PORT          = process.env.PORT          || 3000;

// ==================== MIDDLEWARE ====================
app.use(session({ secret: process.env.SESSION_SECRET || 'shieldbot-secret', resave: false, saveUninitialized: false }));
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// ==================== DISCORD OAUTH2 ====================

// 1. Redirect to Discord login
app.get('/login', (req, res) => {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: 'identify guilds guilds.members.read'
  });
  res.redirect(`https://discord.com/api/oauth2/authorize?${params}`);
});

// 2. OAuth2 callback
app.get('/callback', async (req, res) => {
  const code = req.query.code;
  if (!code) return res.redirect('/?error=no_code');

  try {
    // Exchange code for token
    const tokenRes = await axios.post('https://discord.com/api/oauth2/token', new URLSearchParams({
      client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
      grant_type: 'authorization_code', code,
      redirect_uri: REDIRECT_URI
    }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });

    const { access_token, token_type } = tokenRes.data;
    req.session.token = access_token;
    req.session.tokenType = token_type;

    // Get user info
    const userRes = await axios.get('https://discord.com/api/users/@me', {
      headers: { Authorization: `${token_type} ${access_token}` }
    });
    req.session.user = userRes.data;

    // Get user guilds
    const guildsRes = await axios.get('https://discord.com/api/users/@me/guilds', {
      headers: { Authorization: `${token_type} ${access_token}` }
    });
    // Only keep guilds where user has MANAGE_GUILD (value 0x20)
    req.session.guilds = guildsRes.data.filter(g => (BigInt(g.permissions) & BigInt(0x20)) !== BigInt(0));

    res.redirect('/dashboard');
  } catch (e) {
    console.error('[OAuth2 Error]', e.response?.data || e.message);
    res.redirect('/?error=oauth_failed');
  }
});

// 3. Logout
app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

// ==================== API ROUTES ====================

// Auth check
app.get('/api/me', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Not authenticated' });
  res.json({ user: req.session.user, guilds: req.session.guilds || [] });
});

// Get guild info
app.get('/api/guilds/:id', requireAuth, async (req, res) => {
  try {
    const r = await axios.get(`https://discord.com/api/guilds/${req.params.id}`, {
      headers: { Authorization: `Bot ${process.env.DISCORD_TOKEN}` }
    });
    res.json(r.data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Get guild members
app.get('/api/guilds/:id/members', requireAuth, async (req, res) => {
  try {
    const r = await axios.get(`https://discord.com/api/guilds/${req.params.id}/members?limit=100`, {
      headers: { Authorization: `Bot ${process.env.DISCORD_TOKEN}` }
    });
    res.json(r.data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Get guild channels
app.get('/api/guilds/:id/channels', requireAuth, async (req, res) => {
  try {
    const r = await axios.get(`https://discord.com/api/guilds/${req.params.id}/channels`, {
      headers: { Authorization: `Bot ${process.env.DISCORD_TOKEN}` }
    });
    res.json(r.data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Get guild roles
app.get('/api/guilds/:id/roles', requireAuth, async (req, res) => {
  try {
    const r = await axios.get(`https://discord.com/api/guilds/${req.params.id}/roles`, {
      headers: { Authorization: `Bot ${process.env.DISCORD_TOKEN}` }
    });
    res.json(r.data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Get audit log
app.get('/api/guilds/:id/audit-logs', requireAuth, async (req, res) => {
  try {
    const r = await axios.get(`https://discord.com/api/guilds/${req.params.id}/audit-logs?limit=50`, {
      headers: { Authorization: `Bot ${process.env.DISCORD_TOKEN}` }
    });
    res.json(r.data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Bot status
app.get('/api/bot/status', (req, res) => {
  res.json({ online: true, ping: 42, guilds: 0, uptime: process.uptime() });
});

// ==================== AUTH MIDDLEWARE ====================
function requireAuth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: 'Not authenticated' });
  next();
}

// ==================== SERVE PAGES ====================
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});
app.get('/dashboard', (req, res) => {
  if (!req.session.user) return res.redirect('/');
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ==================== START ====================
app.listen(PORT, () => {
  console.log(`🌐 Dashboard ShieldBot : http://localhost:${PORT}`);
  console.log(`🔗 Login Discord : http://localhost:${PORT}/login`);
});
