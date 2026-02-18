/**
 * UI routes for client registration portal.
 */

import type { Request, Response } from "express";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Shared navigation: Enregistrement, Documentation. */
function navHtml(current: "register" | "docs" | "success" | "companies"): string {
  const base = "/ui";
  return `
  <nav class="ui-nav">
    <a href="${base}" class="ui-nav-link${current === "register" ? " active" : ""}">Enregistrement</a>
    <a href="${base}/docs" class="ui-nav-link${current === "docs" ? " active" : ""}">Documentation</a>
  </nav>`;
}

/** Shared styles for nav (include once per page). */
const navStyles = `
  .ui-nav {
    background: rgba(255,255,255,0.95);
    padding: 12px 24px;
    border-radius: 0 0 12px 12px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.1);
    display: flex;
    gap: 24px;
    margin-bottom: 24px;
  }
  .ui-nav-link {
    color: #555;
    text-decoration: none;
    font-weight: 500;
    font-size: 15px;
  }
  .ui-nav-link:hover { color: #667eea; }
  .ui-nav-link.active { color: #667eea; }
`;

import { DatabaseClient } from "../db/client.js";
import { SpendeskClient } from "../spendesk-api/client.js";

// Lazy initialization of database client to avoid errors at module load time
let dbClient: DatabaseClient | null = null;

function getDbClient(): DatabaseClient {
  if (!dbClient) {
    try {
      dbClient = new DatabaseClient();
    } catch (err) {
      console.error("Failed to initialize database client:", err);
      throw err;
    }
  }
  return dbClient;
}

/**
 * Validate Spendesk token by making a test API call.
 * Uses same env as server (SPENDESK_USE_DEMO, SPENDESK_BASE_URL) so sandbox tokens are validated against sandbox API.
 */
async function validateSpendeskToken(token: string): Promise<boolean> {
  try {
    const useDemo =
      process.env.SPENDESK_USE_DEMO === "true" || process.env.SPENDESK_USE_DEMO === "1";
    const baseUrl = process.env.SPENDESK_BASE_URL;
    const client = new SpendeskClient({ apiToken: token, useDemo, baseUrl });
    // Try a simple endpoint that should be available: /v1/users (with pagination to limit response)
    await client.get("/v1/users", { page: "1", per_page: "1" });
    return true;
  } catch (err) {
    // Log error for debugging (but don't expose token)
    console.error("[Token validation] Failed:", err instanceof Error ? err.message : String(err));
    return false;
  }
}

/**
 * GET /ui - Registration form page.
 */
