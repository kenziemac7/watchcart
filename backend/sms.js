require('dotenv').config();
const twilio = require('twilio');

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

async function sendPriceAlert({ productName, price, targetPrice, size, url }) {
  const body = [
    '🛍️ WatchCart Alert!',
    `${productName} dropped to $${price.toFixed(2)} (your target: $${targetPrice.toFixed(2)})`,
    `Size ${size} is in stock.`,
    `👉 ${url}`,
  ].join('\n');

  const message = await client.messages.create({
    body,
    from: process.env.TWILIO_FROM_NUMBER,
    to: process.env.TWILIO_TO_NUMBER,
  });

  console.log(`[SMS] Sent alert for "${productName}" — SID ${message.sid}`);
  return message.sid;
}

module.exports = { sendPriceAlert };
