import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  delay
} from "@whiskeysockets/baileys";
import P from "pino";

// ===== CHANGE THIS =====
const PHONE_NUMBER = "9779700249860"; // apna number (no +)

// ===== LIMITS =====
const MAX_MESSAGES = 10;   // hard cap
const SEND_DELAY = 1200;   // ms (safe)

// ===== STATE =====
let OWNER_JID = null;
let collecting = false;
let messages = [];

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState("session");
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    auth: state,
    version,
    logger: P({ level: "silent" }),
    browser: ["SafeBot", "Chrome", "1.0"]
  });

  sock.ev.on("creds.update", saveCreds);

  // Pair code login
  if (!state.creds.registered) {
    const code = await sock.requestPairingCode(PHONE_NUMBER);
    console.log("🔑 PAIR CODE:", code);
  }

  sock.ev.on("connection.update", ({ connection, lastDisconnect }) => {
    if (connection === "open") console.log("✅ Connected");
    if (
      connection === "close" &&
      lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut
    ) startBot();
  });

  sock.ev.on("messages.upsert", async ({ messages: ms }) => {
    const m = ms[0];
    if (!m?.message || m.key.fromMe) return;

    const from = m.key.remoteJid;
    const sender = m.key.participant || from;
    const text =
      m.message.conversation ||
      m.message.extendedTextMessage?.text ||
      "";

    // Auto owner set
    if (!OWNER_JID) {
      OWNER_JID = sender;
      await sock.sendMessage(from, { text: "👑 Owner set" });
    }
    if (sender !== OWNER_JID) return;

    if (text === ".help") {
      return sock.sendMessage(from, {
        text:
          "📢 *Limited Broadcast Bot*\n\n" +
          ".setmsg → messages add (max 10)\n" +
          ".send   → send once\n" +
          ".help   → menu\n\n" +
          "⚠️ One-pass only (no loops)"
      });
    }

    if (text === ".setmsg") {
      collecting = true;
      messages = [];
      return sock.sendMessage(from, {
        text: `✍️ Messages bhejo (max ${MAX_MESSAGES}).\n.done likho jab khatam`
      });
    }

    if (collecting && text !== ".done") {
      if (messages.length >= MAX_MESSAGES) {
        return sock.sendMessage(from, {
          text: `❌ Limit reached (${MAX_MESSAGES})`
        });
      }
      messages.push(text);
      return;
    }

    if (collecting && text === ".done") {
      collecting = false;
      return sock.sendMessage(from, {
        text: `✅ Saved ${messages.length} messages`
      });
    }

    if (text === ".send") {
      if (!messages.length) {
        return sock.sendMessage(from, { text: "❌ No messages set" });
      }
      await sock.sendMessage(from, { text: "▶️ Sending..." });
      for (const msg of messages) {
        await sock.sendMessage(from, { text: msg });
        await delay(SEND_DELAY);
      }
      await sock.sendMessage(from, { text: "✅ Done (one pass)" });
    }
  });
}

startBot();
