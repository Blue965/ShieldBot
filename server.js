// ============================================================
// ShieldBot — server.js COMPLET
// Sert le dashboard ET gère l'OAuth2 Discord + API réelles
// npm install express express-session axios
// node server.js
// ============================================================

const express = require('express');
const session = require('express-session');
const axios   = require('axios');
const path    = require('path');
const fs      = require('fs');

const PORT = process.env.PORT || 3000;
const app = express();
const PORT          = process.env.PORT          || 3000;
const CLIENT_ID     = process.env.CLIENT_ID     || 'TON_CLIENT_ID';
const CLIENT_SECRET = process.env.CLIENT_SECRET || 'TON_CLIENT_SECRET';
const REDIRECT_URI  = process.env.REDIRECT_URI  || `http://localhost:${PORT}/callback`;
const BOT_TOKEN     = process.env.DISCORD_TOKEN || 'TON_BOT_TOKEN';
const SESSION_SECRET= process.env.SESSION_SECRET|| 'shieldbot-super-secret-2024';

// ---- Simple JSON store ----
const DATA_FILE = path.join(__dirname, 'shieldbot_data.json');
function readData() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE,'utf8')); }
  catch { return { configs:{}, logs:{}, whitelist:{} }; }
}
function writeData(d) { fs.writeFileSync(DATA_FILE, JSON.stringify(d,null,2)); }

// ---- Middleware ----
app.use(session({ secret:SESSION_SECRET, resave:false, saveUninitialized:false, cookie:{maxAge:86400000} }));
app.use(express.json());

const DAPI = 'https://discord.com/api/v10';
async function botReq(p) {
  const r = await axios.get(DAPI+p, { headers:{ Authorization:`Bot ${BOT_TOKEN}` } });
  return r.data;
}
function requireAuth(req,res,next) {
  if (!req.session.user) return res.status(401).json({ error:'Non authentifié' });
  next();
}
function hasGuild(req,gid) {
  return (req.session.guilds||[]).find(g=>g.id===gid);
}

// ==================== OAUTH2 ====================
app.get('/login',(req,res)=>{
  const p = new URLSearchParams({ client_id:CLIENT_ID, redirect_uri:REDIRECT_URI,
    response_type:'code', scope:'identify guilds', prompt:'none' });
  res.redirect(`https://discord.com/api/oauth2/authorize?${p}`);
});

app.get('/callback', async (req,res)=>{
  const {code,error} = req.query;
  if (error||!code) return res.redirect('/?error='+(error||'no_code'));
  try {
    const tok = await axios.post('https://discord.com/api/oauth2/token',
      new URLSearchParams({ client_id:CLIENT_ID, client_secret:CLIENT_SECRET,
        grant_type:'authorization_code', code, redirect_uri:REDIRECT_URI }),
      { headers:{'Content-Type':'application/x-www-form-urlencoded'} });
    const {access_token,token_type,expires_in} = tok.data;
    req.session.accessToken = access_token;
    req.session.tokenType   = token_type;
    req.session.tokenExpires= Date.now()+expires_in*1000;

    const [user,guilds] = await Promise.all([
      axios.get(DAPI+'/users/@me',{headers:{Authorization:`${token_type} ${access_token}`}}).then(r=>r.data),
      axios.get(DAPI+'/users/@me/guilds',{headers:{Authorization:`${token_type} ${access_token}`}}).then(r=>r.data),
    ]);
    req.session.user   = user;
    req.session.guilds = guilds.filter(g=>(BigInt(g.permissions||0)&BigInt(0x20))!==BigInt(0));
    res.redirect('/dashboard');
  } catch(e) {
    console.error('[OAuth]',e.response?.data||e.message);
    res.redirect('/?error=oauth_failed');
  }
});

app.get('/logout',(req,res)=>{ req.session.destroy(()=>res.redirect('/')); });

// ==================== API ====================
app.get('/api/me', requireAuth, (req,res)=>
  res.json({ user:req.session.user, guilds:req.session.guilds||[], expires:req.session.tokenExpires }));

app.get('/api/guild/:id', requireAuth, async (req,res)=>{
  if (!hasGuild(req,req.params.id)) return res.status(403).json({error:'Accès refusé'});
  try { res.json(await botReq(`/guilds/${req.params.id}?with_counts=true`)); }
  catch(e){ res.status(e.response?.status||500).json({error:e.response?.data?.message||e.message}); }
});

