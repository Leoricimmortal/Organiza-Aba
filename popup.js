const viewList = document.getElementById("view-list");
const viewForm = document.getElementById("view-form");
const viewSettings = document.getElementById("view-settings");

const rulesListEl = document.getElementById("rules-list");
const emptyStateEl = document.getElementById("empty-state");
const btnAdd = document.getElementById("btn-add");
const btnSettings = document.getElementById("btn-settings");
const btnCloseSettings = document.getElementById("btn-close-settings");
const statusBar = document.getElementById("status-bar");

const counterEl = document.getElementById("counter");
const counterText = document.getElementById("counter-text");
const counterNext = document.getElementById("counter-next");

const formTitle = document.getElementById("form-title");
const inputDomain = document.getElementById("input-domain");
const inputTime = document.getElementById("input-time");
const inputUnit = document.getElementById("input-unit");
const inputStatus = document.getElementById("input-status");
const formError = document.getElementById("form-error");
const btnSave = document.getElementById("btn-save");
const btnCancel = document.getElementById("btn-cancel");

const settingPinned = document.getElementById("setting-pinned");
const settingWarn = document.getElementById("setting-warn");
const settingCounter = document.getElementById("setting-counter");
const historyListEl = document.getElementById("history-list");

let state = { rules: [], settings: {}, monitoredTabs: {}, history: [] };
let editingId = null;
let countdownInterval = null;

function sendMessage(type, payload) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type, payload }, (response) => {
      resolve(response || { ok: false, error: "Sem resposta da extensão." });
    });
  });
}

function showView(view) {
  [viewList, viewForm, viewSettings].forEach((v) => v.classList.add("hidden"));
  view.classList.remove("hidden");
}

function showStatus(message) {
  statusBar.textContent = message;
  statusBar.classList.remove("hidden");
  setTimeout(() => statusBar.classList.add("hidden"), 3500);
}

function formatTime(value, unit) {
  const labels = { segundos: "segundo", minutos: "minuto", horas: "hora" };
  const label = labels[unit] || unit;
  return `${value} ${label}${value > 1 ? "s" : ""}`;
}

function renderRules() {
  rulesListEl.innerHTML = "";

  if (!state.rules.length) {
    emptyStateEl.classList.remove("hidden");
  } else {
    emptyStateEl.classList.add("hidden");
  }

  state.rules.forEach((rule) => {
    const card = document.createElement("div");
    card.className = "rule-card" + (rule.status !== "ativo" ? " inactive" : "");

    const domainEl = document.createElement("div");
    domainEl.className = "rule-domain";
    domainEl.textContent = rule.domain;

    const timeEl = document.createElement("div");
    timeEl.className = "rule-time";
    timeEl.textContent = `Fechar após: ${formatTime(rule.timeValue, rule.timeUnit)}`;

    const statusEl = document.createElement("div");
    statusEl.className = "rule-status " + (rule.status === "ativo" ? "active" : "inactive");
    statusEl.textContent = rule.status === "ativo" ? "● Ativo" : "○ Inativo";

    const actions = document.createElement("div");
    actions.className = "rule-actions";

    const btnEdit = document.createElement("button");
    btnEdit.textContent = "Editar";
    btnEdit.addEventListener("click", () => openEditForm(rule));

    const btnToggle = document.createElement("button");
    btnToggle.textContent = rule.status === "ativo" ? "Desativar" : "Ativar";
    btnToggle.addEventListener("click", () => toggleRule(rule.id));

    const btnDelete = document.createElement("button");
    btnDelete.textContent = "Excluir";
    btnDelete.className = "danger";
    btnDelete.addEventListener("click", () => deleteRule(rule.id, rule.domain));

    actions.append(btnEdit, btnToggle, btnDelete);
    card.append(domainEl, timeEl, statusEl, actions);
    rulesListEl.appendChild(card);
  });

  btnAdd.disabled = state.rules.length >= 4;
  btnAdd.textContent = state.rules.length >= 4 ? "Limite de 4 domínios atingido" : "+ Adicionar domínio";
}

function renderCounter() {
  const showCounter = state.settings.showTabCounter;
  if (!showCounter) {
    counterEl.classList.add("hidden");
    if (countdownInterval) clearInterval(countdownInterval);
    return;
  }
  counterEl.classList.remove("hidden");
  updateCounterText();

  if (countdownInterval) clearInterval(countdownInterval);
  countdownInterval = setInterval(updateCounterText, 1000);
}

