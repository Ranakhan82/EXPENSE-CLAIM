"use strict";

/* =========================================================
   FAST EXPENSE CLAIM
   HTML IDs compatible with the provided index.html
   Storage: MongoDB through the Expense Claim API
   Legacy localStorage is read only for one-time migration
   Excel export: ExcelJS
========================================================= */

const STORAGE_KEYS = {
  claims: "fastExpenseClaims",
  dropdowns: "fastExpenseDropdowns"
};

const DEFAULT_OPTIONS = {
  costCenters: ["137113"],
  categories: [
    "Office Supplies",
    "Maintenance",
    "Travel",
    "Tools",
    "Safety Equipment"
  ],
  descriptions: [
    "Office Supplies",
    "Electrical Materials",
    "Safety Equipment"
  ],
  purposes: [
    "Office Use",
    "Maintenance",
    "Project Work"
  ]
};

// Use localhost API when opening the HTML file directly.
// Use relative /api when Express serves the page.
const API_BASE =
  window.location.protocol === "file:"
    ? "http://localhost:5000/api"
    : "/api";

// MongoDB is the main data source.
// localStorage is retained only for one-time migration.
const legacyClaims = loadJSON(STORAGE_KEYS.claims, []);
const legacyDropdowns = loadJSON(
  STORAGE_KEYS.dropdowns,
  DEFAULT_OPTIONS
);

let claims = [];
let dropdowns = structuredCloneSafe(DEFAULT_OPTIONS);
let currentItems = [];
let editingItemIndex = -1;
let editingClaimId = null;
let toastTimer = null;
let apiReady = false;

const $ = (selector) => document.querySelector(selector);

function loadJSON(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value
      ? JSON.parse(value)
      : structuredCloneSafe(fallback);
  } catch (error) {
    console.error("Could not read legacy browser data:", error);
    return structuredCloneSafe(fallback);
  }
}

function structuredCloneSafe(value) {
  return JSON.parse(JSON.stringify(value));
}

async function apiRequest(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  let result;

  try {
    result = await response.json();
  } catch {
    result = {};
  }

  if (!response.ok || result.success === false) {
    throw new Error(
      result.message ||
      result.error ||
      `API request failed (${response.status})`
    );
  }

  return result;
}

function normalizeClaim(claim) {
  const timestamp = nowISO();

  return {
    ...claim,

    id: String(claim.id || claim._id || makeId()),

    claimName: claim.claimName ?? "Untitled Claim",
    claimDate: claim.claimDate ?? "",
    costCenter: claim.costCenter ?? "",
    currency: claim.currency || "SAR",

    items: Array.isArray(claim.items)
      ? claim.items.map((item) => ({
          ...item,
          invoiceNumber:
            item.invoiceNumber ??
            item.supplierInvoiceNumber ??
            "",
          invoiceDate:
            item.invoiceDate ??
            item.supplierInvoiceDate ??
            "",
          description: item.description ?? "",
          purpose: item.purpose ?? "",
          category: item.category ?? "",
          amount: Number(item.amount) || 0,
          createdAt:
            item.createdAt ||
            claim.createdAt ||
            timestamp
        }))
      : [],

    createdAt: claim.createdAt || timestamp,

    updatedAt:
      claim.updatedAt ||
      claim.createdAt ||
      timestamp
  };
}

async function saveClaims() {
  // Kept for compatibility with existing call sites.
  // Create, update and delete actions use the API directly.
  return true;
}

async function saveDropdowns() {
  try {
    await apiRequest("/dropdowns", {
      method: "PUT",
      body: JSON.stringify(dropdowns)
    });

    return true;
  } catch (error) {
    console.error(
      "Could not save dropdown options to MongoDB:",
      error
    );

    showToast(
      `Dropdown options could not be saved to MongoDB: ${error.message}`,
      "error"
    );

    return false;
  }
}

function makeId() {
  return (
    "claim-" +
    Date.now() +
    "-" +
    Math.random().toString(36).slice(2, 9)
  );
}

async function loadServerData() {
  try {
    const [claimResult, dropdownResult] = await Promise.all([
      apiRequest("/claims"),
      apiRequest("/dropdowns")
    ]);

    claims = (
      Array.isArray(claimResult.claims)
        ? claimResult.claims
        : []
    ).map(normalizeClaim);

    const serverDropdowns = dropdownResult.dropdowns;

    dropdowns = {
      ...structuredCloneSafe(DEFAULT_OPTIONS),
      ...(serverDropdowns &&
      typeof serverDropdowns === "object"
        ? serverDropdowns
        : {})
    };

    for (const key of Object.keys(DEFAULT_OPTIONS)) {
      if (!Array.isArray(dropdowns[key])) {
        dropdowns[key] = [...DEFAULT_OPTIONS[key]];
      }
    }

    // Migrate old browser-saved claims only if MongoDB is empty.
    // The original localStorage data is not deleted.
    if (
      claims.length === 0 &&
      Array.isArray(legacyClaims) &&
      legacyClaims.length
    ) {
      const migrated = [];

      for (const oldClaim of legacyClaims) {
        const payload = normalizeClaim(oldClaim);

        // The server will generate the MongoDB claim ID.
        delete payload.id;

        const saved = await apiRequest("/claims", {
          method: "POST",
          body: JSON.stringify(payload)
        });

        if (saved.claim) {
          migrated.push(normalizeClaim(saved.claim));
        }
      }

      claims = migrated;
    }

    // Migrate old dropdown settings if the server has none.
    if (
      (!serverDropdowns ||
        typeof serverDropdowns !== "object") &&
      legacyDropdowns
    ) {
      dropdowns = {
        ...structuredCloneSafe(DEFAULT_OPTIONS),
        ...legacyDropdowns
      };

      for (const key of Object.keys(DEFAULT_OPTIONS)) {
        if (!Array.isArray(dropdowns[key])) {
          dropdowns[key] = [...DEFAULT_OPTIONS[key]];
        }
      }

      await saveDropdowns();
    }

    apiReady = true;

    renderDropdownInputs();
    renderDashboard();
    renderClaimsTable();
    renderManageDropdowns();

    return true;
  } catch (error) {
    apiReady = false;

    console.error(
      "Could not load Expense Claims from MongoDB:",
      error
    );

    showToast(
      `MongoDB connection failed. Start server/server.js and try again. ${error.message}`,
      "error"
    );

    return false;
  }
}

function nowISO() {
  return new Date().toISOString();
}

function localDateInputValue(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function formatDate(dateValue) {
  if (!dateValue) return "—";

  const date = new Date(dateValue);

  if (Number.isNaN(date.getTime())) {
    return String(dateValue);
  }

  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  });
}

function formatDateTime(dateValue) {
  if (!dateValue) return "—";

  const date = new Date(dateValue);

  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true
  });
}

function money(amount, currency = "SAR") {
  const value = Number(amount) || 0;

  return `${currency} ${value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function claimTotal(claim) {
  return (claim.items || []).reduce(
    (sum, item) => sum + (Number(item.amount) || 0),
    0
  );
}

function currentCurrency() {
  return $("#currency")?.value || "SAR";
}

function showToast(message, type = "success") {
  const toast = $("#toast");

  if (!toast) {
    alert(message);
    return;
  }

  toast.textContent = message;
  toast.className = `toast show ${type}`;

  clearTimeout(toastTimer);

  toastTimer = setTimeout(() => {
    toast.className = "toast";
  }, 3200);
}

/* =========================================================
   NAVIGATION
========================================================= */

const PAGE_INFO = {
  dashboard: {
    id: "dashboardPage",
    title: "Dashboard"
  },
  create: {
    id: "createPage",
    title: "Create Expense Claim"
  },
  invoices: {
    id: "invoicesPage",
    title: "Saved Claims"
  },
  manage: {
    id: "managePage",
    title: "Manage Dropdowns"
  }
};

function showPage(pageName) {
  const page = PAGE_INFO[pageName]
    ? pageName
    : "dashboard";

  document.querySelectorAll(".page").forEach((element) => {
    element.classList.remove("show");
  });

  $(`#${PAGE_INFO[page].id}`)?.classList.add("show");

  document.querySelectorAll(".nav").forEach((button) => {
    button.classList.toggle(
      "active",
      button.dataset.page === page
    );
  });

  const title = $("#pageTitle");

  if (title) {
    title.textContent = PAGE_INFO[page].title;
  }

  if (page === "dashboard") {
    renderDashboard();
  }

  if (page === "invoices") {
    renderClaimsTable();
  }

  if (page === "manage") {
    renderManageDropdowns();
  }

  window.scrollTo({
    top: 0,
    behavior: "smooth"
  });
}

document.querySelectorAll(".nav").forEach((button) => {
  button.addEventListener("click", () => {
    showPage(button.dataset.page);
  });
});

document.querySelectorAll("[data-goto]").forEach((button) => {
  button.addEventListener("click", () => {
    showPage(button.dataset.goto);
  });
});

