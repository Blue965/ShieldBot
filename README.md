# 🛡️ ShieldBot — Discord AntiRaid Bot

Dashboard complet + Bot Discord avec protection AntiRaid avancée.

---

## 📦 Installation

```bash
# 1. Installer les dépendances
npm install

# 2. Copier le fichier d'environnement
cp .env.example .env
# Puis remplir .env avec vos vraies valeurs
```

---

## ⚙️ Configuration (.env)

```env
DISCORD_TOKEN=your_bot_token_here
CLIENT_ID=your_client_id_here
CLIENT_SECRET=your_client_secret_here
REDIRECT_URI=http://localhost:3000/callback
SESSION_SECRET=un_secret_aleatoire_long
PORT=3000
```

---

## 🔑 Créer votre application Discord

1. Allez sur https://discord.com/developers/applications
2. **New Application** → nommez "ShieldBot"
3. Onglet **Bot** → **Reset Token** → copiez le token
4. Activez les **Privileged Gateway Intents** :
   - ✅ Server Members Intent
   - ✅ Message Content Intent
5. Onglet **OAuth2** → **General** :
   - Copiez le **Client ID** et **Client Secret**
   - Ajoutez Redirect URI : `http://localhost:3000/callback`
6. Onglet **OAuth2 → URL Generator** :
   - Scopes : `bot`, `applications.commands`
   - Bot Permissions : `Administrator` (ou permissions minimales)
   - Copiez l'URL et invitez le bot sur votre serveur

---

## 🚀 Lancer

```bash
# Bot Discord seulement
node bot.js

# Dashboard seulement  
node server.js

# Les deux en même temps
npm run dev
```

Accédez au dashboard : http://localhost:3000

---

## 🛡️ Fonctionnalités

### AntiRaid
- Détection joins/min anormaux → lockdown automatique
- Kick des comptes trop récents (configurable)
- Vérification par code envoyé en DM

### AutoMod
- AntiSpam (messages/seconde)
- AntiLink (liens Discord non autorisés)
- Anti mentions en masse
- Filtre mots bannis (regex supporté)

### Commandes Slash
| Commande | Description | Permission |
|----------|-------------|-----------|
| `/verify <code>` | Vérifier son compte | Tous |
| `/lockdown` | Activer le lockdown | Manage Guild |
| `/unlock` | Lever le lockdown | Manage Guild |
| `/stats` | Statistiques du bot | Tous |
| `/whitelist add/remove <user>` | Gérer la whitelist | Manage Guild |
| `/warn <user> [raison]` | Avertir un membre | Moderate Members |

### Dashboard
- Login Discord OAuth2
- Vue d'ensemble avec stats en temps réel
- Configuration AntiRaid (seuils, actions)
- AutoMod (filtres, mots bannis)
- Système de vérification
- Logs complets exportables
- Whitelist / Blacklist
- Paramètres et webhooks

---

## 📁 Structure des fichiers

```
shieldbot/
├── index.html    ← Dashboard frontend (HTML/CSS/JS)
├── bot.js        ← Bot Discord (discord.js v14)
├── server.js     ← Serveur OAuth2 Express
├── package.json  ← Dépendances
└── README.md     ← Ce fichier
```

---

## 🔧 Déploiement (Production)

**Railway / Render / VPS :**
```bash
# Variables d'environnement à configurer dans le panel
DISCORD_TOKEN=...
CLIENT_ID=...
CLIENT_SECRET=...
REDIRECT_URI=https://votre-domaine.com/callback
SESSION_SECRET=...
```

Changer le REDIRECT_URI dans Discord Developer Portal en conséquence.
