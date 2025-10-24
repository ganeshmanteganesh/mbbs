const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const fs = require("fs");
const path = require("path");

// Dynamically import node-fetch as it's an ES module
const fetch = (...args) => import("node-fetch").then(({ default: fetch }) => fetch(...args));
const app = express();

app.use(cors());
// --- FIX: Increase payload limit to 50mb to prevent '413 Payload Too Large' errors for big JSON files ---
app.use(bodyParser.json({ limit: "50mb" }));
app.use(bodyParser.urlencoded({ limit: "50mb", extended: true }));
// -------------------------------------------------------------------------------------------------------

// Serve static files (including index.html) from the current directory
app.use(express.static(__dirname));

// IMPORTANT: Using user-provided key. If deploying, ensure this is stored securely.
// NOTE: This key is used for demonstration and should be replaced with a real, secure key.
const GEMINI_API_KEY = "AIzaSyAvkEhfa9lHXib9q3trjrDo3B9mZhYVq3k";
const DEFAULT_GEMINI_MODEL = "gemini-2.0-flash-lite";

// Ensure "responses" folder exists for caching
if (!fs.existsSync("responses")) fs.mkdirSync("responses");

// Serve index.html
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "index.html")));

/**
 * Sanitize a string to create a safe filename fragment.
 * @param {string} name - The original string (usually the JSON value).
 * @returns {string} The sanitized, truncated string.
 */
function sanitizeFileName(name) {
    // Truncate to 50 chars and replace non-alphanumeric/underscore chars with underscore
    return String(name).substring(0, 50).replace(/[^a-z0-9]/gi, "_").toLowerCase();
}

/**
 * Processes a single key/value entry: checks cache, calls API if needed.
 * @param {string} key - The display key (for logging/response).
 * @param {any} value - The data/object to be explained (used for prompt and cache key).
 * @param {string} [modelToUse] - The model to use for the API call. Overrides DEFAULT_GEMINI_MODEL.
 * @returns {Promise<object>} The response object including status, model used, and text.
 */
const processSingleEntry = async (key, value, modelToUse) => {
    const model = modelToUse || DEFAULT_GEMINI_MODEL;
    const valueString = typeof value === 'object' ? JSON.stringify(value) : String(value);

    // Use the stringified value for the cache key
    const cacheKey = sanitizeFileName(valueString);
    const filePath = path.join(__dirname, "responses", `${cacheKey}.txt`);

    // 1. Check Cache
    if (fs.existsSync(filePath)) {
        const text = fs.readFileSync(filePath, "utf8");
        return { key, status: "Success", model: model, response: text, cached: true };
    }

    // 2. Call Gemini API
    try {
        const prompt = `Explain the following JSON object in detail, focusing on medical/scientific concepts and keeping the format brief and informative:\n\n${valueString}`;
        
        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
            }
        );

        const data = await response.json();
        // Check for specific API error structure
        if (data.error) {
            throw new Error(data.error.message || `API Error: ${JSON.stringify(data)}`);
        }

        const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "⚠️ Empty response";

        // Save response to file
        fs.writeFileSync(filePath, text);
        return { key, status: "Success", model: model, response: text, cached: false };
    } catch (err) {
        return { key, status: "Error", model: model, response: err.message, cached: false };
    }
};


// --- ROUTE 1: Ask Gemini (Single Query) ---
app.post("/askGemini", async (req, res) => {
    const { promptKey, prompt, modelOverride } = req.body;
    if (!prompt) {
        return res.status(400).json({ error: "Prompt (key value) is required." });
    }

    try {
        // We pass the promptKey as the key, the prompt as the value to be stringified (or used as-is), and the modelOverride
        const result = await processSingleEntry(promptKey, prompt, modelOverride);
        res.json(result);
    } catch (err) {
        console.error("Single Query Error:", err);
        res.status(500).json({ error: err.message });
    }
});


// --- ROUTE 2: Generate All Terms (Batch Processing - Sequential) ---
app.post("/generateAll", async (req, res) => {
    const { jsonArray, models, modelSwitchLimit } = req.body;

    if (!Array.isArray(jsonArray) || jsonArray.length === 0) {
        return res.status(400).json({ error: "Input must be a non-empty JSON array." });
    }
    if (!models || models.length === 0) {
        return res.status(400).json({ error: "Model list is required." });
    }
    const limit = parseInt(modelSwitchLimit, 10);

    let allResponses = [];
    let currentModelIndex = 0;
    let requestsInCurrentModel = 0;
    const modelCount = models.length;

    console.log(`\n--- Starting Sequential Batch Processing (${jsonArray.length} items) ---\n`);

    // Sequential processing loop: Process one item and await its result before starting the next.
    for (const obj of jsonArray) {
        // Model rotation logic
        if (requestsInCurrentModel >= limit) {
            currentModelIndex = (currentModelIndex + 1) % modelCount;
            requestsInCurrentModel = 0;
            console.log(`\n--- Model rotation point reached. Switching to Model: ${models[currentModelIndex]} ---\n`);
        }

        const modelToUse = models[currentModelIndex];
        
        // Extract key for logging and response reporting (first key of the object)
        const key = Object.keys(obj)[0] || 'Unknown Key';
        const value = obj; // Full object
        
        console.log(`[Item ${allResponses.length + 1}/${jsonArray.length}] Processing Key: ${key} (Model: ${modelToUse})`);

        // AWAIT processSingleEntry to ensure sequential execution
        const response = await processSingleEntry(key, value, modelToUse);
        allResponses.push(response);
        
        // Log cache hit/miss
        console.log(`  -> Status: ${response.cached ? 'CACHE HIT' : 'API CALL'}`);

        requestsInCurrentModel++;
    }

    console.log(`\n--- Sequential Batch Processing Finished ---\n`);
    res.json({ allResponses });
});


const PORT = 3000;
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
