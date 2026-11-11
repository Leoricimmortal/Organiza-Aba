/**
 * Organiza Aba - background.js (Service Worker)
 *
 * Responsável por:
 * - Detectar abas que pertencem a domínios monitorados
 * - Criar/atualizar/remover temporizadores individuais por aba (chrome.alarms)
 * - Fechar abas quando o tempo configurado é atingido
 * - Reagir a mudanças de regras vindas do popup
 * - Persistir tudo em chrome.storage.local para sobreviver a reinícios
 */

const ALARM_PREFIX = "organiza-aba:tab:";
const MAX_HISTORY = 20;

const DEFAULT_SETTINGS = {
  noCloseFixed: true,
  warnBeforeClose: false,
  showTabCounter: true
};

// ---------- Utilitários de storage ----------

async function getStorage() {
  const data = await chrome.storage.local.get(["rules", "settings", "monitoredTabs", "history"]);
  return {
    rules: data.rules || [],
    settings: { ...DEFAULT_SETTINGS, ...(data.settings || {}) },
    monitoredTabs: data.monitoredTabs || {},
    history: data.history || []
  };
}

async function setStorage(partial) {
  await chrome.storage.local.set(partial);
}

// ---------- Utilitários de domínio ----------

function normalizeDomainInput(input) {
  if (!input) return null;
  let value = input.trim();
  if (!value) return null;
  if (!/^[a-zA-Z]+:\/\//.test(value)) {
    value = "https://" + value;
  }
  try {
    const url = new URL(value);
    let hostname = url.hostname.toLowerCase();
    if (!hostname) return null;
    return hostname;
  } catch (e) {
    return null;
  }
}

function getHostnameFromUrl(url) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (!parsed.protocol.startsWith("http")) return null;
    return parsed.hostname.toLowerCase();
  } catch (e) {
    return null;
  }
}

function durationMs(value, unit) {
  const n = Number(value);
  if (!n || n <= 0) return 0;
  switch (unit) {
    case "segundos":
      return n * 1000;
    case "minutos":
      return n * 60 * 1000;
    case "horas":
      return n * 60 * 60 * 1000;
    default:
      return 0;
  }
}

function findActiveRuleForDomain(rules, domain) {
  if (!domain) return null;
  return rules.find((r) => r.status === "ativo" && r.domain === domain) || null;
}

// ---------- Monitoramento de abas ----------

async function startMonitoringTab(tabId, domain, rule, { monitoredTabs, settings }) {
  // Verifica pin antes de iniciar, se aplicável
  if (settings.noCloseFixed) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.pinned) return monitoredTabs;
    } catch (e) {
      return monitoredTabs;
    }
  }

  const ms = durationMs(rule.timeValue, rule.timeUnit);
  if (ms <= 0) return monitoredTabs;

  const closeAt = Date.now() + ms;
  monitoredTabs[tabId] = {
    domain,
    ruleId: rule.id,
    closeAt
  };

  const alarmName = ALARM_PREFIX + tabId;
  const delayInMinutes = Math.max(ms / 60000, 0.02); // mínimo ~1s de proteção
  chrome.alarms.create(alarmName, { delayInMinutes });

  return monitoredTabs;
}

function stopMonitoringTab(tabId, monitoredTabs) {
  delete monitoredTabs[tabId];
  chrome.alarms.clear(ALARM_PREFIX + tabId);
  return monitoredTabs;
}

/**
 * Reavalia uma aba específica: verifica se o domínio atual bate com alguma
 * regra ativa. Inicia, mantém ou para o monitoramento conforme necessário.
 */
async function evaluateTab(tabId, url) {
  const { rules, settings, monitoredTabs } = await getStorage();
  const domain = getHostnameFromUrl(url);
  const current = monitoredTabs[tabId];
  const rule = domain ? findActiveRuleForDomain(rules, domain) : null;

  if (!rule) {
    // Sem regra ativa para o domínio atual: para monitoramento se existia
    if (current) {
      stopMonitoringTab(tabId, monitoredTabs);
      await setStorage({ monitoredTabs });
    }
    return;
  }

  if (current && current.domain === domain && current.ruleId === rule.id) {
    // Já está sendo monitorada pela mesma regra e domínio: não reinicia o timer
    return;
  }

  // Domínio mudou (ou começou a corresponder a uma regra agora): reinicia contagem
  if (current) {
    stopMonitoringTab(tabId, monitoredTabs);
  }
  await startMonitoringTab(tabId, domain, rule, { monitoredTabs, settings });
  await setStorage({ monitoredTabs });
}

