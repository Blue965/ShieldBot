// ============================================================
// ShieldBot — Discord AntiRaid Bot
// Requires: discord.js v14, node.js 18+
// Install:  npm install discord.js @discordjs/rest express
// ============================================================

const { Client, GatewayIntentBits, Partials, Events,
        PermissionFlagsBits, EmbedBuilder, Collection,
        REST, Routes } = require('discord.js');

// ==================== CONFIG ====================
const CONFIG = {
  TOKEN:         process.env.DISCORD_TOKEN    || 'YOUR_BOT_TOKEN_HERE',
  CLIENT_ID:     process.env.CLIENT_ID        || 'YOUR_CLIENT_ID_HERE',
  CLIENT_SECRET: process.env.CLIENT_SECRET    || 'YOUR_CLIENT_SECRET_HERE',
  REDIRECT_URI:  process.env.REDIRECT_URI     || 'http://localhost:3000/callback',

  RAID: {
    JOINS_PER_MINUTE:   10,
    ACCOUNT_AGE_MIN:    7,
    MAX_MENTIONS:       5,
    MAX_MSGS_PER_SEC:   3,
    MAX_CHAN_CREATED:   2,
  },

  COLORS: {
    DANGER:  0xef4444,
    WARNING: 0xf59e0b,
    SUCCESS: 0x10b981,
    INFO:    0x8b5cf6,
    RAID:    0xdc2626,
  }
};

// ==================== CLIENT ====================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildBans,
    GatewayIntentBits.GuildModeration,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.GuildMember]
});

// ==================== STORES ====================
const raidStore      = new Map(); // guildId -> { joinTimestamps, lockdown }
const spamStore      = new Map(); // userId  -> { messages: [], warnings: 0 }
const whitelistStore = new Map(); // guildId -> Set(userId)
const configStore    = new Map(); // guildId -> config override
const verifyStore    = new Map(); // userId  -> { code, guildId, expires }

// ==================== HELPERS ====================
function getGuildConfig(guildId) {
  return configStore.get(guildId) || { ...CONFIG.RAID };
}

function isWhitelisted(guildId, userId) {
  const wl = whitelistStore.get(guildId);
  return wl ? wl.has(userId) : false;
}

async function getLogChannel(guild) {
  return guild.channels.cache.find(c =>
    ['shieldbot-logs','mod-logs','logs'].includes(c.name) && c.isTextBased()
  );
}

async function sendLog(guild, embed) {
  const ch = await getLogChannel(guild);
  if (ch) ch.send({ embeds: [embed] }).catch(() => {});
}

function makeEmbed(color, title, description, fields = []) {
  const embed = new EmbedBuilder()
    .setColor(color).setTitle(title).setDescription(description).setTimestamp();
  if (fields.length) embed.addFields(fields);
  return embed;
}

function accountAgeDays(user) {
  return Math.floor((Date.now() - user.createdTimestamp) / 86400000);
}

function generateCode(len = 6) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: len }, () =>
    chars[Math.floor(Math.random() * chars.length)]
  ).join('');
}

// ==================== LOCKDOWN ====================
async function activateLockdown(guild, reason = 'Raid détecté') {
  const data = raidStore.get(guild.id) || {};
  if (data.lockdown) return;
  data.lockdown = true;
  data.lockdownSince = Date.now();
  raidStore.set(guild.id, data);

  let locked = 0;
  for (const ch of guild.channels.cache.values()) {
    if (!ch.isTextBased()) continue;
    try {
      await ch.permissionOverwrites.edit(guild.roles.everyone,
        { SendMessages: false, AddReactions: false });
      locked++;
    } catch {}
  }

  sendLog(guild, makeEmbed(CONFIG.COLORS.RAID,
    '🚨 LOCKDOWN ACTIVÉ',
    `**Raison :** ${reason}\n**Salons verrouillés :** ${locked}\n\nUtilisez \`/unlock\` pour lever le lockdown.`,
    [{ name: 'Auto-unlock', value: '5 minutes', inline: true }]
  ));

  setTimeout(() => deactivateLockdown(guild), 5 * 60 * 1000);
  console.log(`[LOCKDOWN] ${guild.name} — ${reason}`);
}

async function deactivateLockdown(guild) {
  const data = raidStore.get(guild.id) || {};
  data.lockdown = false;
  raidStore.set(guild.id, data);
  for (const ch of guild.channels.cache.values()) {
    if (!ch.isTextBased()) continue;
    try {
      await ch.permissionOverwrites.edit(guild.roles.everyone,
        { SendMessages: null, AddReactions: null });
    } catch {}
  }
  sendLog(guild, makeEmbed(CONFIG.COLORS.SUCCESS,
    '✅ Lockdown levé', 'Le serveur est de nouveau accessible.'));
}

