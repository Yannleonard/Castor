(() => {
  const $ = (id) => document.getElementById(id);
  const state = { key: "", csrfToken: "" };
  const status = (id, text, error = false) => { $(id).textContent = text; $(id).classList.toggle("error", error); };
  const api = async (path, options = {}) => {
    const response = await fetch("/api/account" + path, { ...options, credentials: "same-origin", headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...(state.csrfToken ? { "X-Castor-CSRF": state.csrfToken } : {}), ...options.headers } });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
    return body;
  };
  const show = async () => {
    const me = await api("/me");
    state.csrfToken = me.csrfToken || "";
    $("auth").classList.add("hidden");
    $("dashboard").classList.remove("hidden");
    $("logout").classList.remove("hidden");
    await Promise.all([loadKeys(), loadTickets()]);
  };
  async function loadKeys() {
    const result = await api("/activation-keys");
    const root = $("keys"); root.replaceChildren();
    if (!result.keys.length) { root.textContent = "Aucune clé générée."; return; }
    result.keys.forEach((key) => {
      const line = document.createElement("p");
      const host = key.hostName ? ` · hôte ${key.hostName}` : "";
      line.textContent = `${key.revoked ? "Révoquée" : key.activatedAt ? "Activée" : "En attente d’activation"}${key.activatedAt ? host : ""} · créée le ${new Date(key.createdAt).toLocaleDateString("fr-FR")}`;
      root.append(line);
    });
  }
  async function loadTickets() {
    const result = await api("/tickets"); const root = $("tickets"); root.replaceChildren();
    if (!result.tickets.length) { root.textContent = "Aucune demande pour le moment."; return; }
    result.tickets.forEach((ticket) => {
      const article = document.createElement("article"); article.className = "ticket";
      const title = document.createElement("h3"); title.textContent = ticket.subject;
      const badge = document.createElement("span"); badge.className = "badge"; badge.textContent = `${ticket.kind === "commercial" ? "Commercial" : "Support"} · ${ticket.status}`;
      article.append(title, badge);
      ticket.messages.forEach((message) => {
        const block = document.createElement("div"); block.className = `message ${message.author === "admin" ? "admin" : ""}`;
        const label = document.createElement("strong"); label.textContent = message.author === "admin" ? "Équipe Castor · " : "Vous · ";
        const body = document.createElement("span"); body.textContent = message.body;
        const date = document.createElement("small"); date.className = "muted"; date.textContent = `\n${new Date(message.createdAt).toLocaleString("fr-FR")}`;
        block.append(label, body, date); article.append(block);
      });
      root.append(article);
    });
  }
  $("register").onsubmit = async (event) => {
    event.preventDefault(); status("register-status", "Création du compte…");
    try {
      await fetch("/api/account/register", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: $("name").value, company: $("company").value, email: $("email").value, password: $("password").value }) }).then(async (r) => { const b = await r.json().catch(() => ({})); if (!r.ok) throw new Error(b.error || `HTTP ${r.status}`); return b; });
      $("login-email").value = $("email").value; status("register-status", "Compte créé. Vous pouvez maintenant vous connecter.");
    } catch (error) { status("register-status", error.message === "email_exists" ? "Cette adresse e-mail est déjà enregistrée." : "Création du compte impossible. Vérifiez les informations saisies.", true); }
  };
  $("login").onsubmit = async (event) => {
    event.preventDefault(); status("login-status", "Connexion…");
    try {
      const login = await fetch("/api/account/login", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: $("login-email").value, password: $("login-password").value }) }).then(async (r) => { const b = await r.json().catch(() => ({})); if (!r.ok) throw new Error(b.error || `HTTP ${r.status}`); return b; });
      state.csrfToken = login.csrfToken || "";
      await show();
    } catch { status("login-status", "Adresse e-mail ou mot de passe incorrect.", true); }
  };
  $("generate-key").onclick = async () => {
    try {
      const result = await api("/activation-keys", { method: "POST", body: "{}" }); state.key = result.key;
      $("key-value").textContent = result.key; $("new-key").classList.remove("hidden"); status("key-status", "Clé créée. Copiez-la maintenant : elle ne pourra plus être affichée."); await loadKeys();
    } catch { status("key-status", "Impossible de générer la clé.", true); }
  };
  $("copy-key").onclick = async () => { try { await navigator.clipboard.writeText(state.key); status("key-status", "Clé copiée."); } catch { status("key-status", "Copie impossible. Sélectionnez la clé manuellement.", true); } };
  $("ticket-form").onsubmit = async (event) => {
    event.preventDefault(); status("ticket-status", "Envoi…");
    try { await api("/tickets", { method: "POST", body: JSON.stringify({ kind: $("kind").value, subject: $("subject").value, message: $("message").value }) }); $("ticket-form").reset(); status("ticket-status", "Demande envoyée. Vous pourrez consulter la réponse ici."); await loadTickets(); }
    catch { status("ticket-status", "Envoi impossible. Réessayez.", true); }
  };
  $("logout").onclick = async () => { try { await api("/logout", { method: "POST", body: "{}" }); } finally { location.reload(); } };
  show().catch(() => {});
})();