/**
 * Varre todas as abas abertas e sincroniza o monitoramento com as regras atuais.
 * Usado na inicialização e sempre que as regras mudam.
 */
async function rescanAllTabs() {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (tab.id !== undefined && tab.url) {
      await evaluateTab(tab.id, tab.url);
    }
  }
}

/**
 * Para o monitoramento de todas as abas associadas a uma regra específica,
 * sem fechar as abas (usado ao desativar/excluir uma regra).
 */
async function stopMonitoringForRule(ruleId) {
  const { monitoredTabs } = await getStorage();
  let changed = false;
  for (const [tabId, info] of Object.entries(monitoredTabs)) {
    if (info.ruleId === ruleId) {
      stopMonitoringTab(Number(tabId), monitoredTabs);
      changed = true;
    }
  }
  if (changed) {
    await setStorage({ monitoredTabs });
  }
}

async function addHistoryEntry(domain, action) {
  const { history } = await getStorage();
  const entry = {
    time: new Date().toISOString(),
    domain,
    action
  };
  const updated = [entry, ...history].slice(0, MAX_HISTORY);
  await setStorage({ history: updated });
}

// ---------- Fechamento de abas ----------

async function handleTabAlarm(tabId) {
  const { rules, settings, monitoredTabs } = await getStorage();
  const info = monitoredTabs[tabId];
  if (!info) return;

  let tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch (e) {
    // Aba não existe mais
    stopMonitoringTab(tabId, monitoredTabs);
    await setStorage({ monitoredTabs });
    return;
  }

  const currentDomain = getHostnameFromUrl(tab.url);
  const rule = rules.find((r) => r.id === info.ruleId);

  // Revalida tudo antes de fechar: domínio, regra ativa, pin
  if (
    !rule ||
    rule.status !== "ativo" ||
    currentDomain !== info.domain ||
    (settings.noCloseFixed && tab.pinned)
  ) {
    stopMonitoringTab(tabId, monitoredTabs);
    await setStorage({ monitoredTabs });
    return;
  }

  if (settings.warnBeforeClose) {
    try {
      chrome.notifications.create(`organiza-aba-warn-${tabId}-${Date.now()}`, {
        type: "basic",
        iconUrl: "icons/icon48.png",
        title: "Organiza Aba",
        message: `A aba de "${info.domain}" será fechada em instantes.`,
        priority: 0
      });
    } catch (e) {
      // notificações podem não estar disponíveis; ignora silenciosamente
    }
  }

  try {
    await chrome.tabs.remove(tabId);
    await addHistoryEntry(info.domain, "fechada");
  } catch (e) {
    // aba pode já ter sido fechada
  }

  stopMonitoringTab(tabId, monitoredTabs);
  await setStorage({ monitoredTabs });
}

// ---------- Event listeners ----------

chrome.runtime.onInstalled.addListener(async () => {
  const data = await getStorage();
  await setStorage({
    rules: data.rules,
    settings: data.settings,
    monitoredTabs: data.monitoredTabs,
    history: data.history
  });
  await rescanAllTabs();
});

chrome.runtime.onStartup.addListener(async () => {
  await rescanAllTabs();
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url) {
    evaluateTab(tabId, changeInfo.url);
  } else if (changeInfo.status === "complete" && tab.url) {
    // Garante avaliação também quando a URL só fica disponível após o load
    evaluateTab(tabId, tab.url);
  }
});

chrome.tabs.onCreated.addListener((tab) => {
  if (tab.id !== undefined && tab.url) {
    evaluateTab(tab.id, tab.url);
  }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const { monitoredTabs } = await getStorage();
  if (monitoredTabs[tabId]) {
    stopMonitoringTab(tabId, monitoredTabs);
    await setStorage({ monitoredTabs });
  }
});

chrome.tabs.onReplaced.addListener(async (addedTabId, removedTabId) => {
  const { monitoredTabs } = await getStorage();
  if (monitoredTabs[removedTabId]) {
    stopMonitoringTab(removedTabId, monitoredTabs);
    await setStorage({ monitoredTabs });
  }
  try {
    const tab = await chrome.tabs.get(addedTabId);
    if (tab.url) evaluateTab(addedTabId, tab.url);
  } catch (e) {
    /* ignore */
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name.startsWith(ALARM_PREFIX)) {
    const tabId = Number(alarm.name.slice(ALARM_PREFIX.length));
    handleTabAlarm(tabId);
  }
});

