(() => {
  "use strict";
  const STORE_KEY = "monevia_standalone_demo_v1";
  const $ = (selector) => document.querySelector(selector);
  const state = loadState();
  let modalMode = "profile";
  let toastTimer;

  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
      return {
        profile: saved.profile || null,
        activity: Array.isArray(saved.activity) ? saved.activity : [],
        cart: Array.isArray(saved.cart) ? saved.cart : []
      };
    } catch {
      return { profile: null, activity: [], cart: [] };
    }
  }
  function saveState() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
    catch { showToast("This browser could not save demo data."); }
    render();
  }
  function money(value) {
    return Number(value || 0).toLocaleString("en-NG", { maximumFractionDigits: 0 });
  }
  function balance() {
    return state.activity.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
  }
  function showToast(message) {
    const toast = $("#toast");
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 2800);
  }
  function openModal(mode = "profile") {
    modalMode = mode;
    $("#demoForm").reset();
    $("#modalTitle").textContent = mode === "withdraw" ? "Try a demo withdrawal" : "Create your demo profile";
    $("#modalEyebrow").textContent = mode === "withdraw" ? "WALLET PREVIEW" : "WELCOME TO MONEVIA";
    $("#modalDescription").textContent = mode === "withdraw"
      ? "This is a preview only. No request will be sent and no money can be withdrawn."
      : "Create a local preview profile. Do not use a real password; this is not a secure online account.";
    $("#demoName").labels[0].textContent = mode === "withdraw" ? "Requested amount (₦)" : "Display name";
    $("#demoName").placeholder = mode === "withdraw" ? "e.g. 1000" : "e.g. Knox";
    $("#demoName").type = mode === "withdraw" ? "number" : "text";
    $("#demoName").min = mode === "withdraw" ? "1" : "";
    $("#demoName").max = mode === "withdraw" ? String(Math.max(1, balance())) : "";
    $("#demoName").required = true;
    $("#demoEmail").hidden = mode === "withdraw";
    $("#demoEmail").required = false;
    $("#modalSubmit").textContent = mode === "withdraw" ? "Preview request ↗" : (state.profile ? "Update demo profile ↗" : "Create demo profile ↗");
    $("#modalBackdrop").hidden = false;
    $("#demoName").focus();
  }
  function closeModal() { $("#modalBackdrop").hidden = true; }
  function render() {
    const currentBalance = balance();
    $("#heroBalance").textContent = money(currentBalance);
    $("#walletBalance").textContent = money(currentBalance);
    $("#profileSummary").innerHTML = state.profile
      ? `<strong>${escapeHtml(state.profile.name)}</strong><br>${escapeHtml(state.profile.email || "No email added")}<br><small>Local demo profile · This device only</small>`
      : "No demo profile created yet.";
    $("#accountAction").textContent = state.profile ? "Edit demo profile" : "Create demo profile";
    const list = $("#activityList");
    if (!state.activity.length) {
      list.innerHTML = '<div class="empty-state">Your demo activity will appear here.</div>';
    } else {
      list.innerHTML = state.activity.slice().reverse().slice(0, 8).map(item => `
        <div class="activity-row"><div>${escapeHtml(item.label)}<small>${escapeHtml(item.date)} · DEMO</small></div><div class="activity-amount">${item.amount >= 0 ? "+" : "−"}₦${money(Math.abs(item.amount))}</div></div>
      `).join("");
    }
    const cartCount = state.cart.length;
    document.querySelectorAll(".add-cart").forEach(button => {
      const added = state.cart.some(item => item.name === button.dataset.product);
      button.textContent = added ? "Added to demo cart ✓" : "Add to demo cart";
      button.disabled = added;
      button.style.opacity = added ? ".65" : "1";
    });
    $("#headerAuth").textContent = state.profile ? "My profile" : "Get started";
  }
  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, char => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[char]));
  }
  function addActivity(label, amount) {
    state.activity.push({ label, amount, date: new Date().toLocaleDateString() });
    saveState();
  }

  $("#menuToggle").addEventListener("click", () => $("#nav").classList.toggle("open"));
  $("#nav").addEventListener("click", event => {
    if (event.target.closest("a")) $("#nav").classList.remove("open");
  });
  $("#headerAuth").addEventListener("click", () => {
    document.querySelector("#account").scrollIntoView({ behavior: "smooth" });
    if (!state.profile) openModal("profile");
  });
  $("#heroStart").addEventListener("click", () => openModal("profile"));
  $("#accountAction").addEventListener("click", () => openModal("profile"));
  $("#modalClose").addEventListener("click", closeModal);
  $("#modalBackdrop").addEventListener("click", event => { if (event.target === $("#modalBackdrop")) closeModal(); });
  document.addEventListener("keydown", event => { if (event.key === "Escape") closeModal(); });

  $("#demoForm").addEventListener("submit", event => {
    event.preventDefault();
    const value = $("#demoName").value.trim();
    if (!value) return;
    if (modalMode === "withdraw") {
      const amount = Number(value);
      if (!Number.isFinite(amount) || amount <= 0 || amount > balance()) {
        showToast("Enter an amount within the demo balance.");
        return;
      }
      closeModal();
      showToast("Demo only: no withdrawal was submitted.");
      return;
    }
    state.profile = { name: value.slice(0, 50), email: $("#demoEmail").value.trim().slice(0, 100) };
    saveState();
    closeModal();
    showToast("Demo profile saved on this device.");
  });

  document.querySelectorAll(".task-action").forEach(button => {
    button.addEventListener("click", () => showToast(`${button.dataset.task}: sample task preview only.`));
  });
  document.querySelectorAll(".add-cart").forEach(button => {
    button.addEventListener("click", () => {
      if (state.cart.some(item => item.name === button.dataset.product)) return;
      state.cart.push({ name: button.dataset.product, price: Number(button.dataset.price) });
      saveState();
      showToast("Added to your local demo cart.");
    });
  });
  $("#addSample").addEventListener("click", () => {
    addActivity("Sample activity credit", 500);
    showToast("Added ₦500 in demo activity only.");
  });
  $("#withdrawBtn").addEventListener("click", () => {
    if (balance() <= 0) { showToast("Add sample activity before previewing a withdrawal."); return; }
    openModal("withdraw");
  });
  $("#clearActivity").addEventListener("click", () => {
    if (!state.activity.length) { showToast("There is no demo activity to clear."); return; }
    state.activity = [];
    saveState();
    showToast("Demo activity cleared.");
  });
  $("#resetAll").addEventListener("click", () => {
    if (!confirm("Reset this browser's MONEVIA demo profile, activity, and cart?")) return;
    state.profile = null;
    state.activity = [];
    state.cart = [];
    saveState();
    showToast("Demo reset complete.");
  });

  render();
})();
