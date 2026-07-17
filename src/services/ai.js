// src/services/ai.js
import { pipeline, env } from '@xenova/transformers';

// Use local models (no download from CDN if possible)
env.localModelPath = 'https://huggingface.co/Xenova/all-MiniLM-L6-v2';

let embeddingPipeline = null;
let isModelLoading = false;
let modelReady = false;

export async function initModel() {
    if (modelReady) return;
    if (isModelLoading) {
        // Wait for loading to finish
        return new Promise((resolve) => {
            const check = setInterval(() => {
                if (modelReady) {
                    clearInterval(check);
                    resolve();
                }
            }, 100);
        });
    }

    isModelLoading = true;
    try {
        console.log('Loading AI model...');
        embeddingPipeline = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
        modelReady = true;
        console.log('AI model loaded successfully');
    } catch (e) {
        console.error('Failed to load AI model:', e);
    } finally {
        isModelLoading = false;
    }
}

export async function generateEmbedding(text) {
    if (!modelReady) {
        await initModel();
    }
    if (!embeddingPipeline) {
        throw new Error('Embedding pipeline not available');
    }

    const output = await embeddingPipeline(text, { pooling: 'mean', normalize: true });
    // output is a Float32Array
    return output.data;
}