
"use strict";

const express = require("express");
const cors = require("cors");
const { MongoClient, ObjectId } = require("mongodb");
const path = require("path");
const fs = require("fs");

require("dotenv").config({
  path: path.join(__dirname, ".env")
});

const app = express();
const PORT = process.env.PORT || 5000;
const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.DB_NAME || "EXPENSE_CLAIM";

const FRONTEND_DIR = path.resolve(__dirname, "..");

app.use(cors());
app.use(express.json({ limit: "10mb" }));

let claimsCollection;
let dropdownsCollection;

function databaseReady(res) {
  if (!claimsCollection || !dropdownsCollection) {
    res.status(503).json({
      success: false,
      message: "Database is not ready. Please try again."
    });
    return false;
  }
  return true;
}

function serializeDocument(document) {
  if (!document) return null;

  const { _id, ...data } = document;

  return {
    ...data,
    id: _id ? _id.toString() : data.id
  };
}

// Health check
app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "Expense Claim server is running."
  });
});

// Load claims
app.get("/api/claims", async (req, res) => {
  if (!databaseReady(res)) return;

  try {
    const documents = await claimsCollection
      .find({})
      .sort({ createdAt: -1 })
      .toArray();

    res.json({
      success: true,
      claims: documents.map(serializeDocument)
    });
  } catch (error) {
    console.error("Load claims error:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to load claims."
    });
  }
});

// Save new claim
app.post("/api/claims", async (req, res) => {
  if (!databaseReady(res)) return;

  try {
    const claim = req.body;

    if (!claim || typeof claim !== "object" || Array.isArray(claim)) {
      return res.status(400).json({
        success: false,
        message: "Invalid claim data."
      });
    }

    const { id, _id, ...claimData } = claim;
    const now = new Date().toISOString();

    const document = {
      ...claimData,
      createdAt: claimData.createdAt || now,
      updatedAt: now
    };

    const result = await claimsCollection.insertOne(document);
    const saved = await claimsCollection.findOne({
      _id: result.insertedId
    });

    res.status(201).json({
      success: true,
      message: "Claim saved successfully.",
      claim: serializeDocument(saved)
    });
  } catch (error) {
    console.error("Save claim error:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to save claim."
    });
  }
});

// Update claim
app.put("/api/claims/:id", async (req, res) => {
  if (!databaseReady(res)) return;

  try {
    const id = String(req.params.id || "").trim();
    const claim = req.body;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid claim ID."
      });
    }

    if (!claim || typeof claim !== "object" || Array.isArray(claim)) {
      return res.status(400).json({
        success: false,
        message: "Invalid claim data."
      });
    }

    const { id: bodyId, _id, createdAt, ...claimData } = claim;
    const objectId = new ObjectId(id);

    const result = await claimsCollection.updateOne(
      { _id: objectId },
      {
        $set: {
          ...claimData,
          updatedAt: new Date().toISOString()
        }
      }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Claim not found."
      });
    }

    const updated = await claimsCollection.findOne({
      _id: objectId
    });

    res.json({
      success: true,
      message: "Claim updated successfully.",
      claim: serializeDocument(updated)
    });
  } catch (error) {
    console.error("Update claim error:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to update claim."
    });
  }
});

// Delete claim
app.delete("/api/claims/:id", async (req, res) => {
  if (!databaseReady(res)) return;

  try {
    const id = String(req.params.id || "").trim();

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid claim ID."
      });
    }

    const result = await claimsCollection.deleteOne({
      _id: new ObjectId(id)
    });

    if (result.deletedCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Claim not found."
      });
    }

    res.json({
      success: true,
      message: "Claim deleted successfully."
    });
  } catch (error) {
    console.error("Delete claim error:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to delete claim."
    });
  }
});

// Load dropdown settings
app.get("/api/dropdowns", async (req, res) => {
  if (!databaseReady(res)) return;

  try {
    const document = await dropdownsCollection.findOne({
      key: "main"
    });

    res.json({
      success: true,
      dropdowns: document ? document.options : null
    });
  } catch (error) {
    console.error("Load dropdowns error:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to load dropdown options."
    });
  }
});

// Save dropdown settings
app.put("/api/dropdowns", async (req, res) => {
  if (!databaseReady(res)) return;

  try {
    const options = req.body;

    if (!options || typeof options !== "object" || Array.isArray(options)) {
      return res.status(400).json({
        success: false,
        message: "Invalid dropdown data."
      });
    }

    await dropdownsCollection.updateOne(
      { key: "main" },
      {
        $set: {
          options,
          updatedAt: new Date().toISOString()
        }
      },
      { upsert: true }
    );

    res.json({
      success: true,
      message: "Dropdown options saved successfully."
    });
  } catch (error) {
    console.error("Save dropdowns error:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to save dropdown options."
    });
  }
});

// Serve the frontend files
app.use(express.static(FRONTEND_DIR));

app.get("/", (req, res) => {
  const indexPath = path.join(FRONTEND_DIR, "index.html");

  if (!fs.existsSync(indexPath)) {
    return res.status(404).send("index.html was not found.");
  }

  res.sendFile(indexPath);
});

// JSON response for unknown API endpoints
app.use("/api", (req, res) => {
  res.status(404).json({
    success: false,
    message: "API endpoint not found."
  });
});

// Start server
async function startServer() {
  if (!MONGODB_URI) {
    console.error(
      "MONGODB_URI is missing. Set it in Render Environment Variables or server/.env."
    );
    process.exit(1);
  }

  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();

    const db = client.db(DB_NAME);

    claimsCollection = db.collection("claims");
    dropdownsCollection = db.collection("dropdowns");

    console.log("MongoDB connected successfully!");

    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Expense Claim server running on port ${PORT}`);
    });
  } catch (error) {
    console.error("MongoDB connection failed:", error.message);

    await client.close().catch(() => {});
    process.exit(1);
  }
}

startServer();