$("#headerCreate")?.addEventListener("click", () => {
  startNewClaim();
});

$("#newFromList")?.addEventListener("click", () => {
  startNewClaim();
});

$("#cancelForm")?.addEventListener("click", () => {
  showPage("invoices");
});

/* =========================================================
   DROPDOWNS: SELECT EXISTING OR TYPE A NEW VALUE
========================================================= */

function ensureDropdownLists() {
  for (const key of Object.keys(DEFAULT_OPTIONS)) {
    if (!Array.isArray(dropdowns[key])) {
      dropdowns[key] = [...DEFAULT_OPTIONS[key]];
    }
  }
}

function fillDatalist(id, values) {
  const list = document.getElementById(id);

  if (!list) return;

  list.innerHTML = values
    .map(
      (value) =>
        `<option value="${escapeHTML(value)}"></option>`
    )
    .join("");
}

function renderDropdownInputs() {
  const allCenters = new Set(dropdowns.costCenters || []);

  claims.forEach((claim) => {
    if (claim.costCenter) {
      allCenters.add(claim.costCenter);
    }
  });

  fillDatalist(
    "costCenterOptions",
    [...allCenters].sort()
  );

  fillDatalist(
    "categoryOptions",
    dropdowns.categories || []
  );

  fillDatalist(
    "descriptionSuggestions",
    dropdowns.descriptions || []
  );

  fillDatalist(
    "purposeSuggestions",
    dropdowns.purposes || []
  );
}

function rememberOption(key, value) {
  const cleaned = String(value || "").trim();

  if (!cleaned || !Array.isArray(dropdowns[key])) {
    return;
  }

  const exists = dropdowns[key].some(
    (option) =>
      option.toLowerCase() === cleaned.toLowerCase()
  );

  if (!exists) {
    dropdowns[key].push(cleaned);

    if (apiReady) {
      void saveDropdowns();
    }
  }
}
function rememberClaimOptions(claim) {
  rememberOption("costCenters", claim.costCenter);

  (claim.items || []).forEach((item) => {
    rememberOption("categories", item.category);
    rememberOption("descriptions", item.description);
    rememberOption("purposes", item.purpose);
  });
}

/* =========================================================
   CLAIM FORM
========================================================= */

function startNewClaim() {
  editingClaimId = null;
  currentItems = [];
  editingItemIndex = -1;

  $("#invoiceForm")?.reset();
  if ($("#editId")) $("#editId").value = "";
  if ($("#claimDate")) $("#claimDate").value = localDateInputValue();
  if ($("#currency")) $("#currency").value = "SAR";
  if ($("#formTitle")) $("#formTitle").textContent = "Create Expense Claim";
  if ($("#saveClaim")) $("#saveClaim").textContent = "Save Claim";

  clearItemForm();
  renderDropdownInputs();
  renderCurrentItems();
  showPage("create");
}

function clearItemForm() {
  if ($("#itemInvoiceNumber")) $("#itemInvoiceNumber").value = "";
  if ($("#itemInvoiceDate")) $("#itemInvoiceDate").value = localDateInputValue();
  if ($("#itemDescription")) $("#itemDescription").value = "";
  if ($("#itemPurpose")) $("#itemPurpose").value = "";
  if ($("#itemAmount")) $("#itemAmount").value = "";
  if ($("#itemCategory")) $("#itemCategory").value = "";

  editingItemIndex = -1;

  const addButton = $("#addItem");
  if (addButton) addButton.textContent = "＋ Add Item";
}

function getClaimFormData() {
  const claimName = $("#claimName")?.value.trim() || "";
  const claimDate = $("#claimDate")?.value || localDateInputValue();
  const costCenter = $("#costCenter")?.value.trim() || "";
  const currency = $("#currency")?.value || "SAR";

  return {
    claimName: claimName || "Untitled Claim",
    claimDate,
    costCenter,
    currency
  };
}

function getItemFormData() {
  const invoiceNumber = $("#itemInvoiceNumber")?.value.trim() || "";
  const invoiceDate = $("#itemInvoiceDate")?.value || "";
  const description = $("#itemDescription")?.value.trim() || "";
  const purpose = $("#itemPurpose")?.value.trim() || "";
  const amountText = $("#itemAmount")?.value.trim() || "";
  const parsedAmount = amountText === "" ? 0 : Number(amountText);
  const amount =
    Number.isFinite(parsedAmount) && parsedAmount >= 0
      ? parsedAmount
      : 0;
  const category = $("#itemCategory")?.value.trim() || "";

  return {
    invoiceNumber,
    invoiceDate,
    description,
    purpose,
    amount,
    category
  };
}

$("#addItem")?.addEventListener("click", () => {
  const claimData = getClaimFormData();
  const itemData = getItemFormData();

  rememberOption("costCenters", claimData.costCenter);
  rememberOption("categories", itemData.category);
  rememberOption("descriptions", itemData.description);
  rememberOption("purposes", itemData.purpose);

  renderDropdownInputs();

  if (editingItemIndex >= 0) {
    currentItems[editingItemIndex] = {
      ...currentItems[editingItemIndex],
      ...itemData
    };
    showToast("Item updated.");
  } else {
    currentItems.push({
      ...itemData,
      createdAt: nowISO()
    });
    showToast("Item added to claim.");
  }

  renderCurrentItems();
  clearItemForm();
});

function renderCurrentItems() {
  const container = $("#itemCards");
  if (!container) return;

  if ($("#itemCount")) {
    $("#itemCount").textContent = currentItems.length;
  }

  if (!currentItems.length) {
    container.innerHTML =
      '<div class="empty">No items added yet.</div>';

    if ($("#formTotal")) {
      $("#formTotal").textContent = money(0, currentCurrency());
    }
    return;
  }

  container.innerHTML = currentItems.map((item, index) => `
    <article class="item-card">
      <div class="item-card-head">
        <div>
          <div class="item-card-title">
            ${index + 1}. ${escapeHTML(item.description || "Untitled Item")}
          </div>
          <div class="item-card-meta">
            Invoice: ${escapeHTML(item.invoiceNumber || "—")}
            &nbsp; | &nbsp; Date: ${escapeHTML(formatDate(item.invoiceDate))}
            <br>
            Category: ${escapeHTML(item.category || "—")}
          </div>
        </div>

        <div class="item-card-actions">
          <button class="light" type="button" data-edit-item="${index}">Edit</button>
          <button class="danger" type="button" data-delete-item="${index}">Delete</button>
        </div>
      </div>

      <div class="item-card-body">
        <div>
          <span>Purpose</span>
          <strong>${escapeHTML(item.purpose || "—")}</strong>
        </div>

        <div>
          <span>Amount</span>
          <strong>${escapeHTML(money(item.amount, currentCurrency()))}</strong>
        </div>

        <div>
          <span>Item Added</span>
          <strong class="timestamp">${escapeHTML(formatDateTime(item.createdAt))}</strong>
        </div>
      </div>
    </article>
  `).join("");

  if ($("#formTotal")) {
    $("#formTotal").textContent = money(
      currentItems.reduce(
        (sum, item) => sum + Number(item.amount || 0),
        0
      ),
      currentCurrency()
    );
  }

  container.querySelectorAll("[data-edit-item]").forEach((button) => {
    button.addEventListener("click", () => {
      editCurrentItem(Number(button.dataset.editItem));
    });
  });

  container.querySelectorAll("[data-delete-item]").forEach((button) => {
    button.addEventListener("click", () => {
      deleteCurrentItem(Number(button.dataset.deleteItem));
    });
  });
}

function editCurrentItem(index) {
  const item = currentItems[index];
  if (!item) return;

  editingItemIndex = index;

  if ($("#itemInvoiceNumber")) {
    $("#itemInvoiceNumber").value = item.invoiceNumber || "";
  }
  if ($("#itemInvoiceDate")) {
    $("#itemInvoiceDate").value = item.invoiceDate || "";
  }
  if ($("#itemDescription")) {
    $("#itemDescription").value = item.description || "";
  }
  if ($("#itemPurpose")) {
    $("#itemPurpose").value = item.purpose || "";
  }
  if ($("#itemAmount")) {
    $("#itemAmount").value = item.amount ?? "";
  }
  if ($("#itemCategory")) {
    $("#itemCategory").value = item.category || "";
  }
  if ($("#addItem")) {
    $("#addItem").textContent = "Update Item";
  }

  $("#itemDescription")?.focus();
}

function deleteCurrentItem(index) {
  if (!currentItems[index]) return;
  if (!confirm(`Delete item ${index + 1}?`)) return;

  currentItems.splice(index, 1);
  editingItemIndex = -1;

  renderCurrentItems();
  clearItemForm();
  showToast("Item deleted.");
}

$("#clearForm")?.addEventListener("click", () => {
  if (
    currentItems.length &&
    !confirm("Clear this claim form and its unsaved items?")
  ) {
    return;
  }

  startNewClaim();
});

