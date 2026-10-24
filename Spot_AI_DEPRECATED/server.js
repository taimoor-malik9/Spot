const express = require('express');
const spotAI = require('./Index');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Mount the Spot_AI module at /api/ai
// This exposes: POST /api/ai/generate-process
app.use('/api/ai', spotAI);

app.get('/', (req, res) => {
  res.send('Spot_AI test server is running. POST to /api/ai/generate-process');
});

app.listen(PORT, () => {
  console.log(`Spot_AI test server running at http://localhost:${PORT}`);
  console.log(`Test endpoint: POST http://localhost:${PORT}/api/ai/generate-process`);
});