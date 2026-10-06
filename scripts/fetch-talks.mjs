import { createSign, createPrivateKey } from "node:crypto";
import { writeFile } from "node:fs/promises";

const base64url = (buf) => Buffer.from(buf).toString("base64url");

function signJwt(key, payload) {
  const header = { alg: "RS256", typ: "JWT" };
  const encHeader = base64url(JSON.stringify(header));
  const encPayload = base64url(JSON.stringify(payload));
  const signer = createSign("RSA-SHA256");
  signer.update(`${encHeader}.${encPayload}`);
  signer.end();
  return `${encHeader}.${encPayload}.${base64url(signer.sign(key))}`;
}

async function getAccessToken(serviceAccount) {
  const key = createPrivateKey(serviceAccount.private_key);
  const now = Math.floor(Date.now() / 1000);
  const assertion = signJwt(key, {
    iss: serviceAccount.client_email,
    scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  });

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });

  if (!res.ok) {
    throw new Error(`Token request failed: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  return data.access_token;
}

async function fetchRows(accessToken, sheetId, range) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    throw new Error(`Sheets request failed: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  return data.values || [];
}

async function main() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT;
  const sheetId = process.env.GOOGLE_SHEET_ID;
  const range = process.env.GOOGLE_SHEET_RANGE || "Sheet1!A2:C";

  if (!raw) throw new Error("GOOGLE_SERVICE_ACCOUNT is not set");
  if (!sheetId) throw new Error("GOOGLE_SHEET_ID is not set");

  const serviceAccount = JSON.parse(raw);
  const accessToken = await getAccessToken(serviceAccount);
  const rows = await fetchRows(accessToken, sheetId, range);

  const talks = rows
    .filter((r) => r[2] && r[2].trim())
    .map((r) => ({ topic: (r[2] || "").trim(), speaker: (r[1] || "").trim() }));

  await writeFile("talks.json", JSON.stringify({ talks }, null, 2) + "\n");
  console.log(`Wrote talks.json with ${talks.length} talks`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