/* =========================================================
   SAVE / UPDATE CLAIM
========================================================= */

$("#invoiceForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!apiReady) {
    showToast(
      "MongoDB server is not connected. Start the server and reload this page.",
      "error"
    );
    return;
  }

  const formData = getClaimFormData();

  if (editingItemIndex >= 0) {
    const itemData = getItemFormData();

    currentItems[editingItemIndex] = {
      ...currentItems[editingItemIndex],
      ...itemData
    };

    editingItemIndex = -1;
  } else {
    const invoiceNumber =
      $("#itemInvoiceNumber")?.value.trim() || "";
    const invoiceDate = $("#itemInvoiceDate")?.value || "";
    const description =
      $("#itemDescription")?.value.trim() || "";
    const purpose = $("#itemPurpose")?.value.trim() || "";
    const amountText = $("#itemAmount")?.value.trim() || "";
    const category = $("#itemCategory")?.value.trim() || "";

    const hasItemDetails = Boolean(
      invoiceNumber ||
      description ||
      purpose ||
      amountText ||
      category
    );

    if (hasItemDetails) {
      const parsedAmount =
        amountText === "" ? 0 : Number(amountText);

      const amount =
        Number.isFinite(parsedAmount) && parsedAmount >= 0
          ? parsedAmount
          : 0;

      currentItems.push({
        invoiceNumber,
        invoiceDate,
        description,
        purpose,
        amount,
        category,
        createdAt: nowISO()
      });
    }
  }

  const existing = editingClaimId
    ? claims.find((claim) => claim.id === editingClaimId)
    : null;

  const timestamp = nowISO();

  const claimPayload = {
    claimName: formData.claimName,
    claimDate: formData.claimDate,
    costCenter: formData.costCenter,
    currency: formData.currency,
    items: currentItems.map((item) => ({ ...item })),
    createdAt: existing?.createdAt || timestamp,
    updatedAt: timestamp
  };

  try {
    let result;

    if (existing) {
      result = await apiRequest(
        `/claims/${encodeURIComponent(existing.id)}`,
        {
          method: "PUT",
          body: JSON.stringify(claimPayload)
        }
      );
    } else {
      result = await apiRequest("/claims", {
        method: "POST",
        body: JSON.stringify(claimPayload)
      });
    }

    if (!result.claim) {
      throw new Error("The server did not return the saved claim.");
    }

    const claim = normalizeClaim(result.claim);

    if (existing) {
      const index = claims.findIndex(
        (entry) => entry.id === existing.id
      );

      if (index >= 0) {
        claims[index] = claim;
      } else {
        claims.unshift(claim);
      }
    } else {
      claims.unshift(claim);
    }

    rememberClaimOptions(claim);
    await saveDropdowns();

    renderDropdownInputs();
    renderDashboard();
    renderClaimsTable();

    editingClaimId = claim.id;

    if ($("#editId")) {
      $("#editId").value = claim.id;
    }

    showToast(
      existing
        ? "Claim updated successfully in MongoDB."
        : "Claim saved successfully to MongoDB."
    );

    showPage("invoices");
  } catch (error) {
    console.error("Claim save/update failed:", error);

    showToast(
      `Claim was not saved. ${error.message}`,
      "error"
    );
  }
});

/* =========================================================
   EDIT EXISTING CLAIM
========================================================= */

function editClaim(id) {
  const claim = claims.find((entry) => entry.id === id);
  if (!claim) return;

  editingClaimId = claim.id;
  currentItems = (claim.items || []).map((item) => ({ ...item }));
  editingItemIndex = -1;

  $("#invoiceForm")?.reset();

  if ($("#editId")) $("#editId").value = claim.id;
  if ($("#claimName")) $("#claimName").value = claim.claimName || "";
  if ($("#claimDate")) $("#claimDate").value = claim.claimDate || "";
  if ($("#costCenter")) $("#costCenter").value = claim.costCenter || "";
  if ($("#currency")) $("#currency").value = claim.currency || "SAR";

  if ($("#formTitle")) {
    $("#formTitle").textContent = "Edit Expense Claim";
  }

  if ($("#saveClaim")) {
    $("#saveClaim").textContent = "Update Claim";
  }

  clearItemForm();
  renderDropdownInputs();
  renderCurrentItems();
  showPage("create");
}

/* =========================================================
   DELETE CLAIM
========================================================= */

async function deleteClaim(id) {
  const claim = claims.find((entry) => entry.id === id);
    try {
    await apiRequest(`/claims/${encodeURIComponent(id)}`, {
      method: "DELETE"
    });

    claims = claims.filter((entry) => entry.id !== id);

    if (editingClaimId === id) {
      editingClaimId = null;
      currentItems = [];
      editingItemIndex = -1;
    }

    renderDashboard();
    renderClaimsTable();
    renderDropdownInputs();

    showToast("Claim deleted from MongoDB.");
  } catch (error) {
    console.error("Claim delete failed:", error);
    showToast(`Claim was not deleted. ${error.message}`, "error");
  }
}

/* =========================================================
   CLAIM TABLE AND SEARCH
========================================================= */

