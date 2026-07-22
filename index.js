require('dotenv').config();

const pool = require('./db');
const { parseLedgerEntry } = require('./parser');
const axios = require('axios');
const express = require('express');
const app = express();
app.use(express.json());

// Meta's one-time webhook verification handshake
app.get('/webhook', (req, res) => {
  console.log('=== Incoming webhook ===');
  console.log(JSON.stringify(req.body, null, 2));
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === process.env.WEBHOOK_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

// Actual incoming messages land here
// app.post('/webhook', (req, res) => {
//   console.log(JSON.stringify(req.body, null, 2)); // just log for now — Step 11 makes this real
//   res.sendStatus(200);
// });





// async function sendWhatsAppMessage(to, body) {
//   await axios.post(
//     `https://graph.facebook.com/v20.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
//     { messaging_product: 'whatsapp', to, text: { body } },
//     { headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` } }
//   );
// }
async function sendWhatsAppMessage(to, body) {
  try {
    const response = await axios.post(
      `https://graph.facebook.com/v20.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: 'whatsapp',
        to,
        text: { body }
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );

    console.log("WhatsApp sent:", response.data);

  } catch (err) {
    console.log("WhatsApp API error:");
    console.log(JSON.stringify(err.response?.data, null, 2));
  }
}

async function getOrCreateVendor(phone) {
  const existing = await pool.query('SELECT id FROM vendors WHERE phone_number = $1', [phone]);
  if (existing.rows.length) return existing.rows[0].id;
  const inserted = await pool.query(
    `INSERT INTO vendors (phone_number, name, onboarded_via) VALUES ($1, $2, 'whatsapp') RETURNING id`,
    [phone, phone] // name defaults to phone number until vendor sets one — fine for Phase 1 testing
  );
  return inserted.rows[0].id;

}

app.get("/", async (req, res) => {
  res.send("Mkoba API is running");
});


app.post('/webhook', async (req, res) => {
  console.log("Called");
  res.sendStatus(200); // ack immediately — do the work after
  const msg = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  if (!msg || msg.type !== 'text') return;

  const phone = msg.from;
  const text = msg.text.body;

  await pool.query(
    `INSERT INTO messages_log (phone_number, channel, direction, raw_payload)
     VALUES ($1, 'whatsapp', 'inbound', $2)`,
    [phone, JSON.stringify(msg)]
  );

  const parsed = parseLedgerEntry(text);

  if (parsed.confidence < 0.6) {
    await sendWhatsAppMessage(phone, "Samahani, sikuelewa vizuri. Ulitumia/uliuza kiasi gani, TSh ngapi?");
    return;
  }

  const vendorId = await getOrCreateVendor(phone);
  await pool.query(
    `INSERT INTO transactions (vendor_id, type, direction, amount_tsh, raw_input, channel, parse_confidence)
     VALUES ($1, $2, $3, $4, $5, 'whatsapp', $6)`,
    [vendorId, parsed.type, parsed.direction, parsed.amount, text, parsed.confidence]
  );

  await sendWhatsAppMessage(phone, `Sawa! Umeongeza: ${parsed.type} TSh ${parsed.amount}. Asante!`);
});

app.listen(3000, () => console.log('Mkoba server running on port 3000'));