export function getRegisterForm(_req: Request, res: Response): void {
  res.type("text/html").send(`
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Enregistrement - Spendesk MCP Server</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .container {
      background: white;
      border-radius: 12px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
      max-width: 500px;
      width: 100%;
      padding: 40px;
    }
    h1 {
      color: #333;
      margin-bottom: 10px;
      font-size: 28px;
    }
    .subtitle {
      color: #666;
      margin-bottom: 30px;
      font-size: 14px;
    }
    .form-group {
      margin-bottom: 20px;
    }
    label {
      display: block;
      color: #333;
      margin-bottom: 8px;
      font-weight: 500;
      font-size: 14px;
    }
    input[type="text"] {
      width: 100%;
      padding: 12px;
      border: 2px solid #e0e0e0;
      border-radius: 6px;
      font-size: 14px;
      transition: border-color 0.2s;
    }
    input[type="text"]:focus {
      outline: none;
      border-color: #667eea;
    }
    button {
      width: 100%;
      padding: 14px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      border: none;
      border-radius: 6px;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      transition: transform 0.2s, box-shadow 0.2s;
    }
    button:hover {
      transform: translateY(-2px);
      box-shadow: 0 10px 20px rgba(102, 126, 234, 0.4);
    }
    button:active {
      transform: translateY(0);
    }
    button:disabled {
      opacity: 0.6;
      cursor: not-allowed;
      transform: none;
    }
    .error {
      background: #fee;
      color: #c33;
      padding: 12px;
      border-radius: 6px;
      margin-bottom: 20px;
      font-size: 14px;
      display: none;
    }
    .error.show {
      display: block;
    }
    .info {
      background: #e3f2fd;
      color: #1976d2;
      padding: 12px;
      border-radius: 6px;
      margin-top: 20px;
      font-size: 13px;
      line-height: 1.6;
    }
    .info strong {
      display: block;
      margin-bottom: 4px;
    }
    ${navStyles}
  </style>
</head>
<body>
  ${navHtml("register")}
  <div class="container">
    <h1>🔐 Enregistrement</h1>
    <p class="subtitle">Enregistrez votre token Spendesk pour accéder au MCP</p>
    
    <div class="error" id="error"></div>
    
    <form id="registerForm">
      <div class="form-group">
        <label for="label">Nom de la company (ex. Spendesk FR)</label>
        <input
          type="text"
          id="label"
          name="label"
          placeholder="Spendesk FR"
          autocomplete="off"
        />
      </div>
      <div class="form-group">
        <label for="token">Token Spendesk API</label>
        <input
          type="text"
          id="token"
          name="token"
          placeholder="Votre token Bearer Spendesk"
          required
          autocomplete="off"
        />
      </div>
      
      <button type="submit" id="submitBtn">Enregistrer</button>
    </form>
    
    <div class="info">
      <strong>ℹ️ Comment obtenir votre token ?</strong>
      Dans Spendesk : Paramètres > Intégrations > Gestion d'accès API<br>
      (Compte Premium/Enterprise, statut Account Owner requis)<br>
      <a href="/ui/docs" style="margin-top: 8px; display: inline-block;">Voir la documentation pour configurer votre MCP</a>
    </div>
  </div>
  
  <script>
    const form = document.getElementById('registerForm');
    const errorDiv = document.getElementById('error');
    const submitBtn = document.getElementById('submitBtn');
    const tokenInput = document.getElementById('token');
    
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errorDiv.classList.remove('show');
      submitBtn.disabled = true;
      submitBtn.textContent = 'Validation...';
      
      const token = tokenInput.value.trim();
      const label = document.getElementById('label').value.trim();
      
      if (!token) {
        errorDiv.textContent = 'Veuillez entrer un token';
        errorDiv.classList.add('show');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Enregistrer';
        return;
      }
      
      try {
        console.log('Sending registration request...');
        const res = await fetch('/ui/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, label: label || undefined })
        });
        
        console.log('Response status:', res.status);
        const text = await res.text();
        console.log('Response text:', text.substring(0, 200));
        
        let data;
        try {
          data = JSON.parse(text);
        } catch (parseErr) {
          throw new Error('Réponse invalide du serveur: ' + text.substring(0, 100));
        }
        
        if (!res.ok) {
          throw new Error(data.error || \`Erreur \${res.status}: \${res.statusText}\`);
        }
        
        if (!data.apiKey) {
          throw new Error('Clé API non reçue du serveur');
        }
        
        console.log('Registration successful, redirecting...');
        // Redirect to success page with API key
        window.location.href = \`/ui/success?apiKey=\${encodeURIComponent(data.apiKey)}\`;
      } catch (err) {
        console.error('Registration error:', err);
        errorDiv.textContent = err.message || 'Une erreur est survenue';
        errorDiv.classList.add('show');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Enregistrer';
      }
    });
  </script>
</body>
</html>
  `);
}

/**
 * GET /ui/docs - Documentation and setup guide.
 */
