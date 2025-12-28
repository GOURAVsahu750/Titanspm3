import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  delay,
  fetchLatestBaileysVersion
} from "@whiskeysockets/baileys";
import P from "pino";
import readline from "readline"; // kept, NOT removed

// ====== CHANGE ONLY THIS ======
const PHONE_NUMBER = "9779700249860"; // ← apna number yahan dalo (no +)

// ====== SETTINGS ======
const MSG_DELAY = 400;
const GC_DELAY  = 5000;

// ====== STATES ======
let OWNER_JID = null;
let collectingSpam = false;
let collectingGC = false;
let spamRunning = false;
let gcRunning = false;

let spamMessages = [];
let gcNames = [];

// readline interface kept but NOT used (Railway-safe)
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

  // ===== PAIR CODE LOGIN (NO ENV, NO READLINE) =====
  if (!state.creds.registered) {
    if (!PHONE_NUMBER || PHONE_NUMBER.includes("X")) {
      console.log("❌ PHONE_NUMBER set nahi hai");
      return;
    }
    const code = await sock.requestPairingCode(PHONE_NUMBER);
    console.log("🔑 PAIR CODE:", code);
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

    // ===== AUTO OWNER =====
    if (!OWNER_JID) {
      OWNER_JID = sender;
      await sock.sendMessage(from, { text: "👑 You are OWNER now" });
    }

    if (sender !== OWNER_JID) return;

    const text =
      m.message.conversation ||
      m.message.extendedTextMessage?.text ||
      "";

    // ===== HELP =====
    if (text === ".help") {
      return sock.sendMessage(from, {
        text:
          "🤖 *Titan Bot – Commands*\n\n" +
          "*Spam*\n" +
          ".setspam → messages set\n" +
          ".start → spam start\n" +
          ".stop → spam stop\n\n" +
          "*GC Name Changer*\n" +
          ".setgc → names set\n" +
          ".gcstart → start\n" +
          ".gcstop → stop\n\n" +
          "👑 Owner only"
      });
    }

    // ===== SPAM SET =====
    if (text === ".setspam") {
      collectingSpam = true;
      spamMessages = [];
      return sock.sendMessage(from, {
        text: "✍️ Messages bhejo, .done likho jab khatam"
      });
    }

    if (collectingSpam && text !== ".done") {
      spamMessages.push(text);
      return;
    }

    if (collectingSpam && text === ".done") {
      collectingSpam = false;
      return sock.sendMessage(from, {
        text: `✅ ${spamMessages.length} messages saved`
      });
    }

    // ===== SPAM START / STOP =====
    if (text === ".start") {
      if (!spamMessages.length) return;
      if (spamRunning) return;

      spamRunning = true;
      while (spamRunning) {
        for (const msg of spamMessages) {
          if (!spamRunning) break;
          await sock.sendMessage(from, { text: msg });
          await delay(MSG_DELAY);
        }
      }
    }

    if (text === ".stop") {
      spamRunning = false;
      return;
    }

    // ===== GC SET =====
    if (text === ".setgc") {
      collectingGC = true;
      gcNames = [];
      return sock.sendMessage(from, {
        text: "✍️ GC names bhejo, .done likho"
      });
    }

    if (collectingGC && text !== ".done") {
      gcNames.push(text);
      return;
    }

    if (collectingGC && text === ".done") {
      collectingGC = false;
      return;
    }

    // ===== GC START / STOP =====
    if (text === ".gcstart") {
      if (!from.endsWith("@g.us")) return;
      if (!gcNames.length) return;
      if (gcRunning) return;

      gcRunning = true;
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
      return;
    }
  });
}

startBot();
