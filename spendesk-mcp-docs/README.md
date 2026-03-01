# Spendesk MCP Documentation

Documentation Mintlify du serveur Spendesk MCP. Prévisualisation locale et déploiement sur Railway.

## Prévisualisation locale

```bash
npm install
npm run dev
```

Ouvre [http://localhost:3000](http://localhost:3000) (ou le port indiqué par Mintlify).

## Déploiement sur Railway

1. **Nouveau service** : Dans [Railway](https://railway.app), créez un nouveau service à partir du même dépôt Git que le MCP server.

2. **Root Directory** : Dans les paramètres du service, définissez **Root Directory** sur `spendesk-mcp-docs` (et non la racine du dépôt).

3. **Build & start** : Railway utilisera `railway.json` :
   - **Build** : `npm ci`
   - **Start** : `npm start` (lance un proxy sur `PORT` qui relaie vers Mintlify en local sur le port 3000).

4. **Variables d'environnement** : Aucune variable obligatoire. `PORT` est fourni par Railway.

5. **Domaine** : Dans **Settings → Networking**, générez un domaine public. La doc sera accessible à `https://<votre-service>.up.railway.app`.

### Remarque

Le serveur de documentation démarre Mintlify en arrière-plan puis écoute sur `PORT`. Le premier chargement peut prendre 30 à 60 secondes ; en cas de 502, réessayez après quelques secondes.