export function getDocsPage(_req: Request, res: Response): void {
  const baseUrl = "https://votre-domaine.railway.app"; // Client can replace with window.location.origin in browser
  res.type("text/html").send(`
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Documentation - Spendesk MCP Server</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      padding: 20px;
    }
    .container {
      background: white;
      border-radius: 12px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
      max-width: 720px;
      margin: 0 auto;
      padding: 40px;
    }
    h1 { color: #333; margin-bottom: 8px; font-size: 26px; }
    h2 { color: #444; margin: 28px 0 12px; font-size: 18px; border-bottom: 1px solid #eee; padding-bottom: 6px; }
    p { color: #555; line-height: 1.65; margin-bottom: 12px; font-size: 14px; }
    ul { margin: 8px 0 16px 20px; color: #555; line-height: 1.7; font-size: 14px; }
    code {
      background: #f0f0f0;
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 13px;
    }
    pre {
      background: #1e1e1e;
      color: #d4d4d4;
      padding: 16px;
      border-radius: 8px;
      overflow-x: auto;
      font-size: 12px;
      line-height: 1.5;
      margin: 12px 0 20px;
    }
    pre code { background: none; padding: 0; }
    .step { margin-bottom: 20px; }
    .step strong { color: #333; }
    a { color: #667eea; text-decoration: none; }
    a:hover { text-decoration: underline; }
    ${navStyles}
  </style>
</head>
<body>
  ${navHtml("docs")}
  <div class="container">
    <h1>Documentation</h1>
    <p>Guide pour configurer et utiliser le MCP Spendesk (Model Context Protocol).</p>

    <h2>Présentation</h2>
    <p>Ce serveur expose l’API Spendesk sous forme d’outils MCP. Il permet à des clients (Cursor, Dust, ChatGPT, etc.) d’interroger vos données Spendesk (settlements, payables, fournisseurs, utilisateurs, etc.) via un protocole standard.</p>

    <h2>Prérequis</h2>
    <ul>
      <li>Un token d’accès API Spendesk (Bearer).</li>
      <li>Création des identifiants : Spendesk → Paramètres → Intégrations → Gestion d’accès API (compte Premium/Enterprise, statut Account Owner).</li>
    </ul>

    <h2>Étapes de configuration</h2>

    <div class="step">
      <strong>1. S’enregistrer</strong><br>
      Sur cette interface, allez sur <a href="/ui">Enregistrement</a>, saisissez un nom de company (ex. Spendesk FR) et votre token Spendesk. Après validation, vous recevrez une <strong>clé API</strong> unique.
    </div>
    <div class="step">
      <strong>2. Conserver la clé API</strong><br>
      La clé s’affiche sur la page de succès. Elle sert à authentifier toutes vos requêtes MCP (header <code>X-Client-Token</code> ou <code>Authorization: Bearer &lt;clé&gt;</code>). Conservez-la en lieu sûr.
    </div>
    <div class="step">
      <strong>3. URL du MCP</strong><br>
      L’URL de base du MCP est : <code>/mcp</code> sur ce même domaine. Exemple : <code id="mcpUrl">${baseUrl}/mcp</code>
    </div>
    <div class="step">
      <strong>4. Headers d’authentification</strong><br>
      À chaque requête vers <code>POST /mcp</code> ou <code>GET /mcp</code>, envoyez l’un des deux formats suivants :
      <ul>
        <li><code>X-Client-Token: &lt;votre-clé-api&gt;</code></li>
        <li>ou <code>Authorization: Bearer &lt;votre-clé-api&gt;</code> (utilisé par Dust)</li>
      </ul>
      Pour cibler une company précise (multi-company), ajoutez <code>X-Company-Id: &lt;company_key&gt;</code> ou utilisez le Bearer au format <code>clé-api:company_key</code> (ex. <code>clé:spendesk-fr</code>).
    </div>
    <div class="step">
      <strong>5. Configurer Dust</strong><br>
      Dans Dust : Spaces → Tools → Add MCP Server. URL = <code>/mcp</code> de ce serveur. Authentification = Bearer token. Token = votre clé API (ou <code>clé:spendesk-fr</code> pour une company). Pour plusieurs companies, ajoutez plusieurs MCP servers (même URL, Bearer différent par company).
    </div>
    <div class="step">
      <strong>6. Multi-company</strong><br>
      Depuis la page de succès, cliquez sur « Gérer mes companies » pour ajouter d’autres companies (ex. Spendesk UK) avec leur token. Chaque company a une <code>company_key</code> à utiliser dans <code>X-Company-Id</code> ou dans le Bearer (<code>clé:company_key</code>).
    </div>

    <h2>Exemple avec curl</h2>
    <p>Initialiser une session MCP puis lister les outils :</p>
    <pre><code>curl -X POST <span id="curlOrigin">${baseUrl}</span>/mcp \\
  -H "Content-Type: application/json" \\
  -H "X-Client-Token: &lt;votre-clé-api&gt;" \\
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0.0"}}}'</code></pre>
    <p>La réponse contient un header <code>mcp-session-id</code> à renvoyer pour les requêtes suivantes.</p>

    <p style="margin-top: 24px;"><a href="/ui">→ Aller à l’enregistrement</a></p>
  </div>
  <script>
    (function() {
      var o = window.location.origin;
      var mcp = document.getElementById('mcpUrl');
      var curl = document.getElementById('curlOrigin');
      if (mcp) mcp.textContent = o + '/mcp';
      if (curl) curl.textContent = o;
    })();
  </script>
</body>
</html>
  `);
}

