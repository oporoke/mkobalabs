require('dotenv').config();

process.on('unhandledRejection', (err) => console.error('Unhandled rejection:', err));

const pool = require('./db');
const { parseLedgerEntry } = require('./parser');
const { parseLedgerEntries } = require('./parser');
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
  const { rows } = await pool.query(
    `INSERT INTO vendors (phone_number, name, onboarded_via)
     VALUES ($1, $1, 'whatsapp')
     ON CONFLICT (phone_number) DO UPDATE SET phone_number = EXCLUDED.phone_number
     RETURNING id`,
    [phone]
  );
  return rows[0].id;
}

app.get("/", async (req, res) => {
  res.send("Mkoba API is running");
});


app.post('/webhook', async (req, res) => {
  console.log("Called");
  res.sendStatus(200); // ack immediately — do the work after

  const value = req.body.entry?.[0]?.changes?.[0]?.value;
  const msg = value?.messages?.[0];

  try {
    console.log('Received on phone_number_id:', value?.metadata?.phone_number_id);

    const status = value?.statuses?.[0];
    if (status) {
      console.log('Status:', status.status, JSON.stringify(status.errors || []));
      return;
    }

    if (!msg) return;

    const phone = msg.from;
    const vendorId = await getOrCreateVendor(phone);

    const logged = await pool.query(
      `INSERT INTO messages_log (wa_message_id, vendor_id, phone_number, channel, direction, raw_payload)
       VALUES ($1, $2, $3, 'whatsapp', 'inbound', $4)
       ON CONFLICT (wa_message_id) DO NOTHING
       RETURNING id`,
      [msg.id, vendorId, phone, JSON.stringify(msg)]
    );
    if (logged.rowCount === 0) {
      console.log('Duplicate message ignored:', msg.id);
      return;
    }

    if (msg.type !== 'text') {
      if (msg.type === 'audio') {
        await sendWhatsAppMessage(phone, "Samahani, bado siwezi kusikiliza ujumbe wa sauti. Tafadhali andika, mfano: nimeuza 5000");
      } else if (['image', 'video', 'document', 'sticker', 'location', 'contacts'].includes(msg.type)) {
        await sendWhatsAppMessage(phone, "Samahani, ninaelewa ujumbe wa maandishi tu. Andika, mfano: nimeuza 5000 au nimenunua unga 20000");
      }
      return; // reactions and other types: logged, no reply
    }

    const text = msg.text.body;

        const entries = parseLedgerEntries(text);
    const unclear = entries.filter(e => e.confidence < 0.6);

    if (entries.length === 0 || unclear.length) {
      const what = unclear.length && entries.length > 1 ? ` "${unclear[0].text}"` : '';
      await sendWhatsAppMessage(phone, `Samahani, sikuelewa vizuri${what}. Ulitumia/uliuza kiasi gani, TSh ngapi?`);
      return;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const e of entries) {
        await client.query(
          `INSERT INTO transactions (vendor_id, type, direction, amount_tsh, raw_input, channel, parse_confidence)
           VALUES ($1, $2, $3, $4, $5, 'whatsapp', $6)`,
          [vendorId, e.type, e.direction, e.amount, e.text, e.confidence]
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err; // handled by the outer catch
    } finally {
      client.release();
    }

    const lines = entries.map(e => `- ${e.type} TSh ${e.amount}`).join('\n');
    await sendWhatsAppMessage(phone, `Sawa! Nimeongeza:\n${lines}\nAsante!`);
  } catch (err) {
    console.error('Webhook processing failed:', msg?.id || '(no message id)', err.stack);
    if (msg?.from) {
      await sendWhatsAppMessage(msg.from, "Samahani, kuna tatizo la mfumo. Tafadhali tuma tena baada ya muda mfupi.");
    }
  }
});

app.listen(3000, () => console.log('Mkoba server running on port 3000'));