function renderClaimsTable() {
  const container = $("#invoiceTable");
  if (!container) return;

  const query = ($("#invoiceSearch")?.value || "")
    .trim()
    .toLowerCase();

  const filtered = claims.filter((claim) => {
    const itemText = (claim.items || [])
      .map((item) => [
        item.invoiceNumber,
        item.description,
        item.purpose,
        item.category
      ].join(" "))
      .join(" ");

    const searchable = [
      claim.claimName,
      claim.claimDate,
      claim.costCenter,
      itemText
    ].join(" ").toLowerCase();

    return searchable.includes(query);
  });

  if (!filtered.length) {
    container.innerHTML =
      '<div class="empty">No matching claims found.</div>';
    return;
  }

  container.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>SL</th>
            <th>Claim Name / Number</th>
            <th>Claim Date</th>
            <th>Cost Center</th>
            <th>Items</th>
            <th>Total Amount</th>
            <th>Created Date &amp; Time</th>
            <th>Last Updated</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${filtered.map((claim) => `
            <tr>
              <td>${claims.indexOf(claim) + 1}</td>
              <td><strong>${escapeHTML(claim.claimName || "Untitled Claim")}</strong></td>
              <td>${escapeHTML(formatDate(claim.claimDate))}</td>
              <td>${escapeHTML(claim.costCenter || "—")}</td>
              <td>${(claim.items || []).length}</td>
              <td class="amount-cell">${escapeHTML(money(claimTotal(claim), claim.currency))}</td>
              <td><span class="timestamp">${escapeHTML(formatDateTime(claim.createdAt))}</span></td>
              <td><span class="timestamp">${escapeHTML(formatDateTime(claim.updatedAt))}</span></td>
              <td>
                <div class="table-actions">
                  <button class="light" type="button" data-view-claim="${escapeHTML(claim.id)}">View</button>
                  <button class="light" type="button" data-edit-claim="${escapeHTML(claim.id)}">Edit</button>
                  <button class="danger" type="button" data-delete-claim="${escapeHTML(claim.id)}">Delete</button>
                </div>
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;

  container.querySelectorAll("[data-view-claim]").forEach((button) => {
    button.addEventListener("click", () => {
      viewClaim(button.dataset.viewClaim);
    });
  });

  container.querySelectorAll("[data-edit-claim]").forEach((button) => {
    button.addEventListener("click", () => {
      editClaim(button.dataset.editClaim);
    });
  });

  container.querySelectorAll("[data-delete-claim]").forEach((button) => {
    button.addEventListener("click", () => {
      deleteClaim(button.dataset.deleteClaim);
    });
  });
}

$("#invoiceSearch")?.addEventListener("input", renderClaimsTable);

/* =========================================================
   VIEW CLAIM DETAILS
========================================================= */

function openModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;

  modal.classList.add("show");
  modal.setAttribute("aria-hidden", "false");
}

function closeModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;

  modal.classList.remove("show");
  modal.setAttribute("aria-hidden", "true");
}

$("#closeModal")?.addEventListener("click", () => {
  closeModal("modal");
});

$("#modal")?.addEventListener("click", (event) => {
  if (event.target.id === "modal") {
    closeModal("modal");
  }
});

$("#closeExportModal")?.addEventListener("click", () => {
  closeModal("exportModal");
});

$("#cancelExport")?.addEventListener("click", () => {
  closeModal("exportModal");
});

$("#exportModal")?.addEventListener("click", (event) => {
  if (event.target.id === "exportModal") {
    closeModal("exportModal");
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeModal("modal");
    closeModal("exportModal");
  }
});

function viewClaim(id) {
  const claim = claims.find((entry) => entry.id === id);
  if (!claim) return;

  const modalContent = $("#modalContent");
  if (!modalContent) return;

  modalContent.innerHTML = `
    <div class="detail-grid">
      <div class="detail-box">
        <span>Claim Name / Number</span>
        <strong>${escapeHTML(claim.claimName || "Untitled Claim")}</strong>
      </div>
      <div class="detail-box">
        <span>Claim Date</span>
        <strong>${escapeHTML(formatDate(claim.claimDate))}</strong>
      </div>
      <div class="detail-box">
        <span>Cost Center</span>
        <strong>${escapeHTML(claim.costCenter || "—")}</strong>
      </div>
      <div class="detail-box">
        <span>Total</span>
        <strong>${escapeHTML(money(claimTotal(claim), claim.currency))}</strong>
      </div>
      <div class="detail-box">
        <span>Created Date &amp; Time</span>
        <strong>${escapeHTML(formatDateTime(claim.createdAt))}</strong>
      </div>
      <div class="detail-box">
        <span>Last Updated Date &amp; Time</span>
        <strong>${escapeHTML(formatDateTime(claim.updatedAt))}</strong>
      </div>
    </div>

    <h3 style="margin-bottom:12px">Claim Items</h3>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>SL</th>
            <th>Invoice Number</th>
            <th>Invoice Date</th>
            <th>Item Description</th>
            <th>Purpose</th>
            <th>Category</th>
            <th>Amount</th>
            <th>Item Added Date &amp; Time</th>
          </tr>
        </thead>
        <tbody>
          ${(claim.items || []).map((item, index) => `
            <tr>
              <td>${index + 1}</td>
              <td>${escapeHTML(item.invoiceNumber || "—")}</td>
              <td>${escapeHTML(formatDate(item.invoiceDate))}</td>
              <td>${escapeHTML(item.description || "—")}</td>
              <td>${escapeHTML(item.purpose || "—")}</td>
              <td>${escapeHTML(item.category || "—")}</td>
              <td>${escapeHTML(money(item.amount, claim.currency))}</td>
              <td>${escapeHTML(formatDateTime(item.createdAt))}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;

  openModal("modal");
}

/* =========================================================
   DASHBOARD
========================================================= */

function renderDashboard() {
  const totalItems = claims.reduce(
    (sum, claim) => sum + (claim.items || []).length,
    0
  );

  const totalAmount = claims.reduce(
    (sum, claim) => sum + claimTotal(claim),
    0
  );

  const centers = new Set(
    claims.map((claim) => claim.costCenter).filter(Boolean)
  );

  if ($("#statInvoices")) {
    $("#statInvoices").textContent = claims.length;
  }

  if ($("#statItems")) {
    $("#statItems").textContent = totalItems;
  }

  if ($("#statAmount")) {
    $("#statAmount").textContent = money(totalAmount, "SAR");
  }

  if ($("#statCenters")) {
    $("#statCenters").textContent = centers.size;
  }

  const container = $("#recentTable");
  if (!container) return;

  const recent = [...claims]
    .sort(
      (a, b) =>
        new Date(b.createdAt || 0) -
        new Date(a.createdAt || 0)
    )
    .slice(0, 5);

  if (!recent.length) {
    container.innerHTML =
      '<div class="empty">No saved claims yet. Click Create New to begin.</div>';
    return;
  }

  container.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Claim Name / Number</th>
            <th>Claim Date</th>
            <th>Cost Center</th>
            <th>Items</th>
            <th>Total Amount</th>
            <th>Created Date &amp; Time</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          ${recent.map((claim) => `
            <tr>
              <td><strong>${escapeHTML(claim.claimName || "Untitled Claim")}</strong></td>
              <td>${escapeHTML(formatDate(claim.claimDate))}</td>
              <td>${escapeHTML(claim.costCenter || "—")}</td>
              <td>${(claim.items || []).length}</td>
              <td class="amount-cell">${escapeHTML(money(claimTotal(claim), claim.currency))}</td>
              <td><span class="timestamp">${escapeHTML(formatDateTime(claim.createdAt))}</span></td>
              <td>
                <button type="button" class="light" data-dashboard-view="${escapeHTML(claim.id)}">View</button>
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;

  container.querySelectorAll("[data-dashboard-view]").forEach((button) => {
    button.addEventListener("click", () => {
      viewClaim(button.dataset.dashboardView);
    });
  });
}

/* =========================================================
   MANAGE DROPDOWNS
========================================================= */

const MANAGE_CONFIG = [
  {
    key: "costCenters",
    title: "Cost Centers",
    description: "Cost Center options for claims."
  },
  {
    key: "categories",
    title: "Categories",
    description: "Categories for expense items."
  },
  {
    key: "descriptions",
    title: "Item Descriptions",
    description: "Reusable descriptions for items."
  },
  {
    key: "purposes",
    title: "Purposes",
    description: "Reusable purposes for items."
  }
];

function renderManageDropdowns() {
  const container = $("#manageCards");
  if (!container) return;

  container.innerHTML = MANAGE_CONFIG.map((config) => `
    <div class="manage-card">
      <h3>${escapeHTML(config.title)}</h3>
      <p>${escapeHTML(config.description)}</p>

      <form class="manage-add" data-manage-form="${config.key}">
        <input name="option" placeholder="Enter new option" required>
        <button class="primary" type="submit">Add</button>
      </form>

      <div class="manage-options">
        ${(dropdowns[config.key] || []).map((option, index) => `
          <div class="manage-option">
            <span>${escapeHTML(option)}</span>
            <button
              class="danger"
              type="button"
              data-remove-option="${config.key}"
              data-option-index="${index}"
            >Delete</button>
          </div>
        `).join("") || '<div class="empty">No options added yet.</div>'}
      </div>
    </div>
  `).join("");

  container.querySelectorAll("[data-manage-form]").forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();

      if (!apiReady) {
        showToast(
          "MongoDB server is not connected. Dropdown was not saved.",
          "error"
        );
        return;
      }

      const key = form.dataset.manageForm;
      const input = form.elements.option;
      const value = input.value.trim();

      if (!value) return;

      const exists = dropdowns[key].some(
        (option) => option.toLowerCase() === value.toLowerCase()
      );

      if (exists) {
        showToast("This option already exists.", "error");
        return;
      }

      dropdowns[key].push(value);

      if (!(await saveDropdowns())) {
        dropdowns[key].pop();
        renderManageDropdowns();
        return;
      }

      renderDropdownInputs();
      renderManageDropdowns();
      showToast("Dropdown option added.");
    });
  });

  container.querySelectorAll("[data-remove-option]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!apiReady) {
        showToast(
          "MongoDB server is not connected. Dropdown was not deleted.",
          "error"
        );
        return;
      }

      const key = button.dataset.removeOption;
      const index = Number(button.dataset.optionIndex);
      const value = dropdowns[key]?.[index];

      if (!value) return;

      if (!confirm(`Delete option "${value}" from Manage Dropdowns?`)) {
        return;
      }

      dropdowns[key].splice(index, 1);

      if (!(await saveDropdowns())) {
        dropdowns[key].splice(index, 0, value);
        renderManageDropdowns();
        return;
      }

      renderDropdownInputs();
      renderManageDropdowns();
      showToast("Dropdown option deleted.");
    });
  });
}

/* =========================================================
   EXCEL EXPORT: SELECT COST CENTER THEN CLAIM
========================================================= */

$("#exportExcel")?.addEventListener("click", () => {
  openExportDialog();
});

function openExportDialog() {
  if (!claims.length) {
    showToast("There are no saved claims to export.", "error");
    return;
  }

  const centerSelect = $("#exportCostCenter");
  const claimSelect = $("#exportClaim");

  if (!centerSelect || !claimSelect) {
    showToast(
      "Export selection controls are missing from the HTML.",
      "error"
    );
    return;
  }

  const centers = [
    ...new Set(
      claims.map((claim) => claim.costCenter).filter(Boolean)
    )
  ];

  centerSelect.innerHTML =
    '<option value="">Select Cost Center</option>' +
    centers.map((center) => `
      <option value="${escapeHTML(center)}">
        ${escapeHTML(center)}
      </option>
    `).join("");

  claimSelect.innerHTML = '<option value="">Select Claim</option>';

  if ($("#exportInfo")) {
    $("#exportInfo").textContent =
      "Select a Cost Center, then choose a Claim. All items inside that claim will be exported.";
  }

  openModal("exportModal");
}

$("#exportCostCenter")?.addEventListener("change", () => {
  const center = $("#exportCostCenter").value;
  const claimSelect = $("#exportClaim");

  if (!claimSelect) return;

  const matchingClaims = claims.filter(
    (claim) => claim.costCenter === center
  );

  claimSelect.innerHTML =
    '<option value="">Select Claim</option>' +
    matchingClaims.map((claim) => `
      <option value="${escapeHTML(claim.id)}">
        ${escapeHTML(claim.claimName || "Untitled Claim")} —
        ${escapeHTML(formatDate(claim.claimDate))}
      </option>
    `).join("");

  if ($("#exportInfo")) {
    $("#exportInfo").textContent = center
      ? `${matchingClaims.length} claim(s) found for Cost Center ${center}. Select one claim to export all its items.`
      : "Select a Cost Center, then choose a Claim.";
  }
});
/* =========================================================
   EXCEL EXPORT
========================================================= */

