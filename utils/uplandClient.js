const config = require("./config");

const basicAuth = Buffer.from(
  `${config.DEVSHOPID}:${config.KFM_PASSWORD}`,
).toString("base64");

// A body can only be read once: read it as text, then try JSON. (Reading
// .json() first and falling back to .text() threw "Body is unusable" whenever
// Upland answered with HTML, e.g. a gateway timeout.)
const apiError = async response => {
  const error = new Error(`Upland API error: ${response.status}`);
  error.status = response.status;
  const text = await response.text().catch(() => "");
  try {
    error.data = JSON.parse(text);
  } catch {
    error.data = text;
  }
  return error;
};

const uplandFetch = async (path, options = {}) => {
  const url = `${config.UPLAND_URI}${path}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Basic ${basicAuth}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!response.ok) throw await apiError(response);

  if (response.status === 204) return null;
  return response.json();
};

const uplandUserFetch = async (path, accessToken, options = {}) => {
  const url = `${config.UPLAND_URI}${path}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!response.ok) throw await apiError(response);

  if (response.status === 204) return null;
  return response.json();
};

module.exports = { uplandFetch, uplandUserFetch };