// ---------- Mensagens do popup ----------

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message).then(sendResponse);
  return true; // resposta assíncrona
});

async function handleMessage(message) {
  const { type, payload } = message || {};

  switch (type) {
    case "GET_STATE": {
      const { rules, settings, monitoredTabs, history } = await getStorage();
      return { ok: true, rules, settings, monitoredTabs, history };
    }

    case "ADD_RULE": {
      const { rules } = await getStorage();
      if (rules.length >= 4) {
        return { ok: false, error: "Limite de 4 domínios atingido." };
      }
      const domain = normalizeDomainInput(payload.domain);
      if (!domain) {
        return { ok: false, error: "Domínio inválido." };
      }
      if (rules.some((r) => r.domain === domain)) {
        return { ok: false, error: "Este domínio já está cadastrado." };
      }
      const timeValue = Number(payload.timeValue);
      if (!timeValue || timeValue <= 0) {
        return { ok: false, error: "O tempo deve ser maior que zero." };
      }
      if (!["segundos", "minutos", "horas"].includes(payload.timeUnit)) {
        return { ok: false, error: "Unidade de tempo inválida." };
      }
      const rule = {
        id: crypto.randomUUID(),
        domain,
        timeValue,
        timeUnit: payload.timeUnit,
        status: payload.status === "inativo" ? "inativo" : "ativo"
      };
      const updatedRules = [...rules, rule];
      await setStorage({ rules: updatedRules });
      await rescanAllTabs();
      return { ok: true, rule };
    }

    case "EDIT_RULE": {
      const { rules } = await getStorage();
      const idx = rules.findIndex((r) => r.id === payload.id);
      if (idx === -1) {
        return { ok: false, error: "Regra não encontrada." };
      }
      const domain = normalizeDomainInput(payload.domain);
      if (!domain) {
        return { ok: false, error: "Domínio inválido." };
      }
      if (rules.some((r) => r.domain === domain && r.id !== payload.id)) {
        return { ok: false, error: "Este domínio já está cadastrado." };
      }
      const timeValue = Number(payload.timeValue);
      if (!timeValue || timeValue <= 0) {
        return { ok: false, error: "O tempo deve ser maior que zero." };
      }
      if (!["segundos", "minutos", "horas"].includes(payload.timeUnit)) {
        return { ok: false, error: "Unidade de tempo inválida." };
      }

      const updatedRules = [...rules];
      updatedRules[idx] = {
        ...updatedRules[idx],
        domain,
        timeValue,
        timeUnit: payload.timeUnit,
        status: payload.status === "inativo" ? "inativo" : "ativo"
      };
      await setStorage({ rules: updatedRules });
      // Para timers antigos dessa regra e reavalia todas as abas com os novos valores
      await stopMonitoringForRule(payload.id);
      await rescanAllTabs();
      return { ok: true };
    }

    case "TOGGLE_RULE": {
      const { rules } = await getStorage();
      const idx = rules.findIndex((r) => r.id === payload.id);
      if (idx === -1) return { ok: false, error: "Regra não encontrada." };
      const updatedRules = [...rules];
      const newStatus = updatedRules[idx].status === "ativo" ? "inativo" : "ativo";
      updatedRules[idx] = { ...updatedRules[idx], status: newStatus };
      await setStorage({ rules: updatedRules });
      if (newStatus === "inativo") {
        await stopMonitoringForRule(payload.id);
      } else {
        await rescanAllTabs();
      }
      return { ok: true, status: newStatus };
    }

    case "DELETE_RULE": {
      const { rules } = await getStorage();
      const updatedRules = rules.filter((r) => r.id !== payload.id);
      await setStorage({ rules: updatedRules });
      await stopMonitoringForRule(payload.id);
      return { ok: true };
    }

    case "UPDATE_SETTINGS": {
      const { settings } = await getStorage();
      const updated = { ...settings, ...payload };
      await setStorage({ settings: updated });
      if (payload.noCloseFixed === true) {
        // Reavalia para parar de monitorar abas fixadas que já estavam em contagem
        await rescanAllTabs();
      }
      return { ok: true, settings: updated };
    }

    default:
      return { ok: false, error: "Mensagem desconhecida." };
  }
}