$("#exportExcel")?.addEventListener("click", openExportDialog);

function openExportDialog() {
  if (!claims.length) {
    showToast("There are no saved claims to export.", "error");
    return;
  }

  const centerSelect = $("#exportCostCenter");
  const claimSelect = $("#exportClaim");

  if (!centerSelect || !claimSelect) {
    showToast("Excel export controls were not found.", "error");
    return;
  }

  const centers = [
    ...new Set(claims.map((claim) => claim.costCenter).filter(Boolean))
  ];

  centerSelect.innerHTML =
    '<option value="">Select Cost Center</option>' +
    centers.map((center) =>
      `<option value="${escapeHTML(center)}">${escapeHTML(center)}</option>`
    ).join("");

  claimSelect.innerHTML = '<option value="">Select Claim</option>';

  if ($("#exportInfo")) {
    $("#exportInfo").textContent =
      "Select a Cost Center, then choose a Claim. All items inside that claim will be exported.";
  }

  openModal("exportModal");
}

$("#exportCostCenter")?.addEventListener("change", () => {
  const center = $("#exportCostCenter").value;
  const claimSelect = $("#exportClaim");
  if (!claimSelect) return;

  const matchingClaims = claims.filter(
    (claim) => claim.costCenter === center
  );

  claimSelect.innerHTML =
    '<option value="">Select Claim</option>' +
    matchingClaims.map((claim) => `
      <option value="${escapeHTML(claim.id)}">
        ${escapeHTML(claim.claimName || "Untitled Claim")} — ${escapeHTML(formatDate(claim.claimDate))}
      </option>
    `).join("");

  if ($("#exportInfo")) {
    $("#exportInfo").textContent = center
      ? `${matchingClaims.length} claim(s) found for Cost Center ${center}. Select one claim to export all its items.`
      : "Select a Cost Center, then choose a Claim.";
  }
});

$("#exportClaim")?.addEventListener("change", () => {
  const claim = claims.find(
    (entry) => entry.id === $("#exportClaim")?.value
  );

  if ($("#exportInfo")) {
    $("#exportInfo").textContent = claim
      ? `Selected: ${claim.claimName} | Cost Center: ${claim.costCenter || "—"} | Items: ${(claim.items || []).length} | Total: ${money(claimTotal(claim), claim.currency)}`
      : "Select a Cost Center and Claim to export all items.";
  }
});

$("#confirmExport")?.addEventListener("click", async () => {
  const center = $("#exportCostCenter")?.value;
  const claimId = $("#exportClaim")?.value;

  if (!center || !claimId) {
    showToast("Please select both Cost Center and Claim.", "error");
    return;
  }

  const claim = claims.find(
    (entry) => entry.id === claimId && entry.costCenter === center
  );

  if (!claim) {
    showToast("The selected claim could not be found.", "error");
    return;
  }

  if (!window.ExcelJS) {
    showToast(
      "Excel library did not load. Check your internet connection and reopen the page.",
      "error"
    );
    return;
  }

  try {
    await exportClaimToExcel(claim);
    closeModal("exportModal");
    showToast("Excel file created successfully.");
  } catch (error) {
    console.error("Excel export failed:", error);
    showToast("Excel export failed. Please try again.", "error");
  }
});