// ==================== VERIFICATION ====================
async function sendVerification(member) {
  const code = generateCode();
  verifyStore.set(member.id, {
    code, guildId: member.guild.id,
    expires: Date.now() + 10 * 60 * 1000
  });

  const embed = makeEmbed(CONFIG.COLORS.INFO,
    `🛡️ Vérification — ${member.guild.name}`,
    `Bienvenue **${member.user.username}** !\n\nCode de vérification : \`${code}\`\n\nTapez \`/verify ${code}\` dans le salon de vérification.`,
    [
      { name: 'Expire dans', value: '10 minutes', inline: true },
      { name: 'Serveur', value: member.guild.name, inline: true }
    ]
  );

  try {
    await member.send({ embeds: [embed] });
  } catch {
    const ch = member.guild.channels.cache.find(c =>
      ['vérification','verification'].includes(c.name));
    if (ch) ch.send({ content: `<@${member.id}>`, embeds: [embed] });
  }
}

// ==================== PUNISH ====================
async function punish(member, reason, guild) {
  if (!member || isWhitelisted(guild.id, member.id)) return;
  const uid = member.id;
  const ud  = spamStore.get(uid) || { messages: [], warnings: 0 };
  ud.warnings++;
  spamStore.set(uid, ud);
  const w = ud.warnings;
  let actionTaken = '';

  try {
    if      (w === 1) { await member.send({ embeds: [makeEmbed(CONFIG.COLORS.WARNING, '⚠️ Avertissement', `**Raison :** ${reason}`)] }).catch(()=>{}); actionTaken = 'Avertissement'; }
    else if (w === 2) { await member.timeout(600000, `AutoMod: ${reason} (x${w})`);                  actionTaken = 'Timeout 10 min'; }
    else if (w === 3) { await member.kick(`AutoMod: ${reason} (x${w})`);                             actionTaken = 'Kick'; }
    else              { await guild.members.ban(member, { reason: `AutoMod: ${reason} (x${w})` });   actionTaken = 'Ban'; }
  } catch (e) { console.error('[PUNISH]', e.message); }

  sendLog(guild, makeEmbed(CONFIG.COLORS.DANGER,
    `🔨 AutoMod — ${actionTaken}`,
    `**Utilisateur :** ${member.user.tag} (${member.id})\n**Raison :** ${reason}\n**Infraction n°:** ${w}`
  ));
}

// ==================== EVENTS ====================

client.once(Events.ClientReady, () => {
  console.log(`✅ ShieldBot connecté : ${client.user.tag}`);
  client.user.setActivity('🛡️ Protection active', { type: 3 });
});

// MEMBER ADD
client.on(Events.GuildMemberAdd, async (member) => {
  const guild  = member.guild;
  const config = getGuildConfig(guild.id);
  if (isWhitelisted(guild.id, member.id)) return;

  // Compte trop récent → kick
  const ageDays = accountAgeDays(member.user);
  if (ageDays < config.ACCOUNT_AGE_MIN) {
    try { await member.kick(`Compte trop récent (${ageDays}j < ${config.ACCOUNT_AGE_MIN}j)`); } catch {}
    sendLog(guild, makeEmbed(CONFIG.COLORS.WARNING, '⚠️ Kick — Compte récent',
      `**User :** ${member.user.tag}\n**Âge :** ${ageDays} jours`));
    return;
  }

  // Compteur joins/min
  let data = raidStore.get(guild.id) || { joinTimestamps: [], lockdown: false };
  const now = Date.now();
  data.joinTimestamps = data.joinTimestamps.filter(t => now - t < 60000);
  data.joinTimestamps.push(now);
  raidStore.set(guild.id, data);

  if (data.joinTimestamps.length >= config.JOINS_PER_MINUTE && !data.lockdown) {
    await activateLockdown(guild, `${data.joinTimestamps.length} joins/min détectés`);
    return;
  }

  await sendVerification(member);
});

// MESSAGE CREATE
client.on(Events.MessageCreate, async (msg) => {
  if (msg.author.bot || !msg.guild) return;
  if (isWhitelisted(msg.guild.id, msg.author.id)) return;
  if (msg.member?.permissions.has(PermissionFlagsBits.ManageMessages)) return;

  const config = getGuildConfig(msg.guild.id);
  const uid    = msg.author.id;
  const now    = Date.now();

  // Spam
  let ud = spamStore.get(uid) || { messages: [], warnings: 0 };
  ud.messages = ud.messages.filter(t => now - t < 1000);
  ud.messages.push(now);
  spamStore.set(uid, ud);
  if (ud.messages.length >= config.MAX_MSGS_PER_SEC) {
    await msg.delete().catch(() => {});
    await punish(msg.member, 'spam de messages', msg.guild);
    return;
  }

  // Mentions en masse
  if (msg.mentions.users.size >= config.MAX_MENTIONS) {
    await msg.delete().catch(() => {});
    await punish(msg.member, 'mass-mentions', msg.guild);
    return;
  }

  // AntiLink
  const linkRx = /(discord\.(gg|io|me|li)|discordapp\.com\/invite)\/.+/i;
  if (linkRx.test(msg.content) && !msg.member?.permissions.has(PermissionFlagsBits.ManageGuild)) {
    await msg.delete().catch(() => {});
    await punish(msg.member, 'lien Discord non autorisé', msg.guild);
    return;
  }
});

