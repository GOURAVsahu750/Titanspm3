import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  delay,
  fetchLatestBaileysVersion
} from "@whiskeysockets/baileys";
import P from "pino";
import readline from "readline"; // kept (not used)

// ===== EDIT THIS ONLY =====
const PHONE_NUMBER = "9779700249860"; // apna number, no +

// ===== SETTINGS =====
const MSG_DELAY = 400;
const GC_DELAY = 5000;

// ===== STATES =====
let OWNER_JID = null;
let collectingSpam = false;
let collectingGC = false;
let spamRunning = false;
let gcRunning = false;

let spamMessages = [];
let gcNames = [];

// readline kept to respect "remove mat karo"
readline.createInterface({
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
    if (!PHONE_NUMBER || PHONE_NUMBER.includes("X")) {
      console.log("❌ PHONE_NUMBER set nahi hai");
      return;
    }
    const code = await sock.requestPairingCode(PHONE_NUMBER);
    console.log("🔑 PAIR CODE:", code);
  }

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect } = update;

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
    if (!m || !m.message || m.key.fromMe) return;

    const from = m.key.remoteJid;
    const sender = m.key.participant || from;

    // ===== OWNER AUTO SET =====
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
      await sock.sendMessage(from, {
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
      return;
    }

    // ===== SET SPAM =====
    if (text === ".setspam") {
      collectingSpam = true;
      spamMessages = [];
      await sock.sendMessage(from, {
        text: "✍️ Messages bhejo, .done likho jab khatam"
      });
      return;
    }

    if (collectingSpam && text !== ".done") {
      spamMessages.push(text);
      return;
    }

    if (collectingSpam && text === ".done") {
      collectingSpam = false;
      await sock.sendMessage(from, {
        text: `✅ ${spamMessages.length} messages saved`
      });
      return;
    }

    // ===== START SPAM =====
    if (text === ".start") {
      if (!spamMessages.length || spamRunning) return;
      spamRunning = true;

      while (spamRunning) {
        for (const msg of spamMessages) {
          if (!spamRunning) break;
          await sock.sendMessage(from, { text: msg });
          await delay(MSG_DELAY);
        }
      }
      return;
    }

    if (text === ".stop") {
      spamRunning = false;
      return;
    }

    // ===== SET GC =====
    if (text === ".setgc") {
      collectingGC = true;
      gcNames = [];
      await sock.sendMessage(from, {
        text: "✍️ GC names bhejo, .done likho"
      });
      return;
    }

    if (collectingGC && text !== ".done") {
      gcNames.push(text);
      return;
    }

    if (collectingGC && text === ".done") {
      collectingGC = false;
      return;
    }

    // ===== START GC NAME CHANGER =====
    if (text === ".gcstart") {
      if (!from.endsWith("@g.us") || !gcNames.length || gcRunning) return;
      gcRunning = true;

      let i = 0;
      while (gcRunning) {
        try {
          await sock.groupUpdateSubject(
            from,
            gcNames[i % gcNames.length]
          );
        } catch {}
        i++;
        await delay(GC_DELAY);
      }
      return;
    }

    if (text === ".gcstop") {
      gcRunning = false;
      return;
    }
  });
}

startBot();
