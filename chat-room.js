const CHAT_SERVER = "https://kittycrypto.ddns.net:7619/chat";
const CHAT_STREAM_URL = "https://kittycrypto.ddns.net:7619/chat/stream";
const SESSION_TOKEN_URL = "https://kittycrypto.ddns.net:7619/session-token";

const chatroom = document.getElementById("chatroom");
const nicknameInput = document.getElementById("nickname");
const messageInput = document.getElementById("message");
const sendButton = document.getElementById("send-button");

let sessionToken = null;
let eventSource = null; // Track SSE connection
let alerted = false;

// Utility: Get Cookie
const getChatCookie = (name) => {
  const match = document.cookie.match(new RegExp("(^| )" + name + "=([^;]+)"));
  return match ? decodeURIComponent(match[2]) : null;
};

// Utility: Set Cookie (expires in 1 year) 
const setChatCookie = (name, value, days = 365) => {
  const date = new Date();
  date.setTime(date.getTime() + days * 24 * 60 * 60 * 1000);
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${date.toUTCString()}; path=/; SameSite=Lax`;
};

// Load Nickname from Cookie 
const loadNickname = () => {
  const savedNick = getChatCookie("nickname");
  if (savedNick) {
    nicknameInput.value = savedNick;
  }
};

// Fetch Session Token 
const fetchSessionToken = async () => {
  try {
    const response = await fetch(SESSION_TOKEN_URL);
    if (!response.ok) throw new Error(`Failed to fetch session token: ${response.status}`);

    const data = await response.json();
    sessionToken = data.sessionToken;
    console.log("🔑 Session Token received:", sessionToken);

    // Connect to SSE once session token is received
    connectToChatStream();
  } catch (error) {
    console.error("❌ Error fetching session token:", error);
  }
};

// Seeded PRNG (Mulberry32) 
function seededRandom(seed) {
  let t = seed += 0x6D2B79F5;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296; // Scales to [0, 1)
}

// Connect to SSE for Real-Time Chat Updates 
const connectToChatStream = () => {
  if (!sessionToken) return;

  if (eventSource) {
    console.log("⚠️ SSE connection already exists, closing old connection...");
    eventSource.close();
  }

  console.log("🔄 Attempting to connect to chat stream...");

  // Use query parameter for token since EventSource does not support headers
  eventSource = new EventSource(`${CHAT_STREAM_URL}?token=${sessionToken}`);

  eventSource.onopen = () => {
    console.log("✅ Successfully connected to chat stream.");
  };

  eventSource.onmessage = (event) => {
    try {
      const parsedData = JSON.parse(event.data);
      console.log("📩 Raw SSE Data:", parsedData); // Logs as an object (collapsible)
    } catch (error) {
      console.error("❌ Error parsing chat update:", error, "\n📩 Raw data received:", event.data);
    }


    try {
      const messages = JSON.parse(event.data);
      displayChat(messages);
    } catch (error) {
      console.error("❌ Error parsing chat update:", error, "\n📩 Raw data received:", event.data);
    }
  };

  eventSource.onerror = () => {
    console.error("❌ Connection to chat stream lost. Retrying...");
    eventSource.close();
    setTimeout(connectToChatStream, 3000); // Retry after 3s
  };
};

// Generates a Unique Seed for Each User 
async function hashUser(nick, id) {
  const encoder = new TextEncoder();
  const data = encoder.encode(nick + id);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.slice(0, 4).reduce((acc, val) => (acc << 8) + val, 0);
}

// Generates a Consistent Colour 
async function getColourForUser(nick, id) {
  const seed = await hashUser(nick, id);
  const rng = seededRandom(seed);

  const hue = Math.floor(rng * 360);
  const saturation = Math.floor(50 + rng * 30);
  const lightness = Math.floor(40 + rng * 30);

  return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
}

const fetchUserIP = async () => {
  try {
    const response = await fetch("https://kittycrypto.ddns.net:7619/get-ip");
    if (!response.ok) throw new Error(`Failed to fetch IP: ${response.status}`);

    const data = await response.json();
    console.log(`🌍 User IP: ${data.ip}`);
    return data.ip;
  } catch (error) {
    console.error("❌ Error fetching IP:", error);
    return null;
  }
};

// Sends a chat message 
const sendMessage = async () => {
  const nick = nicknameInput.value.trim();
  const msg = messageInput.value.trim();

  if (!nick || !msg) {
    alert("Please enter a nickname and a message.");
    return;
  }

  setChatCookie("nickname", nick);

  console.log("📡 Fetching IP address...");
  const userIp = await fetchUserIP();
  if (!userIp) {
    alert("❌ Unable to retrieve IP. Please try again.");
    return;
  }

  // Create a unique temporary ID for the pending message
  const tempId = `pending-${Date.now()}`;

  // Inject the pending message into the chatroom
  const pendingMessage = {
    nick,
    id: tempId,
    msg,
    timestamp: new Date().toISOString(),
    pending: true,
  };

  displayChat([pendingMessage], true); // Display it as pending

  const chatRequest = {
    chatRequest: {
      nick,
      msg,
      ip: userIp
    }
  };

  console.log("📡 Sending chat message:", chatRequest);

  try {
    const response = await fetch(CHAT_SERVER, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(chatRequest)
    });

    if (!response.ok) {
      throw new Error(`Server error: ${response.status} ${response.statusText}`);
    }

    console.log("✅ Message sent successfully.");
    messageInput.value = "";

  } catch (error) {
    console.error("❌ Error sending message:", error);
    alert(`Failed to send message: ${error.message}`);

    // Remove the pending message on failure
    removePendingMessage(tempId);
  }
};

// Displays Chat Messages 
const displayChat = async (messages, isLocalUpdate = false) => {
  if (!isLocalUpdate) {
    // Remove all pending messages if we are updating from the server
    document.querySelectorAll(".chat-message.pending").forEach(el => el.remove());
  }

  messages.forEach(({ nick, id, msg, timestamp, pending }) => {
    const colour = `hsl(${parseInt(id, 16) % 360}, 61%, 51%)`;
    const formattedDate = timestamp.replace("T", " ").slice(0, 19).replace(/-/g, ".");

    const messageDiv = document.createElement("div");
    messageDiv.classList.add("chat-message");
    if (pending) messageDiv.classList.add("pending"); // Add pending style

    const headerSpan = document.createElement("span");
    headerSpan.classList.add("chat-nick");
    headerSpan.style.color = colour;
    headerSpan.innerHTML = `${nick} - (${id}):`;

    const timestampSpan = document.createElement("span");
    timestampSpan.classList.add("chat-timestamp");
    timestampSpan.textContent = formattedDate;

    const textDiv = document.createElement("div");
    textDiv.classList.add("chat-text");
    textDiv.textContent = msg;

    messageDiv.appendChild(headerSpan);
    messageDiv.appendChild(timestampSpan);
    messageDiv.appendChild(textDiv);

    // Add a loading indicator for pending messages
    if (pending) {
      const pendingIndicator = document.createElement("span");
      pendingIndicator.classList.add("pending-indicator");
      pendingIndicator.innerHTML = "⏳ Moderating...";
      messageDiv.appendChild(pendingIndicator);
    }

    chatroom.appendChild(messageDiv);
  });

  chatroom.scrollTop = chatroom.scrollHeight;
};

// Remove pending message on failure
const removePendingMessage = (tempId) => {
  const pendingMessage = document.querySelector(`.chat-message[data-id="${tempId}"]`);
  if (pendingMessage) pendingMessage.remove();
};

// Attach Event Listeners 
sendButton.addEventListener("click", sendMessage);
messageInput.addEventListener("keypress", (e) => {
  if (e.key === "Enter") sendMessage();
});

// Load nickname on startup 
loadNickname();
fetchSessionToken();