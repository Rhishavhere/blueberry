import * as dotenv from 'dotenv';
dotenv.config();

const apiKey = process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY;
if (!apiKey) {
  console.error("GEMINI_API_KEY or OPENAI_API_KEY not found in .env");
  process.exit(1);
}

const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

const parts = [
  { text: "Say hello and confirm you are working. Tell me your model name." }
];

console.log("Calling Gemini API...");

try {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts }] })
  });
  
  const data = await res.json();
  console.log("Response Status:", res.status);
  console.log("Response Data:", JSON.stringify(data, null, 2));
  
  if (data.candidates?.[0]?.content?.parts?.[0]?.text) {
    console.log("\nSuccess! Gemini says:");
    console.log(data.candidates[0].content.parts[0].text);
  } else {
    console.log("\nFailed to get text response.");
  }
} catch (e) {
  console.error("Error calling Gemini:", e);
}