function updateCounterText() {
  const entries = Object.values(state.monitoredTabs || {});
  counterText.textContent = `${entries.length} aba${entries.length === 1 ? "" : "s"} monitorada${entries.length === 1 ? "" : "s"}`;

  if (!entries.length) {
    counterNext.textContent = "";
    return;
  }

  const soonest = entries.reduce((min, e) => (e.closeAt < min ? e.closeAt : min), entries[0].closeAt);
  const remainingMs = soonest - Date.now();
  if (remainingMs <= 0) {
    counterNext.textContent = "fechando...";
    return;
  }
  const totalSeconds = Math.floor(remainingMs / 1000);
  const mm = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const ss = String(totalSeconds % 60).padStart(2, "0");
  counterNext.textContent = `Próximo: ${mm}:${ss}`;
}

function renderHistory() {
  historyListEl.innerHTML = "";
  if (!state.history.length) {
    const empty = document.createElement("div");
    empty.className = "history-empty";
    empty.textContent = "Nenhuma atividade registrada ainda.";
    historyListEl.appendChild(empty);
    return;
  }

  state.history.forEach((entry) => {
    const item = document.createElement("div");
    item.className = "history-item";
    const date = new Date(entry.time);
    const timeStr = date.toLocaleString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
      day: "2-digit",
      month: "2-digit"
    });
    item.innerHTML = `<strong>${entry.domain}</strong>${timeStr} · Aba fechada`;
    historyListEl.appendChild(item);
  });
}

function renderSettings() {
  settingPinned.checked = !!state.settings.noCloseFixed;
  settingWarn.checked = !!state.settings.warnBeforeClose;
  settingCounter.checked = !!state.settings.showTabCounter;
}

async function refreshState() {
  const res = await sendMessage("GET_STATE");
  if (res.ok) {
    state = res;
    renderRules();
    renderCounter();
    renderHistory();
    renderSettings();
  }
}

function resetForm() {
  inputDomain.value = "";
  inputTime.value = "";
  inputUnit.value = "minutos";
  inputStatus.checked = true;
  formError.classList.add("hidden");
  formError.textContent = "";
}

function openAddForm() {
  editingId = null;
  resetForm();
  formTitle.textContent = "Adicionar domínio";
  showView(viewForm);
}

function openEditForm(rule) {
  editingId = rule.id;
  formTitle.textContent = "Editar domínio";
  inputDomain.value = rule.domain;
  inputTime.value = rule.timeValue;
  inputUnit.value = rule.timeUnit;
  inputStatus.checked = rule.status === "ativo";
  formError.classList.add("hidden");
  showView(viewForm);
}

async function saveForm() {
  const payload = {
    domain: inputDomain.value,
    timeValue: inputTime.value,
    timeUnit: inputUnit.value,
    status: inputStatus.checked ? "ativo" : "inativo"
  };

  btnSave.disabled = true;
  const res = editingId
    ? await sendMessage("EDIT_RULE", { id: editingId, ...payload })
    : await sendMessage("ADD_RULE", payload);
  btnSave.disabled = false;

  if (!res.ok) {
    formError.textContent = res.error || "Não foi possível salvar.";
    formError.classList.remove("hidden");
    return;
  }

  await refreshState();
  showView(viewList);
}

async function toggleRule(id) {
  const res = await sendMessage("TOGGLE_RULE", { id });
  if (res.ok) {
    await refreshState();
  } else {
    showStatus(res.error || "Erro ao alterar regra.");
  }
}

async function deleteRule(id, domain) {
  const confirmed = confirm(`Excluir a regra de "${domain}"? As abas abertas não serão fechadas.`);
  if (!confirmed) return;
  const res = await sendMessage("DELETE_RULE", { id });
  if (res.ok) {
    await refreshState();
  } else {
    showStatus(res.error || "Erro ao excluir regra.");
  }
}

async function updateSetting(key, value) {
  const res = await sendMessage("UPDATE_SETTINGS", { [key]: value });
  if (res.ok) {
    state.settings = res.settings;
    renderCounter();
  }
}

btnAdd.addEventListener("click", () => {
  if (state.rules.length >= 4) return;
  openAddForm();
});

btnCancel.addEventListener("click", () => showView(viewList));
btnSave.addEventListener("click", saveForm);

btnSettings.addEventListener("click", () => {
  renderSettings();
  renderHistory();
  showView(viewSettings);
});
btnCloseSettings.addEventListener("click", () => showView(viewList));

settingPinned.addEventListener("change", () => updateSetting("noCloseFixed", settingPinned.checked));
settingWarn.addEventListener("change", () => updateSetting("warnBeforeClose", settingWarn.checked));
settingCounter.addEventListener("change", () => updateSetting("showTabCounter", settingCounter.checked));

document.addEventListener("DOMContentLoaded", refreshState);

// Mantém o popup atualizado caso o storage mude enquanto está aberto
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.rules || changes.monitoredTabs || changes.history || changes.settings) {
    refreshState();
  }
});