/**
 * POST /ui/register - Register a new client.
 */
export async function registerClient(req: Request, res: Response): Promise<void> {
  try {
    console.log("[Register] Request received");
    console.log("[Register] Method:", req.method);
    console.log("[Register] Path:", req.path);
    console.log("[Register] Content-Type:", req.get("content-type"));
    console.log("[Register] Body type:", typeof req.body);
    console.log("[Register] Body:", req.body);
    
    // Try to get body from different sources
    let body = req.body;
    if (!body || (typeof body === "object" && Object.keys(body).length === 0)) {
      // Body might not be parsed yet, try to read it manually
      console.log("[Register] Body not parsed, attempting manual read");
      const chunks: Buffer[] = [];
      return new Promise((resolve) => {
        req.on("data", (chunk: Buffer) => {
          chunks.push(chunk);
        });
        req.on("end", async () => {
          try {
            const data = Buffer.concat(chunks).toString("utf8");
            body = data ? JSON.parse(data) : {};
            console.log("[Register] Manually parsed body:", body);
            await processRegistration(body, req, res);
            resolve();
          } catch (err) {
            console.error("[Register] Manual parse error:", err);
            res.status(400).json({ error: "Invalid JSON body" });
            resolve();
          }
        });
        req.on("error", (err) => {
          console.error("[Register] Stream error:", err);
          res.status(500).json({ error: "Request stream error" });
          resolve();
        });
      });
    }
    
    await processRegistration(body, req, res);
  } catch (err) {
    console.error("[Register] Handler error:", err);
    if (!res.headersSent) {
      res.status(500).json({
        error: err instanceof Error ? err.message : "Internal server error",
      });
    }
  }
}

async function processRegistration(body: any, req: Request, res: Response): Promise<void> {
  const { token, label } = body || {};
  
  if (!token || typeof token !== "string" || !token.trim()) {
    console.log("[Register] Missing or invalid token");
    res.status(400).json({ error: "Token is required" });
    return;
  }

  const trimmedToken = token.trim();
  const firstCompanyLabel = typeof label === "string" && label.trim() ? label.trim() : undefined;
  console.log("[Register] Token length:", trimmedToken.length, "firstCompanyLabel:", firstCompanyLabel);

  // Validate token with Spendesk API
  console.log("[Register] Validating token with Spendesk API...");
  const isValid = await validateSpendeskToken(trimmedToken);
  if (!isValid) {
    console.log("[Register] Token validation failed");
    res.status(400).json({
      error: "Invalid Spendesk token. Please verify your token is correct and has the required permissions.",
    });
    return;
  }

  console.log("[Register] Token validated, creating client and first company...");
  const db = getDbClient();
  const apiKey = db.createClient(trimmedToken, firstCompanyLabel ?? "Default");
  const companies = db.listCompanies(apiKey);
  console.log("[Register] Client created with API key:", apiKey.substring(0, 8) + "...", "companies:", companies.length);

  res.json({
    success: true,
    apiKey,
    companies,
    message: "Client registered successfully",
  });
}