async function exportClaimToExcel(claim) {
  const workbook = new ExcelJS.Workbook();

  workbook.creator = "EXPENSE CLAIM";
  workbook.created = new Date();
  workbook.modified = new Date();

  const items = Array.isArray(claim.items) ? claim.items : [];

  const totalAmount = items.reduce(
    (sum, item) => sum + (Number(item.amount) || 0),
    0
  );

  const black = "FF000000";
  const white = "FFFFFFFF";
  const navy = "FF14213D";
  const blue = "FF3563E9";
  const lightBlue = "FFDCE7FF";
  const grey = "FFE7E7E7";
  const red = "FFFF0000";

  const moneyFormat = '#,##0.00;[Red]-#,##0.00';

  const thinBorder = {
    top: { style: "thin", color: { argb: black } },
    bottom: { style: "thin", color: { argb: black } },
    left: { style: "thin", color: { argb: black } },
    right: { style: "thin", color: { argb: black } }
  };

  const mediumBorder = {
    top: { style: "medium", color: { argb: black } },
    bottom: { style: "medium", color: { argb: black } },
    left: { style: "medium", color: { argb: black } },
    right: { style: "medium", color: { argb: black } }
  };

  /* ======================================================
     SHEET 1: EXPENSE CLAIM
  ====================================================== */

  const sheet = workbook.addWorksheet("Expense Claim", {
    views: [{ state: "frozen", ySplit: 3 }]
  });

  sheet.columns = [
    { width: 7 },
    { width: 15 },
    { width: 13 },
    { width: 15 },
    { width: 17 },
    { width: 24 },
    { width: 25 },
    { width: 17 },
    { width: 16 }
  ];

  sheet.mergeCells("A1:I1");

  const titleCell = sheet.getCell("A1");
  titleCell.value =
    `SUMMARY OF GENERAL EXPENSE CLAIM IN KSP- PROJECT COST CENTER ${claim.costCenter || ""}`;
  titleCell.font = {
    bold: true,
    size: 14,
    color: { argb: white }
  };
  titleCell.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: navy }
  };
  titleCell.alignment = {
    horizontal: "center",
    vertical: "middle"
  };
  sheet.getRow(1).height = 30;

  sheet.mergeCells("A2:I2");

  const dateCell = sheet.getCell("A2");
  dateCell.value = `Date: ${formatDate(localDateInputValue())}`;
  dateCell.font = { bold: true, size: 10 };
  dateCell.alignment = {
    horizontal: "right",
    vertical: "middle"
  };
  sheet.getRow(2).height = 20;

  const headers = [
    "S/N",
    "INVOICE #",
    "DATE #",
    "SUPPLIER NAME",
    "ITEM # IN THE INVOICE",
    "ITEM DESCRIPTION",
    "PURPOSE OF ITEMS PURCHASED",
    "AMOUNT OF THE ITEM",
    "CATEGORY"
  ];

  const headerRow = sheet.getRow(3);
  headerRow.values = headers;
  headerRow.height = 38;

  headerRow.eachCell({ includeEmpty: true }, (cell) => {
    cell.font = {
      bold: true,
      size: 9,
      color: { argb: white }
    };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: blue }
    };
    cell.alignment = {
      horizontal: "center",
      vertical: "middle",
      wrapText: true
    };
    cell.border = { ...thinBorder };
  });

  const supplierSerials = new Map();
  let nextSupplierNumber = 1;

  items.forEach((item, index) => {
    const invoiceNumber = String(item.invoiceNumber || "").trim();
    let supplierName;

    if (invoiceNumber) {
      const key = invoiceNumber.toLowerCase();

      if (!supplierSerials.has(key)) {
        supplierSerials.set(key, `S${nextSupplierNumber++}`);
      }

      supplierName = supplierSerials.get(key);
    } else {
      supplierName = `S${nextSupplierNumber++}`;
    }

    const row = sheet.addRow([
      index + 1,
      invoiceNumber,
      item.invoiceDate ? formatDate(item.invoiceDate) : "",
      supplierName,
      1,
      item.description || "",
      item.purpose || "",
      Number(item.amount) || 0,
      item.category || ""
    ]);

    row.height = 20;

    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.alignment = {
        horizontal: "center",
        vertical: "middle",
        wrapText: false
      };
      cell.border = { ...thinBorder };
    });

    row.getCell(8).numFmt = moneyFormat;
  });

  const totalRowNumber = sheet.rowCount + 1;

  sheet.mergeCells(`A${totalRowNumber}:F${totalRowNumber}`);
  sheet.mergeCells(`H${totalRowNumber}:I${totalRowNumber}`);

  const totalRow = sheet.getRow(totalRowNumber);
  totalRow.getCell(7).value = "GRAND TOTAL";
  totalRow.getCell(8).value = totalAmount;
  totalRow.height = 24;

  for (let c = 1; c <= 9; c++) {
    const cell = totalRow.getCell(c);
    cell.font = { bold: true };
    cell.border = { ...thinBorder };
    cell.alignment = {
      horizontal: c === 7 ? "right" : "center",
      vertical: "middle"
    };
  }

  totalRow.getCell(8).numFmt = moneyFormat;

  for (let r = 1; r <= sheet.rowCount; r++) {
    for (let c = 1; c <= 9; c++) {
      const cell = sheet.getRow(r).getCell(c);

      cell.border = {
        ...cell.border,
        ...(r === 1 ? { top: mediumBorder.top } : {}),
        ...(r === sheet.rowCount
          ? { bottom: mediumBorder.bottom }
          : {}),
        ...(c === 1 ? { left: mediumBorder.left } : {}),
        ...(c === 9 ? { right: mediumBorder.right } : {})
      };
    }
  }

  sheet.autoFilter = {
    from: "A3",
    to: "I3"
  };

  sheet.pageSetup = {
    orientation: "landscape",
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    paperSize: 9,
    margins: {
      left: 0.25,
      right: 0.25,
      top: 0.5,
      bottom: 0.5,
      header: 0.2,
      footer: 0.2
    },
    printTitlesRow: "1:3"
  };

  /* ======================================================
     COVER PAGE CATEGORY DEFINITIONS
     LEFT SECTION: A, B, C
     RIGHT SECTION: D, E, F
     TOTAL COLUMNS: A:F ONLY
  ====================================================== */

  const leftSections = [
    {
      code: "A",
      title: "A) Business Trip Expenses",
      rows: [
        ["450031", "1. Accommodation Expenses"],
        ["450031", "2. Food & Beverage"],
        ["450031", "3. Transportation Expenses"],
        ["450031", "4. Visa Expenses"],
        ["450031", "5. Trip Air Fare"],
        ["450031", "6. Car Fuel"],
        ["450031", "7. Parking & Causeway"]
      ]
    },
    {
      code: "B",
      title: "B) Employee Personal Expenses",
      rows: [
        ["420045", "1. Accommodation Expenses/Maintenance"],
        ["420046", "2. Personal Catering Expenses"],
        ["450029", "3. Individual Communication Expenses"],
        ["450065", "4. Car Rental/Repair/Fuel or Transportation"],
        ["420015", "5. Medical Expenses"],
        ["420037", "6. Uniform/Safety Gear/PPE"],
        ["420027", "7. Employee's Government Fees"],
        ["420061", "8. Fine (Traffic Or Others)"],
        ["420047", "9. Training"],
        ["420047", "10. Cost of Tickets / Tours (TRD)"]
      ]
    },
    {
      code: "C",
      title: "C) Equipment & Vehicles",
      rows: [
        ["450066", "1. Bus: Rental / Repair / Fuel"],
        ["450046", "2. Transportation of Materials or Equipment"],
        ["450061", "3. Direct Equipment: Rental / Repair / Fuel"],
        ["450051", "4. Indirect Equipment: Rental / Repair / Fuel"]
      ]
    }
  ];

  const rightSections = [
    {
      code: "D",
      title: "D) Running Costs",
      rows: [
        ["450018", "1. Stationery & Photocopying Expenses"],
        ["450018", "2. Offices Equipment or Furniture"],
        ["420046", "3. Offices Refreshment & Pantry Expenses"],
        ["450029", "4. Offices Internet"],
        ["450021", "5. Site Disposals & Septic Services"],
        ["410017", "6. Cleaning & Maintenance of Site Offices"],
        ["450028", "7. Washing Water"],
        ["420015", "8. Medical & Clinical Materials"]
      ]
    },
    {
      code: "E",
      title: "E) Construction Costs",
      rows: [
        ["420015", "1. Laydown Construction Materials / Works"],
        ["410027", "2. Safety Materials on Site (Non-Personal)"],
        ["410027", "3. Construction Tools"],
        ["410002", "4. Site Direct Civil Materials/Works"],
        ["410002", "5. Site Direct Low Current Materials/Works"],
        ["410002", "6. Site Direct Electrical Materials/Works"],
        ["410002", "7. Site Direct Mechanical Materials/Works"],
        ["450028", "8. Water For Construction"],
        ["420057", "9. Manpower / Rental Wages"],
        ["420046", "10. Ice, Drinking Water, or Food for Labors"]
      ]
    },
    {
      code: "F",
      title: "F) Other Services",
      rows: [
        ["420046", "1. Freight & Clearance Charges"],
        ["410027", "2. Materials Testing"],
        ["410002", "3. Other Incidental Expenses"]
      ]
    }
  ];

  const cover = workbook.addWorksheet("Cover Page");

  // Six columns only: A,B,C | D,E,F
  // No separate blank column.
  cover.columns = [
    { width: 11 }, // A: GL Code
    { width: 25 }, // B: Description
    { width: 12 }, // C: Amount
    { width: 11 }, // D: GL Code
    { width: 25 }, // E: Description
    { width: 12 }  // F: Amount
  ];

  function styleCell(cell, options = {}) {
    cell.border = { ...thinBorder };

    cell.alignment = {
      vertical: "middle",
      horizontal: options.align || "left",
      wrapText: options.wrapText ?? false
    };

    if (options.bold) {
      cell.font = { ...(cell.font || {}), bold: true };
    }

    if (options.fill) {
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: options.fill }
      };
    }
  }

  function setCoverCell(address, value, options = {}) {
    const cell = cover.getCell(address);
    cell.value = value;
    styleCell(cell, options);
    return cell;
  }

  function mergeLabelValue(labelRange, valueRange, label, value = "") {
    if (labelRange.includes(":")) {
      cover.mergeCells(labelRange);
    }

    if (valueRange.includes(":")) {
      cover.mergeCells(valueRange);
    }

    const labelCell = cover.getCell(labelRange.split(":")[0]);
    labelCell.value = label;
    labelCell.font = { bold: true, size: 9 };
    labelCell.alignment = {
      vertical: "middle",
      horizontal: "left",
      wrapText: true
    };

    const valueCell = cover.getCell(valueRange.split(":")[0]);
    valueCell.value = value;
    valueCell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: lightBlue }
    };
    valueCell.alignment = {
      vertical: "middle",
      horizontal: "left",
      wrapText: true
    };

    for (const range of [labelRange, valueRange]) {
      const [start, end] = range.split(":");
      const startCell = cover.getCell(start);
      const endCell = cover.getCell(end || start);

      for (let r = startCell.row; r <= endCell.row; r++) {
        for (let c = startCell.col; c <= endCell.col; c++) {
          styleCell(cover.getRow(r).getCell(c));
        }
      }
    }
  }

  /* ======================================================
     COVER TITLE / COMPANY HEADER
  ====================================================== */

  cover.mergeCells("A1:C2");
  cover.mergeCells("D1:F2");

  const logoCell = cover.getCell("A1");
  logoCell.value = "NESMA\nUNITED INDUSTRIES";
  logoCell.font = {
    bold: true,
    size: 18,
    color: { argb: "FF222222" }
  };
  logoCell.alignment = {
    horizontal: "center",
    vertical: "middle",
    wrapText: true
  };

  const coverTitle = cover.getCell("D1");
  coverTitle.value = "GENERAL EXPENSE CLAIM";
  coverTitle.font = {
    bold: true,
    size: 14,
    name: "Times New Roman"
  };
  coverTitle.alignment = {
    horizontal: "center",
    vertical: "middle",
    wrapText: true
  };

  for (let r = 1; r <= 2; r++) {
    for (let c = 1; c <= 6; c++) {
      styleCell(cover.getRow(r).getCell(c));
    }
  }

  cover.getRow(1).height = 30;
  cover.getRow(2).height = 26;

  /* ======================================================
     EMPLOYEE / CLAIM INFORMATION
  ====================================================== */

  mergeLabelValue("A3:A3", "B3:C3", "NAME:");
  mergeLabelValue("D3:D3", "E3:F3", "DATE:", formatDate(claim.claimDate));

  mergeLabelValue("A4:A4", "B4:C4", "ID NO:");
  mergeLabelValue("D4:D4", "E4:F4", "POSITION:");

  mergeLabelValue("A5:A5", "B5:C5", "DIVISION:", "137: LANDSCAPING");
  mergeLabelValue("D5:E5", "F5:F5", "PROJECT / DEPT. COST CENTER:", claim.costCenter || "");

  for (let r = 3; r <= 5; r++) {
    cover.getRow(r).height = 20;
  }

  /* ======================================================
     CATEGORY AMOUNT MATCHING
  ====================================================== */

  function normalizeText(value) {
    return String(value ?? "")
      .toLowerCase()
      .replace(/&/g, "and")
      .replace(/[’']/g, "")
      .replace(/[^a-z0-9.]+/g, " ")
      .trim()
      .replace(/\s+/g, " ");
  }

  const mappedRows = [];
  const unmatched = [];

  [...leftSections, ...rightSections].forEach((section) => {
    section.rows.forEach(([glCode, description], index) => {
      const label = description.replace(/^\d+\.\s*/, "");

      mappedRows.push({
        sectionCode: section.code,
        rowCode: `${section.code}.${index + 1}`,
        glCode,
        description,
        label,
        amount: 0,
        searchTerms: [
          glCode,
          description,
          label,
          `${section.code}.${index + 1}`,
          `${section.code}${index + 1}`
        ].map(normalizeText)
      });
    });
  });

  items.forEach((item) => {
    const amount = Number(item.amount) || 0;
    const category = String(item.category || "").trim();

    if (!category) {
      if (amount !== 0) {
        unmatched.push({
          category: "(No category)",
          description: item.description || "",
          amount
        });
      }
      return;
    }

    const normalized = normalizeText(category);

    let matches = mappedRows.filter((row) =>
      row.searchTerms.includes(normalized)
    );

    if (!matches.length) {
      matches = mappedRows.filter(
        (row) => normalizeText(row.label) === normalized
      );
    }

    if (matches.length === 1) {
      matches[0].amount += amount;
    } else {
      unmatched.push({
        category,
        description: item.description || "",
        amount
      });
    }
  });

  /* ======================================================
     DRAW CATEGORY SECTIONS
     LEFT: A,B,C IN A:C
     RIGHT: D,E,F IN D:F
  ====================================================== */

  let leftRow = 6;
  let rightRow = 6;

  function drawSection(section, startRow, startCol) {
    const codeCol = startCol;
    const descriptionCol = startCol + 1;
    const amountCol = startCol + 2;


// CATEGORY HEADER — NO MERGE
const codeHeader = cover.getRow(startRow).getCell(codeCol);
const heading = cover.getRow(startRow).getCell(descriptionCol);

// LEFT CELL: BLANK
codeHeader.value = null;
codeHeader.fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: grey }
};
codeHeader.alignment = {
  horizontal: "center",
  vertical: "middle",
  wrapText: false
};
styleCell(codeHeader, {
  fill: grey,
  align: "center"
});

// RIGHT CELL: CATEGORY TITLE
heading.value = section.title;
heading.font = {
  bold: true,
  italic: true,
  size: 10
};
heading.fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: grey }
};
heading.alignment = {
  horizontal: "center",
  vertical: "middle",
  wrapText: false
};
styleCell(heading, {
  bold: true,
  align: "center",
  fill: grey
});

