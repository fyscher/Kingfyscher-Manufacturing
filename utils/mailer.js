const config = require("./config");

const sendEmail = async ({ to, subject, html }) => {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: config.FROM_EMAIL || "Kingfyscher Manufacturing <onboarding@resend.dev>",
      to,
      subject,
      html,
    }),
  });

  if (!response.ok) {
    const error = new Error(`Email send failed: ${response.status}`);
    error.data = await response.text();
    throw error;
  }

  return response.json();
};

module.exports = { sendEmail };