/**
 * GET /ui/success - Success page with API key and companies list.
 */
export function getSuccessPage(req: Request, res: Response): void {
  const apiKey = req.query.apiKey as string | undefined;
  
  if (!apiKey) {
    res.redirect("/ui");
    return;
  }

  let companies: { company_key: string; label: string }[] = [];
  try {
    const db = getDbClient();
    if (db.apiKeyExists(apiKey)) {
      companies = db.listCompanies(apiKey);
    }
  } catch {
    // ignore
  }

  const companiesHtml =
    companies.length === 0
      ? ""
      : `
    <h3 style="margin-top: 24px; margin-bottom: 12px; font-size: 18px;">Multi-company (header X-Company-Id)</h3>
    <p style="color: #666; margin-bottom: 12px;">Pour cibler une company dans vos appels MCP, ajoutez le header <code>X-Company-Id</code> avec la clé ci-dessous :</p>
    <ul style="margin: 12px 0; padding-left: 20px;">
      ${companies.map((c) => `<li><strong>${escapeHtml(c.label)}</strong> : <code>X-Company-Id: ${escapeHtml(c.company_key)}</code></li>`).join("")}
    </ul>
    <p style="margin-top: 12px;"><a href="/ui/companies?apiKey=${encodeURIComponent(apiKey)}" style="color: #667eea;">Gérer mes companies (ajouter Spendesk UK, etc.)</a></p>
  `;

  res.type("text/html").send(`
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Enregistrement réussi - Spendesk MCP Server</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .container {
      background: white;
      border-radius: 12px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
      max-width: 600px;
      width: 100%;
      padding: 40px;
    }
    h1 {
      color: #4caf50;
      margin-bottom: 20px;
      font-size: 28px;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .success-icon {
      font-size: 32px;
    }
    .api-key-box {
      background: #f5f5f5;
      border: 2px solid #e0e0e0;
      border-radius: 6px;
      padding: 16px;
      margin: 20px 0;
      font-family: 'Monaco', 'Courier New', monospace;
      font-size: 13px;
      word-break: break-all;
      position: relative;
    }
    .copy-btn {
      position: absolute;
      top: 12px;
      right: 12px;
      background: #667eea;
      color: white;
      border: none;
      border-radius: 4px;
      padding: 6px 12px;
      font-size: 12px;
      cursor: pointer;
      transition: background 0.2s;
    }
    .copy-btn:hover {
      background: #5568d3;
    }
    .instructions {
      background: #e3f2fd;
      color: #1976d2;
      padding: 16px;
      border-radius: 6px;
      margin-top: 20px;
      font-size: 13px;
      line-height: 1.6;
    }
    .instructions h3 {
      margin-bottom: 10px;
      font-size: 16px;
    }
    .instructions code {
      background: rgba(255,255,255,0.7);
      padding: 2px 6px;
      border-radius: 3px;
      font-size: 12px;
    }
    .warning {
      background: #fff3cd;
      color: #856404;
      padding: 12px;
      border-radius: 6px;
      margin-top: 20px;
      font-size: 13px;
    }
    .warning strong {
      display: block;
      margin-bottom: 4px;
    }
    ${navStyles}
  </style>
</head>
<body>
  ${navHtml("success")}
  <div class="container">
    <h1>
      <span class="success-icon">✅</span>
      Enregistrement réussi !
    </h1>
    
    <p style="color: #666; margin-bottom: 20px;">
      Votre token Spendesk a été enregistré avec succès. Utilisez cette clé API pour accéder au MCP :
    </p>
    
    <div class="api-key-box" id="apiKeyBox">
      <span id="apiKey">${apiKey}</span>
      <button class="copy-btn" onclick="copyApiKey()">Copier</button>
    </div>
    
    <div class="instructions">
      <h3>📋 Comment utiliser cette clé API</h3>
      <p>Ajoutez le header suivant à toutes vos requêtes MCP :</p>
      <code>X-Client-Token: ${apiKey}</code>
      <p style="margin-top: 12px;">
        Exemple avec curl :
      </p>
      <code style="display: block; margin-top: 6px; padding: 8px; background: rgba(255,255,255,0.7);">
curl -H "X-Client-Token: ${apiKey}" -H "Content-Type: application/json" \\
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{...}}' \\
  https://votre-domaine.railway.app/mcp
      </code>
    </div>
    
    ${companiesHtml}
    <div class="warning">
      <strong>⚠️ Important</strong>
      Conservez cette clé API en sécurité. Elle vous permet d'accéder à votre compte Spendesk via le MCP.
      Si vous perdez cette clé, vous devrez vous réenregistrer.
    </div>
  </div>
  
  <script>
    function copyApiKey() {
      const apiKey = document.getElementById('apiKey').textContent;
      navigator.clipboard.writeText(apiKey).then(() => {
        const btn = event.target;
        const originalText = btn.textContent;
        btn.textContent = '✓ Copié';
        btn.style.background = '#4caf50';
        setTimeout(() => {
          btn.textContent = originalText;
          btn.style.background = '#667eea';
        }, 2000);
      });
    }
  </script>
</body>
</html>
  `);
}

