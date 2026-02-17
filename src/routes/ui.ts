/**
 * UI routes for client registration portal.
 */

import type { Request, Response } from "express";
import { DatabaseClient } from "../db/client.js";
import { SpendeskClient } from "../spendesk-api/client.js";

const dbClient = new DatabaseClient();

/**
 * Validate Spendesk token by making a test API call.
 */
async function validateSpendeskToken(token: string): Promise<boolean> {
  try {
    const client = new SpendeskClient({ apiToken: token });
    // Try to fetch wallet summary as a lightweight validation
    await client.get("/v1/wallet/summary");
    return true;
  } catch (err) {
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
  </style>
</head>
<body>
  <div class="container">
    <h1>🔐 Enregistrement</h1>
    <p class="subtitle">Enregistrez votre token Spendesk pour accéder au MCP</p>
    
    <div class="error" id="error"></div>
    
    <form id="registerForm">
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
      (Compte Premium/Enterprise, statut Account Owner requis)
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
      
      try {
        const res = await fetch('/ui/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token })
        });
        
        const data = await res.json();
        
        if (!res.ok) {
          throw new Error(data.error || 'Erreur lors de l\'enregistrement');
        }
        
        // Redirect to success page with API key
        window.location.href = \`/ui/success?apiKey=\${encodeURIComponent(data.apiKey)}\`;
      } catch (err) {
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
 * POST /ui/register - Register a new client.
 */
export async function registerClient(req: Request, res: Response): Promise<void> {
  try {
    const { token } = req.body;
    
    if (!token || typeof token !== "string" || !token.trim()) {
      res.status(400).json({ error: "Token is required" });
      return;
    }

    const trimmedToken = token.trim();

    // Validate token with Spendesk API
    const isValid = await validateSpendeskToken(trimmedToken);
    if (!isValid) {
      res.status(400).json({
        error: "Invalid Spendesk token. Please verify your token is correct and has the required permissions.",
      });
      return;
    }

    // Create client and get API key
    const apiKey = dbClient.createClient(trimmedToken);

    res.json({
      success: true,
      apiKey,
      message: "Client registered successfully",
    });
  } catch (err) {
    console.error("Registration error:", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Internal server error",
    });
  }
}

/**
 * GET /ui/success - Success page with API key.
 */
export function getSuccessPage(req: Request, res: Response): void {
  const apiKey = req.query.apiKey as string | undefined;
  
  if (!apiKey) {
    res.redirect("/ui");
    return;
  }

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
  </style>
</head>
<body>
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