app.get('/api/guild/:id/members', requireAuth, async (req,res)=>{
  if (!hasGuild(req,req.params.id)) return res.status(403).json({error:'Accès refusé'});
  try {
    const limit = Math.min(parseInt(req.query.limit)||100,1000);
    res.json(await botReq(`/guilds/${req.params.id}/members?limit=${limit}`));
  } catch(e){ res.status(e.response?.status||500).json({error:e.message}); }
});

app.get('/api/guild/:id/channels', requireAuth, async (req,res)=>{
  if (!hasGuild(req,req.params.id)) return res.status(403).json({error:'Accès refusé'});
  try { res.json(await botReq(`/guilds/${req.params.id}/channels`)); }
  catch(e){ res.status(e.response?.status||500).json({error:e.message}); }
});

app.get('/api/guild/:id/roles', requireAuth, async (req,res)=>{
  if (!hasGuild(req,req.params.id)) return res.status(403).json({error:'Accès refusé'});
  try { res.json(await botReq(`/guilds/${req.params.id}/roles`)); }
  catch(e){ res.status(e.response?.status||500).json({error:e.message}); }
});

app.get('/api/guild/:id/bans', requireAuth, async (req,res)=>{
  if (!hasGuild(req,req.params.id)) return res.status(403).json({error:'Accès refusé'});
  try { res.json(await botReq(`/guilds/${req.params.id}/bans?limit=100`)); }
  catch(e){ res.status(e.response?.status||500).json({error:e.message}); }
});

app.get('/api/guild/:id/audit-logs', requireAuth, async (req,res)=>{
  if (!hasGuild(req,req.params.id)) return res.status(403).json({error:'Accès refusé'});
  try { res.json(await botReq(`/guilds/${req.params.id}/audit-logs?limit=50`)); }
  catch(e){ res.status(e.response?.status||500).json({error:e.message}); }
});

// Config
app.get('/api/guild/:id/config', requireAuth, (req,res)=>{
  const d = readData();
  res.json(d.configs[req.params.id] || {
    antiraid:{enabled:true,joinsPerMin:10,accountAgeDays:7,maxMentions:5,msgsPerSec:3,
      lockdown:true,banRaiders:true,notifyAdmin:true,alertChannel:'',protectionLevel:'std'},
    automod:{antiSpam:true,antiLink:true,antiMassMention:true,wordFilter:false,emojiSpam:true,
      bannedWords:['spam','raid'],action1:'warn',action2:'timeout',action3:'ban'},
    verification:{method:'captcha',verifiedRole:'',verifyChannel:'',kickAfterMin:10,minAccountAge:7},
    logs:{webhookUrl:'',dmOnRaid:true,weeklyReport:true},
  });
});
app.post('/api/guild/:id/config', requireAuth, (req,res)=>{
  if (!hasGuild(req,req.params.id)) return res.status(403).json({error:'Accès refusé'});
  const d=readData(); d.configs[req.params.id]=req.body; writeData(d);
  res.json({success:true});
});

// ShieldBot logs (written by bot.js via POST)
app.get('/api/guild/:id/shieldlogs', requireAuth, (req,res)=>{
  const d=readData(); res.json(d.logs[req.params.id]||[]);
});
app.post('/api/guild/:id/shieldlogs', (req,res)=>{
  const d=readData();
  if (!d.logs[req.params.id]) d.logs[req.params.id]=[];
  d.logs[req.params.id].unshift({...req.body,timestamp:Date.now()});
  if (d.logs[req.params.id].length>500) d.logs[req.params.id]=d.logs[req.params.id].slice(0,500);
  writeData(d); res.json({success:true});
});

// Whitelist
app.get('/api/guild/:id/whitelist', requireAuth, (req,res)=>{
  const d=readData(); res.json(d.whitelist[req.params.id]||[]);
});
app.post('/api/guild/:id/whitelist', requireAuth, (req,res)=>{
  if (!hasGuild(req,req.params.id)) return res.status(403).json({error:'Accès refusé'});
  const d=readData(); d.whitelist[req.params.id]=req.body.list||[]; writeData(d);
  res.json({success:true});
});

// ---- Serve HTML ----
const HTML = path.join(__dirname,'dashboard.html');
app.get('/',(req,res)=>res.sendFile(HTML));
app.get('/dashboard',(req,res)=>{
  if (!req.session.user) return res.redirect('/');
  res.sendFile(HTML);
});

app.listen(PORT,()=>{
  console.log(`\n🛡️  ShieldBot Dashboard → http://localhost:${PORT}`);
  console.log(`🔑  Login Discord    → http://localhost:${PORT}/login\n`);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Serveur sur port ${PORT}`);
});