/**
 * GET /ui/companies - List companies and form to add another (requires apiKey in query).
 */
export function getCompaniesPage(req: Request, res: Response): void {
  const apiKey = req.query.apiKey as string | undefined;
  if (!apiKey) {
    res.redirect("/ui");
    return;
  }
  let companies: { company_key: string; label: string }[] = [];
  let validKey = false;
  try {
    const db = getDbClient();
    validKey = db.apiKeyExists(apiKey);
    if (validKey) companies = db.listCompanies(apiKey);
  } catch {
    // ignore
  }
  if (!validKey) {
    res.status(404).type("text/html").send(`
      <!DOCTYPE html><html><body style="font-family: sans-serif; padding: 40px;">
        <h1>Clé API invalide</h1>
        <p><a href="/ui">Retour à l'enregistrement</a></p>
      </body></html>`);
    return;
  }

  res.type("text/html").send(`
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Mes companies - Spendesk MCP Server</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); min-height: 100vh; padding: 20px; }
    .container { background: white; border-radius: 12px; box-shadow: 0 20px 60px rgba(0,0,0,0.3); max-width: 600px; margin: 0 auto; padding: 40px; }
    h1 { color: #333; margin-bottom: 10px; font-size: 24px; }
    .subtitle { color: #666; margin-bottom: 24px; font-size: 14px; }
    ul { list-style: none; margin: 16px 0; }
    li { padding: 12px; background: #f5f5f5; border-radius: 6px; margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center; }
    li code { font-size: 12px; background: #e0e0e0; padding: 4px 8px; border-radius: 4px; }
    .form-group { margin: 24px 0 16px; }
    label { display: block; color: #333; margin-bottom: 8px; font-weight: 500; font-size: 14px; }
    input[type="text"] { width: 100%; padding: 12px; border: 2px solid #e0e0e0; border-radius: 6px; font-size: 14px; margin-bottom: 12px; }
    button { padding: 12px 24px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; border: none; border-radius: 6px; font-size: 14px; font-weight: 600; cursor: pointer; }
    button:hover { opacity: 0.95; }
    .error { background: #fee; color: #c33; padding: 12px; border-radius: 6px; margin: 16px 0; font-size: 14px; display: none; }
    .error.show { display: block; }
    .back { margin-top: 24px; }
    .back a { color: #667eea; text-decoration: none; }
    ${navStyles}
  </style>
</head>
<body>
  ${navHtml("companies")}
  <div class="container">
    <h1>Mes companies</h1>
    <p class="subtitle">Ajoutez une company Spendesk (ex. Spendesk UK) pour utiliser plusieurs tokens avec le même compte MCP.</p>
    ${companies.length > 0 ? "<p><strong>Companies enregistrées :</strong></p><ul>" + companies.map((c) => `<li><span>${escapeHtml(c.label)}</span> <code>X-Company-Id: ${escapeHtml(c.company_key)}</code></li>`).join("") + "</ul>" : "<p>Aucune company pour l'instant.</p>"}
    <form id="addForm" method="post" action="/ui/companies">
      <input type="hidden" name="apiKey" value="${escapeHtml(apiKey)}" />
      <div class="form-group">
        <label for="label">Nom de la company (ex. Spendesk UK)</label>
        <input type="text" id="label" name="label" placeholder="Spendesk UK" required />
        <label for="token">Token Spendesk API pour cette company</label>
        <input type="text" id="token" name="token" placeholder="Token Bearer" required autocomplete="off" />
      </div>
      <button type="submit">Ajouter la company</button>
    </form>
    <div class="error" id="error"></div>
    <p class="back"><a href="/ui/success?apiKey=${encodeURIComponent(apiKey)}">Retour à ma clé API</a></p>
  </div>
  <script>
    document.getElementById('addForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.target;
      const apiKey = form.querySelector('[name=apiKey]').value;
      const label = form.querySelector('[name=label]').value.trim();
      const token = form.querySelector('[name=token]').value.trim();
      const errEl = document.getElementById('error');
      errEl.classList.remove('show');
      try {
        const res = await fetch('/ui/companies', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ apiKey, label, token })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || res.statusText);
        window.location.href = '/ui/companies?apiKey=' + encodeURIComponent(apiKey);
      } catch (err) {
        errEl.textContent = err.message || 'Erreur';
        errEl.classList.add('show');
      }
    });
  </script>
</body>
</html>
  `);
}