// AMOUNT HEADER — SAR ONLY FOR A AND D
const amountHeader = cover.getRow(startRow).getCell(amountCol);
amountHeader.value =
  section.code === "A" || section.code === "D"
    ? "Amount\n(SAR)"
    : null;

amountHeader.font = { bold: true, size: 9 };
amountHeader.fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: grey }
};
amountHeader.alignment = {
  horizontal: "center",
  vertical: "middle",
  wrapText: false
};
styleCell(amountHeader, {
  bold: true,
  align: "center",
  wrapText: false,
  fill: grey
});

cover.getRow(startRow).height = 28;

    let rowNumber = startRow + 1;
    let sectionTotal = 0;

    section.rows.forEach(([glCode, description], index) => {
      const code = `${section.code}.${index + 1}`;

      const rowMapping = mappedRows.find(
        (row) => row.rowCode === code
      );

      const amount = rowMapping ? rowMapping.amount : 0;
      sectionTotal += amount;

      const codeCell = cover.getRow(rowNumber).getCell(codeCol);
      codeCell.value = glCode;
      styleCell(codeCell, { align: "center" });

      const descriptionCell = cover.getRow(rowNumber).getCell(descriptionCol);
      descriptionCell.value = description;
      styleCell(descriptionCell, { wrapText: true });

      const amountCell = cover.getRow(rowNumber).getCell(amountCol);
      amountCell.value = amount === 0 ? null : amount;
      amountCell.numFmt = moneyFormat;
      styleCell(amountCell, { align: "center" });

      cover.getRow(rowNumber).height = 20;
      rowNumber++;
    });

    return {
      nextRow: rowNumber,
      total: sectionTotal
    };
  }

  const leftResults = [];
  const rightResults = [];

  let leftGroupTotal = 0;
  let rightGroupTotal = 0;

  leftSections.forEach((section) => {
    const result = drawSection(section, leftRow, 1);
    leftResults.push(result);
    leftGroupTotal += result.total;
    leftRow = result.nextRow;
  });

  rightSections.forEach((section) => {
    const result = drawSection(section, rightRow, 4);
    rightResults.push(result);
    rightGroupTotal += result.total;
    rightRow = result.nextRow;
  });

  /* ======================================================
     SUBTOTAL: A + B + C
  ====================================================== */

  const leftSubtotalRow = leftRow;

  cover.mergeCells(`A${leftSubtotalRow}:B${leftSubtotalRow}`);

  const leftSubtotalLabel = cover.getCell(`A${leftSubtotalRow}`);
  leftSubtotalLabel.value = "SUB - TOTAL";
  leftSubtotalLabel.font = { bold: true, size: 9 };
  leftSubtotalLabel.alignment = {
    horizontal: "right",
    vertical: "middle"
  };
  styleCell(leftSubtotalLabel, {
    bold: true,
    align: "right"
  });

  const leftSubtotalAmount = cover.getCell(`C${leftSubtotalRow}`);
  leftSubtotalAmount.value =
    leftGroupTotal === 0 ? null : leftGroupTotal;
  leftSubtotalAmount.numFmt = moneyFormat;
  leftSubtotalAmount.font = { bold: true, size: 9 };
  leftSubtotalAmount.alignment = {
    horizontal: "center",
    vertical: "middle"
  };
  styleCell(leftSubtotalAmount, {
    bold: true,
    align: "center"
  });

  cover.getRow(leftSubtotalRow).height = 22;

  /* ======================================================
     SUBTOTAL: D + E + F
  ====================================================== */

  const rightSubtotalRow = rightRow;

  cover.mergeCells(`D${rightSubtotalRow}:E${rightSubtotalRow}`);

  const rightSubtotalLabel = cover.getCell(`D${rightSubtotalRow}`);
  rightSubtotalLabel.value = "SUB - TOTAL";
  rightSubtotalLabel.font = { bold: true, size: 9 };
  rightSubtotalLabel.alignment = {
    horizontal: "right",
    vertical: "middle"
  };
  styleCell(rightSubtotalLabel, {
    bold: true,
    align: "right"
  });

  const rightSubtotalAmount = cover.getCell(`F${rightSubtotalRow}`);
  rightSubtotalAmount.value =
    rightGroupTotal === 0 ? null : rightGroupTotal;
  rightSubtotalAmount.numFmt = moneyFormat;
  rightSubtotalAmount.font = { bold: true, size: 9 };
  rightSubtotalAmount.alignment = {
    horizontal: "center",
    vertical: "middle"
  };
  styleCell(rightSubtotalAmount, {
    bold: true,
    align: "center"
  });

  cover.getRow(rightSubtotalRow).height = 22;

  /* ======================================================
     GRAND TOTAL
     LABEL A:C
     AMOUNT D:F
  ====================================================== */

  const grandTotalValue = leftGroupTotal + rightGroupTotal;
  const grandTotalRow =
    Math.max(leftSubtotalRow, rightSubtotalRow) + 1;

  cover.mergeCells(`A${grandTotalRow}:C${grandTotalRow}`);
  cover.mergeCells(`D${grandTotalRow}:F${grandTotalRow}`);

  const grandTotalCell = cover.getCell(`A${grandTotalRow}`);
  grandTotalCell.value = "GRAND TOTAL / SAR. ONLY";
  grandTotalCell.font = {
    bold: true,
    size: 12
  };
  grandTotalCell.alignment = {
    horizontal: "left",
    vertical: "middle"
  };
  styleCell(grandTotalCell, { bold: true });

  const grandTotalAmount = cover.getCell(`D${grandTotalRow}`);
  grandTotalAmount.value =
    grandTotalValue === 0 ? null : grandTotalValue;
  grandTotalAmount.numFmt = moneyFormat;
  grandTotalAmount.font = {
    bold: true,
    size: 12
  };
  grandTotalAmount.alignment = {
    horizontal: "center",
    vertical: "middle"
  };
  styleCell(grandTotalAmount, {
    bold: true,
    align: "center"
  });

  cover.getRow(grandTotalRow).height = 28;

  /* ======================================================
     UNMAPPED CATEGORIES
  ====================================================== */

  let approvalStart = grandTotalRow + 2;

  if (unmatched.length) {
    cover.mergeCells(`A${approvalStart}:F${approvalStart}`);

    const unmatchedTitle = cover.getCell(`A${approvalStart}`);
    unmatchedTitle.value = "UNMAPPED CATEGORIES - PLEASE REVIEW";
    unmatchedTitle.font = {
      bold: true,
      color: { argb: red }
    };
    unmatchedTitle.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFFFE0E0" }
    };
    styleCell(unmatchedTitle, {
      bold: true,
      fill: "FFFFE0E0"
    });

    approvalStart++;

    cover.getCell(`A${approvalStart}`).value = "Category";
    cover.mergeCells(`B${approvalStart}:E${approvalStart}`);
    cover.getCell(`B${approvalStart}`).value = "Item Description";
    cover.getCell(`F${approvalStart}`).value = "Amount (SAR)";

    for (let c = 1; c <= 6; c++) {
      styleCell(cover.getRow(approvalStart).getCell(c), {
        bold: true,
        fill: grey
      });
    }

    unmatched.forEach((entry) => {
      approvalStart++;

      cover.getCell(`A${approvalStart}`).value = entry.category;

      cover.mergeCells(`B${approvalStart}:E${approvalStart}`);
      cover.getCell(`B${approvalStart}`).value = entry.description;

      const unmatchedAmount = cover.getCell(`F${approvalStart}`);
      unmatchedAmount.value = entry.amount === 0 ? null : entry.amount;
      unmatchedAmount.numFmt = moneyFormat;

      for (let c = 1; c <= 6; c++) {
        styleCell(cover.getRow(approvalStart).getCell(c));
      }

      unmatchedAmount.alignment = {
        horizontal: "center",
        vertical: "middle"
      };

      cover.getRow(approvalStart).height = 20;
    });

    approvalStart += 2;
  }

  /* ======================================================
     APPROVAL / SIGNATURE AREAS
  ====================================================== */

  function approvalBlock(
    row,
    leftTitle,
    rightTitle,
    leftRole,
    rightRole
  ) {
    cover.mergeCells(`A${row}:C${row}`);
    cover.mergeCells(`D${row}:F${row}`);

    setCoverCell(`A${row}`, leftTitle, { bold: true });
    setCoverCell(`D${row}`, rightTitle, { bold: true });

    cover.mergeCells(`A${row + 1}:B${row + 1}`);
    cover.mergeCells(`D${row + 1}:E${row + 1}`);

    setCoverCell(`A${row + 1}`, "", { fill: lightBlue });
    setCoverCell(`D${row + 1}`, "", { fill: lightBlue });

    setCoverCell(`C${row + 1}`, "Signature", {
      bold: true,
      align: "center"
    });

    setCoverCell(`F${row + 1}`, "Signature", {
      bold: true,
      align: "center"
    });

    setCoverCell(`A${row + 2}`, leftRole, { bold: true });

    cover.mergeCells(`D${row + 2}:F${row + 2}`);
    setCoverCell(`D${row + 2}`, rightRole, { bold: true });

    cover.getRow(row).height = 20;
    cover.getRow(row + 1).height = 28;
    cover.getRow(row + 2).height = 20;
  }

  approvalBlock(
    approvalStart,
    "Requested By:",
    "Reviewed By:",
    "Name",
    "Cost Control"
  );

  approvalStart += 3;

  approvalBlock(
    approvalStart,
    "Approved By:",
    "Approved By:",
    "Authorized Manager",
    "General Manager"
  );

  approvalStart += 3;

  cover.mergeCells(`A${approvalStart}:F${approvalStart}`);

  setCoverCell(
    `A${approvalStart}`,
    "FOR FINANCE DEPARTMENT USE ONLY",
    { bold: true, fill: grey }
  );

  approvalStart++;

  cover.mergeCells(`A${approvalStart}:C${approvalStart}`);
  cover.mergeCells(`D${approvalStart}:F${approvalStart}`);

  setCoverCell(`A${approvalStart}`, "Cost Center: __________");
  setCoverCell(`D${approvalStart}`, "Approved By: __________", {
    bold: true
  });

  approvalStart++;

  cover.mergeCells(`A${approvalStart}:C${approvalStart}`);
  cover.mergeCells(`D${approvalStart}:F${approvalStart}`);

  setCoverCell(`A${approvalStart}`, "Verified By: __________");
  setCoverCell(`D${approvalStart}`, "Financial Controller", {
    bold: true
  });

  approvalStart++;

  cover.mergeCells(`A${approvalStart}:C${approvalStart}`);
  cover.mergeCells(`D${approvalStart}:F${approvalStart}`);

  setCoverCell(`A${approvalStart}`, "Approved for Payment: __________");
  setCoverCell(`D${approvalStart}`, "Finance Approval: __________");

  approvalStart += 2;

  cover.mergeCells(`A${approvalStart}:F${approvalStart}`);

  const noteCell = cover.getCell(`A${approvalStart}`);
  noteCell.value =
    "NOTE TO EMPLOYEES:\nAN ORGANIZED SUMMARY MUST BE ATTACHED TO THE EXPENSE CLAIM UPON SUBMITTAL.";
  noteCell.font = {
    bold: true,
    size: 9,
    color: { argb: red }
  };
  noteCell.alignment = {
    horizontal: "left",
    vertical: "middle",
    wrapText: true
  };
  cover.getRow(approvalStart).height = 34;

  approvalStart++;

  cover.mergeCells(`A${approvalStart}:F${approvalStart}`);

  const footer = cover.getCell(`A${approvalStart}`);
  footer.value = "NU/DOC/FND/004 Issue 0";
  footer.font = {
    size: 8,
    color: { argb: black }
  };
  footer.alignment = {
    horizontal: "right",
    vertical: "middle"
  };

  /* ======================================================
     CONTROLLED COLUMN WIDTH / ROW HEIGHT
     NO EXTRA COLUMN
  ====================================================== */

  // Set fixed, controlled widths to avoid oversized columns.
  cover.getColumn(1).width = 11;
  cover.getColumn(2).width = 25;
  cover.getColumn(3).width = 12;
  cover.getColumn(4).width = 11;
  cover.getColumn(5).width = 25;
  cover.getColumn(6).width = 12;

  // Auto-fit rows to a controlled height.
  cover.eachRow({ includeEmpty: true }, (row) => {
    if (!row.height || row.height < 18) {
      row.height = 20;
    }
  });

  /* ======================================================
     OUTSIDE BORDER
     MEDIUM BLACK BORDER
  ====================================================== */

  const coverLastRow = approvalStart;

  // First, ensure regular thin borders on all used cells.
  for (let r = 1; r <= coverLastRow; r++) {
    for (let c = 1; c <= 6; c++) {
      const cell = cover.getRow(r).getCell(c);

      cell.border = {
        top: cell.border?.top || thinBorder.top,
        bottom: cell.border?.bottom || thinBorder.bottom,
        left: cell.border?.left || thinBorder.left,
        right: cell.border?.right || thinBorder.right
      };
    }
  }

  // Medium outside border: top and bottom.
  for (let c = 1; c <= 6; c++) {
    const topCell = cover.getRow(1).getCell(c);
    topCell.border = {
      ...topCell.border,
      top: mediumBorder.top
    };

    const bottomCell = cover.getRow(coverLastRow).getCell(c);
    bottomCell.border = {
      ...bottomCell.border,
      bottom: mediumBorder.bottom
    };
  }

  // Medium outside border: left and right.
  for (let r = 1; r <= coverLastRow; r++) {
    const leftCell = cover.getRow(r).getCell(1);
    leftCell.border = {
      ...leftCell.border,
      left: mediumBorder.left
    };

    const rightCell = cover.getRow(r).getCell(6);
    rightCell.border = {
      ...rightCell.border,
      right: mediumBorder.right
    };
  }

  /* ======================================================
     PRINT SETTINGS
  ====================================================== */

  cover.pageSetup = {
    orientation: "landscape",
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 1,
    paperSize: 9,
    margins: {
      left: 0.2,
      right: 0.2,
      top: 0.25,
      bottom: 0.25,
      header: 0.1,
      footer: 0.1
    },
    printArea: `A1:F${coverLastRow}`
  };

  cover.views = [{ state: "normal" }];

  // ALL CELLS: WRAP TEXT OFF
