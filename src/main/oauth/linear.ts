import { shell } from "electron";
import * as http from "http";
import * as crypto from "crypto";

const CLIENT_ID = "dc394eaa0f9d3b99f3e4158987f071ae";
const CLIENT_SECRET = "64b4839da022876d12d1e53c27420da0";
const REDIRECT_URI = "http://127.0.0.1:47321/oauth/linear";
const AUTH_URL = "https://linear.app/oauth/authorize";
const TOKEN_URL = "https://api.linear.app/oauth/token";
const PORT = 47321;
const TIMEOUT_MS = 5 * 60 * 1000;

const HTML_SUCCESS = `<html><body style="font-family:sans-serif;padding:40px">
  <h2>Connected to Linear</h2><p>You can close this tab.</p>
</body></html>`;

const HTML_FAIL = (msg: string) => `<html><body style="font-family:sans-serif;padding:40px">
  <h2>Authorization failed</h2><p>${msg}</p><p>You can close this tab.</p>
</body></html>`;

export async function startLinearOAuth(): Promise<{ oauthToken: string }> {
  const state = crypto.randomBytes(16).toString("hex");

  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);

      if (url.pathname !== "/oauth/linear") {
        res.writeHead(404).end();
        return;
      }

      const error = url.searchParams.get("error");
      const returnedState = url.searchParams.get("state");
      const code = url.searchParams.get("code");

      const fail = (msg: string) => {
        res.writeHead(200, { "Content-Type": "text/html" }).end(HTML_FAIL(msg));
        server.close();
        reject(new Error(msg));
      };

      if (error) return fail(error);
      if (returnedState !== state) return fail("State mismatch");
      if (!code) return fail("No authorization code received");

      try {
        const tokenRes = await fetch(TOKEN_URL, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            code,
            redirect_uri: REDIRECT_URI,
            client_id: CLIENT_ID,
            client_secret: CLIENT_SECRET,
            grant_type: "authorization_code",
          }).toString(),
        });

        if (!tokenRes.ok) {
          return fail(`Token exchange failed: HTTP ${tokenRes.status}`);
        }

        const json = (await tokenRes.json()) as { access_token?: string };
        if (!json.access_token) return fail("No access token in response");

        res.writeHead(200, { "Content-Type": "text/html" }).end(HTML_SUCCESS);
        server.close();
        resolve({ oauthToken: json.access_token });
      } catch (e) {
        fail(e instanceof Error ? e.message : "Token exchange failed");
      }
    });

    server.on("error", reject);

    const timeout = setTimeout(() => {
      server.close();
      reject(new Error("OAuth timed out"));
    }, TIMEOUT_MS);

    server.listen(PORT, "127.0.0.1", () => {
      clearTimeout(timeout); // reset after server is up; real timeout is on user action
      const params = new URLSearchParams({
        client_id: CLIENT_ID,
        redirect_uri: REDIRECT_URI,
        response_type: "code",
        scope: "read",
        state,
      });
      shell.openExternal(`${AUTH_URL}?${params}`);

      // Re-arm timeout from when browser opens
      setTimeout(() => {
        server.close();
        reject(new Error("OAuth timed out — no response from browser"));
      }, TIMEOUT_MS);
    });
  });
}
