const config = require("./config");

const basicAuth = Buffer.from(
  `${config.DEVSHOPID}:${config.KFM_PASSWORD}`,
).toString("base64");

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

  if (!response.ok) {
    const error = new Error(`Upland API error: ${response.status}`);
    error.status = response.status;
    try {
      error.data = await response.json();
    } catch {
      error.data = await response.text();
    }
    throw error;
  }

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

  if (!response.ok) {
    const error = new Error(`Upland API error: ${response.status}`);
    error.status = response.status;
    try {
      error.data = await response.json();
    } catch {
      error.data = await response.text();
    }
    throw error;
  }

  if (response.status === 204) return null;
  return response.json();
};

module.exports = { uplandFetch, uplandUserFetch };