cover.eachRow((row) => {
  row.eachCell((cell) => {
    cell.alignment = {
      ...cell.alignment,
      wrapText: false
    };
  });
});

  /* ======================================================
     DOWNLOAD WORKBOOK
  ====================================================== */

  const buffer = await workbook.xlsx.writeBuffer();

  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = safeFilename(claim.claimName) + ".xlsx";

  document.body.appendChild(link);
  link.click();
  link.remove();

  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* =========================================================
   SAFE FILENAME
========================================================= */

function safeFilename(value) {
  return String(value || "Expense-Claim")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "-")
    .replace(/\s+/g, "-")
    .slice(0, 90);
}


/* =========================================================
   INITIALIZE APP
========================================================= */

function initializeApp() {
  ensureDropdownLists();

  const invoiceForm = $("#invoiceForm");

  if (invoiceForm) {
    invoiceForm.noValidate = true;

    invoiceForm.querySelectorAll("[required]").forEach((field) => {
      field.removeAttribute("required");
    });
  }

  const addItemButton = $("#addItem");

  if (addItemButton) {
    addItemButton.type = "button";
  }

  renderDropdownInputs();
  renderDashboard();
  renderClaimsTable();
  renderManageDropdowns();

  if ($("#claimDate") && !$("#claimDate").value) {
    $("#claimDate").value = localDateInputValue();
  }

  if ($("#itemInvoiceDate") && !$("#itemInvoiceDate").value) {
    $("#itemInvoiceDate").value = localDateInputValue();
  }

  showPage("dashboard");

  void loadServerData();
}

initializeApp();