/**
 * POST /ui/companies - Add a company (body: apiKey, label, token).
 */
export async function addCompany(req: Request, res: Response): Promise<void> {
  let body = req.body;
  if (!body || (typeof body === "object" && Object.keys(body).length === 0)) {
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => resolve());
      req.on("error", reject);
    });
    const data = Buffer.concat(chunks).toString("utf8");
    body = data ? JSON.parse(data) : {};
  }
  const { apiKey, label, token } = body || {};
  if (!apiKey || !label || !token || typeof apiKey !== "string" || typeof label !== "string" || typeof token !== "string") {
    res.status(400).json({ error: "apiKey, label and token are required" });
    return;
  }
  const trimmedToken = token.trim();
  const trimmedLabel = label.trim();
  if (!trimmedLabel) {
    res.status(400).json({ error: "label is required" });
    return;
  }
  const isValid = await validateSpendeskToken(trimmedToken);
  if (!isValid) {
    res.status(400).json({
      error: "Invalid Spendesk token. Please verify your token for this company.",
    });
    return;
  }
  try {
    const db = getDbClient();
    if (!db.apiKeyExists(apiKey)) {
      res.status(404).json({ error: "Invalid API key" });
      return;
    }
    const companyKey = db.createCompany(apiKey, trimmedLabel, trimmedToken);
    res.json({ success: true, company_key: companyKey, label: trimmedLabel });
  } catch (err) {
    console.error("Add company error:", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Internal server error",
    });
  }
}
