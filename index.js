import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  delay,
  fetchLatestBaileysVersion
} from "@whiskeysockets/baileys";
import P from "pino";
import readline from "readline";

const MSG_DELAY = 400;   // message delay (safe)
const GC_DELAY  = 5000;  // GC name delay (safe)

// ===== RUNTIME STATES =====
let OWNER_JID = null;        // auto detect
let collectingSpam = false;
let collectingGC   = false;
let spamRunning    = false;
let gcRunning      = false;

let spamMessages = [];
let gcNames = [];

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState("session");
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    logger: P({ level: "silent" }),
    auth: state,
    version,
    browser: ["TitanBot", "Chrome", "1.0"]
  });

  sock.ev.on("creds.update", saveCreds);

  // ===== PAIR CODE LOGIN =====
  if (!state.creds.registered) {
    rl.question("📱 Enter phone number (91XXXXXXXXXX): ", async (num) => {
      const code = await sock.requestPairingCode(num.trim());
      console.log("🔑 PAIR CODE:", code);
    });
  }

  sock.ev.on("connection.update", ({ connection, lastDisconnect }) => {
    if (connection === "open") {
      console.log("✅ Bot Connected");
    }
    if (connection === "close") {
      const shouldReconnect =
        lastDisconnect?.error?.output?.statusCode !==
        DisconnectReason.loggedOut;
      if (shouldReconnect) startBot();
    }
  });

  sock.ev.on("messages.upsert", async ({ messages }) => {
    const m = messages[0];
    if (!m.message || m.key.fromMe) return;

    const from = m.key.remoteJid;
    const sender = m.key.participant || from;

    // ===== AUTO OWNER (first message wins) =====
    if (!OWNER_JID) {
      OWNER_JID = sender;
      console.log("👑 OWNER SET:", OWNER_JID);
      await sock.sendMessage(from, {
        text: "✅ You are now the OWNER"
      });
    }

    // ===== OWNER ONLY =====
    if (sender !== OWNER_JID) return;

    const text =
      m.message.conversation ||
      m.message.extendedTextMessage?.text ||
      "";

    /* ===== HELP COMMAND ===== */
    if (text === ".help") {
      return sock.sendMessage(from, {
        text:
          "🤖 *Titan Bot – Commands*\n\n" +
          "*Spam Messages*\n" +
          "• .setspam  → Messages set karo\n" +
          "• .start    → Spam start\n" +
          "• .stop     → Spam stop\n\n" +
          "*Group Name Changer*\n" +
          "• .setgc    → GC names set karo\n" +
          "• .gcstart  → GC name change start\n" +
          "• .gcstop   → GC name change stop\n\n" +
          "*Info*\n" +
          "• .help     → Commands list\n\n" +
          "👑 Owner-only bot"
      });
    }

    /* ===== SET SPAM MESSAGES ===== */
    if (text === ".setspam") {
      collectingSpam = true;
      spamMessages = [];
      return sock.sendMessage(from, {
        text: "✍️ Send your messages one by one.\nType .done when finished."
      });
    }

    if (collectingSpam && text !== ".done") {
      spamMessages.push(text);
      return;
    }

    if (collectingSpam && text === ".done") {
      collectingSpam = false;
      return sock.sendMessage(from, {
        text: `✅ Saved ${spamMessages.length} messages.\nUse .start`
      });
    }

    /* ===== START / STOP SPAM ===== */
    if (text === ".start") {
      if (!spamMessages.length) {
        return sock.sendMessage(from, { text: "❌ No messages set" });
      }
      if (spamRunning) {
        return sock.sendMessage(from, { text: "⚠️ Already running" });
      }

      spamRunning = true;
      sock.sendMessage(from, { text: "▶️ Spam started" });

      while (spamRunning) {
        for (const msg of spamMessages) {
          if (!spamRunning) break;
          await sock.sendPresenceUpdate("composing", from);
          await delay(700);
          await sock.sendMessage(from, { text: msg });
          await delay(MSG_DELAY);
        }
      }
    }

    if (text === ".stop") {
      spamRunning = false;
      return sock.sendMessage(from, { text: "⏹️ Spam stopped" });
    }

    /* ===== SET GC NAMES ===== */
    if (text === ".setgc") {
      collectingGC = true;
      gcNames = [];
      return sock.sendMessage(from, {
        text: "✍️ Send GC names one by one.\nType .done when finished."
      });
    }

    if (collectingGC && text !== ".done") {
      gcNames.push(text);
      return;
    }

    if (collectingGC && text === ".done") {
      collectingGC = false;
      return sock.sendMessage(from, {
        text: `✅ Saved ${gcNames.length} GC names.\nUse .gcstart`
      });
    }

    /* ===== START / STOP GC NAME CHANGER ===== */
    if (text === ".gcstart") {
      if (!from.endsWith("@g.us")) {
        return sock.sendMessage(from, { text: "❌ Group only command" });
      }
      if (!gcNames.length) {
        return sock.sendMessage(from, { text: "❌ No GC names set" });
      }
      if (gcRunning) {
        return sock.sendMessage(from, { text: "⚠️ GC changer already running" });
      }

      gcRunning = true;
      sock.sendMessage(from, { text: "🔄 GC name changer started" });

      let i = 0;
      while (gcRunning) {
        try {
          await sock.groupUpdateSubject(from, gcNames[i % gcNames.length]);
        } catch {}
        i++;
        await delay(GC_DELAY);
      }
    }

    if (text === ".gcstop") {
      gcRunning = false;
      return sock.sendMessage(from, { text: "🛑 GC changer stopped" });
    }
  });
}

startBot();
