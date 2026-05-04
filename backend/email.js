require('dotenv').config();
const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

async function sendPriceAlert({ productName, price, targetPrice, size, url, imageUrl, siteName }) {
  const subject = `🛍️ Price drop: ${productName} is now $${price.toFixed(2)}`;

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${subject}</title>
</head>
<body style="margin:0;padding:0;background:#0f0f13;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f0f13;padding:32px 0;">
    <tr>
      <td align="center">
        <table width="520" cellpadding="0" cellspacing="0" style="background:#1a1a24;border-radius:14px;border:1px solid #2e2e3e;overflow:hidden;">

          <!-- Header -->
          <tr>
            <td style="background:#7c6af5;padding:18px 28px;">
              <span style="font-size:22px;font-weight:700;color:#fff;letter-spacing:-0.3px;">🛒 WatchCart</span>
            </td>
          </tr>

          <!-- Hero message -->
          <tr>
            <td style="padding:28px 28px 20px;">
              <p style="margin:0 0 6px;font-size:13px;color:#7a7a99;text-transform:uppercase;letter-spacing:0.5px;font-weight:600;">Price Drop Alert</p>
              <h1 style="margin:0;font-size:22px;color:#e8e8f0;font-weight:700;line-height:1.3;">${escHtml(productName)}</h1>
              ${siteName ? `<p style="margin:6px 0 0;font-size:12px;color:#55556a;">${escHtml(siteName)}</p>` : ''}
            </td>
          </tr>

          <!-- Product image (if available) -->
          ${imageUrl ? `
          <tr>
            <td style="padding:0 28px 20px;">
              <img src="${escHtml(imageUrl)}" alt="${escHtml(productName)}"
                   style="width:100%;max-height:260px;object-fit:contain;border-radius:10px;background:#12121a;display:block;" />
            </td>
          </tr>` : ''}

          <!-- Price block -->
          <tr>
            <td style="padding:0 28px 24px;">
              <table width="100%" cellpadding="0" cellspacing="0"
                     style="background:#12121a;border-radius:10px;border:1px solid #2e2e3e;">
                <tr>
                  <td style="padding:18px 20px;border-right:1px solid #2e2e3e;" align="center">
                    <p style="margin:0 0 4px;font-size:11px;color:#7a7a99;text-transform:uppercase;letter-spacing:0.4px;">Current Price</p>
                    <p style="margin:0;font-size:28px;font-weight:700;color:#22c55e;">$${price.toFixed(2)}</p>
                  </td>
                  <td style="padding:18px 20px;" align="center">
                    <p style="margin:0 0 4px;font-size:11px;color:#7a7a99;text-transform:uppercase;letter-spacing:0.4px;">Your Target</p>
                    <p style="margin:0;font-size:28px;font-weight:700;color:#7c6af5;">$${targetPrice.toFixed(2)}</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Size badge -->
          ${size ? `
          <tr>
            <td style="padding:0 28px 24px;">
              <p style="margin:0 0 8px;font-size:11px;color:#7a7a99;text-transform:uppercase;letter-spacing:0.4px;font-weight:600;">Size In Stock</p>
              <span style="display:inline-block;background:#1e293b;border:1px solid #334155;border-radius:999px;padding:5px 14px;font-size:13px;font-weight:600;color:#94a3b8;">${escHtml(size)}</span>
            </td>
          </tr>` : ''}

          <!-- CTA -->
          <tr>
            <td style="padding:0 28px 28px;">
              <a href="${escHtml(url)}"
                 style="display:block;background:#7c6af5;color:#fff;text-decoration:none;font-size:15px;font-weight:700;text-align:center;padding:14px 20px;border-radius:10px;">
                Buy Now →
              </a>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:16px 28px;border-top:1px solid #2e2e3e;">
              <p style="margin:0;font-size:11px;color:#3a3a50;text-align:center;">
                WatchCart · To stop alerts for this item, set its status to <em>paused</em> in the extension.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const result = await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL,
    to: process.env.ALERT_TO_EMAIL,
    subject,
    html,
  });

  console.log(`[email] Alert sent for "${productName}" — id ${result.data?.id}`);
  return result;
}

function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

module.exports = { sendPriceAlert };
