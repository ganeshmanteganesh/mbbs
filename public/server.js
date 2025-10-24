const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const fs = require("fs");
const fetch = require("node-fetch"); // Node-fetch v2

const app = express();
app.use(cors());
app.use(bodyParser.json());

// Replace with your Gemini API key
const GEMINI_API_KEY = "YOUR_GEMINI_API_KEY";

// Ensure responses folder exists
if (!fs.existsSync("responses")) fs.mkdirSync("responses");

// Single prompt endpoint
app.post("/askGemini", async (req, res) => {
    const { prompt } = req.body;
    if (!prompt) return res.json({ error: "No prompt provided" });

    try {
        const response = await fetch("https://api.generative.ai/v1/models/text-bison-001:generate", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${GEMINI_API_KEY}`
            },
            body: JSON.stringify({
                prompt,
                temperature: 0.2,
                max_output_tokens: 1024
            })
        });

        const data = await response.json();
        const text = data?.candidates?.[0]?.content || "⚠️ No response";

        // Save to txt file
        const timestamp = Date.now();
        fs.writeFileSync(`responses/response_${timestamp}.txt`, text);

        res.json({ text });
    } catch (err) {
        console.error(err);
        res.json({ error: err.message });
    }
});

// Generate all responses endpoint
app.post("/generateAll", async (req, res) => {
    const { jsonArray } = req.body;
    if (!jsonArray || !Array.isArray(jsonArray)) return res.json({ error: "Invalid JSON array" });

    let allResponses = [];

    for (let obj of jsonArray) {
        const firstKey = Object.keys(obj)[0];
        const prompt = `You are an expert medical assistant. Explain this value in detail.
- ALL IMPORTANT MEDICAL TERMS in CAPITAL LETTERS
- Other words normal case

Value: ${JSON.stringify(obj[firstKey])}`;

        try {
            const response = await fetch("https://api.generative.ai/v1/models/text-bison-001:generate", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${GEMINI_API_KEY}`
                },
                body: JSON.stringify({
                    prompt,
                    temperature: 0.2,
                    max_output_tokens: 1024
                })
            });
            const data = await response.json();
            const text = data?.candidates?.[0]?.content || "⚠️ No response";

            allResponses.push({ key: firstKey, response: text });

            // Save each to file
            fs.writeFileSync(`responses/response_${firstKey}.txt`, text);
        } catch (err) {
            allResponses.push({ key: firstKey, response: "Error: " + err.message });
        }
    }

    res.json({ allResponses });
});

app.listen(3000, () => console.log("Server running on http://localhost:3000"));