// ==================== SLASH COMMANDS DEF ====================
const SLASH_COMMANDS = [
  { name:'verify',   description:'Vérifier votre compte', options:[{ name:'code', description:'Code reçu par DM', type:3, required:true }] },
  { name:'lockdown', description:'[Mod] Active le lockdown', defaultMemberPermissions: String(PermissionFlagsBits.ManageGuild) },
  { name:'unlock',   description:'[Mod] Lève le lockdown',   defaultMemberPermissions: String(PermissionFlagsBits.ManageGuild) },
  { name:'stats',    description:'Statistiques ShieldBot' },
  {
    name:'whitelist', description:'[Mod] Gérer la whitelist',
    defaultMemberPermissions: String(PermissionFlagsBits.ManageGuild),
    options:[
      { name:'action', description:'add ou remove', type:3, required:true, choices:[{ name:'Ajouter', value:'add' },{ name:'Retirer', value:'remove' }] },
      { name:'user',   description:'Utilisateur', type:6, required:true }
    ]
  },
  {
    name:'warn', description:'[Mod] Avertir un membre',
    defaultMemberPermissions: String(PermissionFlagsBits.ModerateMembers),
    options:[
      { name:'user',   description:'Membre', type:6, required:true },
      { name:'raison', description:'Raison', type:3, required:false }
    ]
  }
];

// ==================== SLASH HANDLER ====================
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const { commandName, guild, member, user } = interaction;

  if (commandName === 'verify') {
    const code   = interaction.options.getString('code').toUpperCase();
    const stored = verifyStore.get(user.id);
    if (!stored || stored.guildId !== guild.id)
      return interaction.reply({ content:'❌ Aucune vérification en attente.', ephemeral:true });
    if (Date.now() > stored.expires) {
      verifyStore.delete(user.id);
      return interaction.reply({ content:'❌ Code expiré. Rejoignez à nouveau.', ephemeral:true });
    }
    if (stored.code !== code)
      return interaction.reply({ content:'❌ Code incorrect.', ephemeral:true });

    verifyStore.delete(user.id);
    const role = guild.roles.cache.find(r => ['Membre vérifié','Verified','Member'].includes(r.name));
    if (role) await interaction.member.roles.add(role).catch(()=>{});
    return interaction.reply({ content:'✅ Vérification réussie ! Bienvenue !', ephemeral:true });
  }

  if (commandName === 'lockdown') {
    await activateLockdown(guild, `Lockdown manuel par ${user.tag}`);
    return interaction.reply({ content:'🔒 Lockdown activé.', ephemeral:true });
  }

  if (commandName === 'unlock') {
    await deactivateLockdown(guild);
    return interaction.reply({ content:'🔓 Lockdown levé.', ephemeral:true });
  }

  if (commandName === 'stats') {
    const data = raidStore.get(guild.id) || { joinTimestamps:[], lockdown:false };
    const cfg  = getGuildConfig(guild.id);
    return interaction.reply({ embeds:[makeEmbed(CONFIG.COLORS.INFO, '🛡️ Statistiques ShieldBot',
      `Serveur : **${guild.name}**`,
      [
        { name:'Lockdown',       value: data.lockdown ? '🔴 Actif' : '🟢 Inactif', inline:true },
        { name:'Joins/min',      value: String(data.joinTimestamps?.length||0),     inline:true },
        { name:'Whitelist',      value: String(whitelistStore.get(guild.id)?.size||0), inline:true },
        { name:'Seuil joins',    value: String(cfg.JOINS_PER_MINUTE),               inline:true },
        { name:'Âge min compte', value: cfg.ACCOUNT_AGE_MIN + 'j',                  inline:true },
        { name:'Max mentions',   value: String(cfg.MAX_MENTIONS),                    inline:true },
      ]
    )] });
  }

  if (commandName === 'whitelist') {
    const action = interaction.options.getString('action');
    const target = interaction.options.getUser('user');
    if (!whitelistStore.has(guild.id)) whitelistStore.set(guild.id, new Set());
    const wl = whitelistStore.get(guild.id);
    action === 'add' ? wl.add(target.id) : wl.delete(target.id);
    return interaction.reply({
      content: `✅ **${target.tag}** ${action==='add'?'ajouté à':'retiré de'} la whitelist.`,
      ephemeral: true
    });
  }

  if (commandName === 'warn') {
    const target = interaction.options.getUser('user');
    const raison = interaction.options.getString('raison') || 'Pas de raison';
    const tm = await guild.members.fetch(target.id).catch(()=>null);
    if (!tm) return interaction.reply({ content:'❌ Membre introuvable.', ephemeral:true });
    await punish(tm, raison, guild);
    return interaction.reply({ content:`⚠️ **${target.tag}** averti : ${raison}` });
  }
});

// ==================== REGISTER + START ====================
async function registerCommands() {
  const rest = new REST({ version:'10' }).setToken(CONFIG.TOKEN);
  try {
    await rest.put(Routes.applicationCommands(CONFIG.CLIENT_ID), { body: SLASH_COMMANDS });
    console.log('✅ Slash commands enregistrées.');
  } catch (e) { console.error('❌ Commands:', e); }
}

(async () => {
  await registerCommands();
  client.login(CONFIG.TOKEN);
})();
