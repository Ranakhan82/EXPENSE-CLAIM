
"use strict";

const express = require("express");
const cors = require("cors");
const { MongoClient, ObjectId } = require("mongodb");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const app = express();
const PORT = process.env.PORT || 5000;
const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.DB_NAME || "EXPENSE_CLAIM";

app.use(cors());
app.use(express.json({ limit: "10mb" }));

let claimsCollection;
let dropdownsCollection;

function cleanId(id) {
  return typeof id === "string" ? id.trim() : "";
}

function serializeClaim(doc) {
  return {
    ...doc,
    id: doc._id ? doc._id.toString() : doc.id,
    _id: undefined
  };
}

function serializeDropdown(doc) {
  return {
    ...doc,
    id: doc._id ? doc._id.toString() : doc.id,
    _id: undefined
  };
}

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "Expense Claim server is running."
  });
});

// Load all claims
app.get("/api/claims", async (req, res) => {
  try {
    const documents = await claimsCollection
      .find({})
      .sort({ createdAt: -1 })
      .toArray();

    res.json({
      success: true,
      claims: documents.map(serializeClaim)
    });
  } catch (error) {
    console.error("Load claims error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to load claims."
    });
  }
});

// Save a new claim
app.post("/api/claims", async (req, res) => {
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
      claim: serializeClaim(saved)
    });
  } catch (error) {
    console.error("Save claim error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to save claim."
    });
  }
});

// Update an existing claim
app.put("/api/claims/:id", async (req, res) => {
  try {
    const id = cleanId(req.params.id);
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

    const result = await claimsCollection.updateOne(
      { _id: new ObjectId(id) },
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
      _id: new ObjectId(id)
    });

    res.json({
      success: true,
      message: "Claim updated successfully.",
      claim: serializeClaim(updated)
    });
  } catch (error) {
    console.error("Update claim error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update claim."
    });
  }
});

// Delete a claim
app.delete("/api/claims/:id", async (req, res) => {
  try {
    const id = cleanId(req.params.id);

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
    console.error("Delete claim error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete claim."
    });
  }
});

// Load saved dropdown options
app.get("/api/dropdowns", async (req, res) => {
  try {
    const document = await dropdownsCollection.findOne({
      key: "main"
    });

    res.json({
      success: true,
      dropdowns: document ? document.options : null
    });
  } catch (error) {
    console.error("Load dropdowns error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to load dropdown options."
    });
  }
});

// Save/update dropdown options
app.put("/api/dropdowns", async (req, res) => {
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
    console.error("Save dropdowns error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to save dropdown options."
    });
  }
});

async function startServer() {
  if (!MONGODB_URI) {
    console.error("MONGODB_URI is missing. Check server/.env");
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
      console.log(`Expense Claim server running at http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error("MongoDB connection failed:", error);
    process.exit(1);
  }
}

startServer();
