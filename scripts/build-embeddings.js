import fs from 'fs';
import path from 'path';
import OpenAI from 'openai';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, '..');

async function main() {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.error('OPENAI_API_KEY is not set in environment. Cannot build embeddings.');
      process.exit(1);
    }

    const client = new OpenAI({ apiKey });

    const trainingPaths = [
      path.join(rootDir, 'config', 'training-data.json'),
      path.join(rootDir, 'training-data.json')
    ];

    let trainingData = null;
    for (const p of trainingPaths) {
      if (fs.existsSync(p)) {
        const raw = fs.readFileSync(p, 'utf8');
        trainingData = JSON.parse(raw);
        console.log(`Loaded training data from ${p}`);
        break;
      }
    }

    if (!trainingData || !Array.isArray(trainingData.conversation_examples)) {
      console.error('No conversation_examples found in training-data.json');
      process.exit(1);
    }

    const examples = trainingData.conversation_examples;
    const entries = [];
    const model = 'text-embedding-3-small';

    console.log(`Building embeddings for ${examples.length} training examples using model "${model}"...`);

    // Embed in small batches to avoid request limits
    const batchSize = 16;
    for (let i = 0; i < examples.length; i += batchSize) {
      const batch = examples.slice(i, i + batchSize);
      const inputs = batch.map((ex) => ex.user_message);

      const response = await client.embeddings.create({
        model,
        input: inputs
      });

      const vectors = response.data.map((d) => d.embedding);

      batch.forEach((ex, idx) => {
        entries.push({
          id: `training_${i + idx}`,
          user_message: ex.user_message,
          response: Array.isArray(ex.good_responses) && ex.good_responses.length > 0
            ? ex.good_responses[0]
            : ex.user_message,
          context: ex.context || 'training_data',
          intent: ex.context || 'training_data',
          embedding: vectors[idx]
        });
      });

      console.log(`Embedded ${Math.min(i + batchSize, examples.length)}/${examples.length} examples...`);
    }

    const outDir = path.join(rootDir, 'data');
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }

    const outPath = path.join(outDir, 'training-embeddings.json');
    fs.writeFileSync(
      outPath,
      JSON.stringify(
        {
          model,
          entries
        },
        null,
        2
      ),
      'utf8'
    );

    console.log(`Saved ${entries.length} embeddings to ${outPath}`);
  } catch (error) {
    console.error('Failed to build embeddings:', error.message);
    process.exit(1);
  }
}

main();

