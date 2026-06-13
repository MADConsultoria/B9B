let currentDate = new Date();
let cachedEvents = [];
let activeFilter = "all";

document.addEventListener("DOMContentLoaded", () => {
  if (document.getElementById("eventGrid") || document.getElementById("calendarGrid")) {
    setupHomePage();
  }

  if (document.getElementById("eventForm")) {
    setupInsertPage();
  }

  if (document.getElementById("eventDetail")) {
    setupEventPage();
  }
});

async function setupHomePage() {
  document.getElementById("prevMonth")?.addEventListener("click", () => {
    currentDate = new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1);
    renderCalendar();
  });

  document.getElementById("nextMonth")?.addEventListener("click", () => {
    currentDate = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1);
    renderCalendar();
  });

  document.getElementById("listViewBtn")?.addEventListener("click", () => setHomeView("list"));
  document.getElementById("calendarViewBtn")?.addEventListener("click", () => setHomeView("calendar"));
  document.querySelectorAll("[data-filter]").forEach((button) => {
    button.addEventListener("click", () => setEventFilter(button.dataset.filter || "all"));
  });

  await loadEvents();
  renderEventGrid();
  renderCalendar();
  renderEventList(document.getElementById("eventList"), cachedEvents);
}

function setupInsertPage() {
  const form = document.getElementById("eventForm");
  const message = document.getElementById("formMessage");
  const dateInput = document.getElementById("date");
  const imageInputs = [...form.querySelectorAll('input[type="file"][data-image-upload]')];
  dateInput.min = formatDateInput(new Date());
  imageInputs.forEach(setupImagePreview);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submitButton = form.querySelector('button[type="submit"]');
    message.className = "";
    message.textContent = "Enviando imagens e publicando evento...";
    submitButton.disabled = true;

    const formData = new FormData(form);
    const payload = {
      token: clean(formData.get("token")),
      clientName: clean(formData.get("clientName")),
      title: clean(formData.get("title")),
      date: clean(formData.get("date")),
      time: clean(formData.get("time")),
      city: clean(formData.get("city")),
      link: clean(formData.get("link")),
      imageUrl1: "",
      imageUrl2: "",
      categories: formData.getAll("categories").map(clean),
      description: clean(formData.get("description"))
    };

    try {
      const [imageUrl1, imageUrl2] = await Promise.all([
        uploadImage(formData.get("imageFile1"), payload.token),
        uploadImage(formData.get("imageFile2"), payload.token)
      ]);
      payload.imageUrl1 = imageUrl1;
      payload.imageUrl2 = imageUrl2;

      const { event: createdEvent } = await apiFetch("/api/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const eventUrl = getEventUrl(createdEvent);
      form.reset();
      imageInputs.forEach(clearImagePreview);
      dateInput.min = formatDateInput(new Date());
      message.className = "success";
      message.innerHTML = `Evento publicado. <a href="${escapeAttribute(eventUrl)}">Abrir pagina do evento</a>`;
    } catch (error) {
      message.className = "error";
      message.textContent = error.message;
    } finally {
      submitButton.disabled = false;
    }
  });
}

function setupImagePreview(input) {
  input.addEventListener("change", () => {
    const preview = document.getElementById(input.dataset.preview);
    const file = input.files?.[0];
    if (!preview) return;

    if (!file) {
      clearImagePreview(input);
      return;
    }

    if (file.size > 8 * 1024 * 1024) {
      input.value = "";
      clearImagePreview(input);
      window.alert("A imagem deve ter no maximo 8 MB.");
      return;
    }

    preview.src = URL.createObjectURL(file);
    preview.hidden = false;
    input.closest(".media-field")?.classList.add("has-preview");
  });
}

function clearImagePreview(input) {
  const preview = document.getElementById(input.dataset.preview);
  if (preview?.src.startsWith("blob:")) URL.revokeObjectURL(preview.src);
  if (preview) {
    preview.removeAttribute("src");
    preview.hidden = true;
  }
  input.closest(".media-field")?.classList.remove("has-preview");
}

async function uploadImage(file, token) {
  if (!(file instanceof File) || !file.size) return "";

  const response = await fetch("/api/uploads/images", {
    method: "POST",
    headers: {
      "Content-Type": file.type,
      "X-Upload-Token": token
    },
    body: file
  });
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Nao foi possivel enviar a imagem.");
  }

  return data.url;
}

async function setupEventPage() {
  const params = new URLSearchParams(window.location.search);
  const eventId = params.get("id");
  const detail = document.getElementById("eventDetail");

  if (!eventId) {
    renderMissingEvent(detail);
    return;
  }

  try {
    const { event } = await apiFetch(`/api/events/${encodeURIComponent(eventId)}`);
    renderEventPage(event, detail);
  } catch {
    renderMissingEvent(detail);
  }
}

async function loadEvents() {
  try {
    const data = await apiFetch("/api/events");
    cachedEvents = data.events || [];
  } catch {
    cachedEvents = [];
  }
}

function setHomeView(view) {
  const isList = view === "list";
  document.getElementById("eventGrid")?.classList.toggle("hidden", !isList);
  document.getElementById("calendarPanel")?.classList.toggle("hidden", isList);
  document.getElementById("listViewBtn")?.classList.toggle("active", isList);
  document.getElementById("calendarViewBtn")?.classList.toggle("active", !isList);
}

function setEventFilter(filter) {
  activeFilter = filter;
  document.querySelectorAll("[data-filter]").forEach((button) => {
    button.classList.toggle("active", button.dataset.filter === filter);
  });
  renderEventGrid();
  renderCalendar();
  renderEventList(document.getElementById("eventList"), cachedEvents);
}

function renderEventGrid() {
  const container = document.getElementById("eventGrid");
  if (!container) return;

  const upcoming = filterEvents(getUpcomingEvents(cachedEvents));
  container.innerHTML = "";

  if (!upcoming.length) {
    container.innerHTML = '<div class="empty-state wide">Ainda nao ha eventos futuros cadastrados.</div>';
    return;
  }

  upcoming.forEach((event) => {
    const card = document.createElement("article");
    card.className = "event-card";
    const modes = getEventModes(event);
    const dateLabel = formatEventDate(event, { short: true });
    const image = event.imageUrl1 || placeholderImage(event);

    card.innerHTML = `
      <a class="event-card-image" href="${escapeAttribute(getEventUrl(event))}">
        <img src="${escapeAttribute(image)}" alt="${escapeAttribute(event.title)}" />
        <span class="badge-stack">${renderBadges(event)}</span>
      </a>
      <div class="event-card-body">
        <div class="event-card-date">
          <span class="material-symbols-outlined">calendar_today</span>
          <span>${escapeHtml(dateLabel)}${event.time ? `, ${escapeHtml(formatTime(event.time))}` : ""}</span>
        </div>
        <h2>${escapeHtml(event.title)}</h2>
        <p>${escapeHtml(event.description || "Sem descricao cadastrada.")}</p>
        <div class="event-card-footer">
          <span>
            <span class="material-symbols-outlined">${modes.some((mode) => mode.key === "presencial") ? "location_on" : "videocam"}</span>
            ${escapeHtml(event.city || "Online")}
          </span>
          <a href="${escapeAttribute(getEventUrl(event))}">
            Ver detalhes
            <span class="material-symbols-outlined">chevron_right</span>
          </a>
        </div>
      </div>
    `;

    container.appendChild(card);
  });
}

function renderCalendar() {
  const grid = document.getElementById("calendarGrid");
  const monthLabel = document.getElementById("monthLabel");
  if (!grid || !monthLabel) return;

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  monthLabel.textContent = currentDate.toLocaleDateString("pt-BR", {
    month: "long",
    year: "numeric"
  });

  grid.innerHTML = "";

  const firstDay = new Date(year, month, 1);
  const start = new Date(year, month, 1 - firstDay.getDay());
  const today = formatDateInput(new Date());

  for (let i = 0; i < 42; i++) {
    const dayDate = new Date(start);
    dayDate.setDate(start.getDate() + i);

    const dayKey = formatDateInput(dayDate);
    const dayEvents = filterEvents(cachedEvents)
      .filter((event) => event.date === dayKey)
      .sort((a, b) => String(a.time).localeCompare(String(b.time)));

    const day = document.createElement("div");
    day.className = "day";
    if (dayDate.getMonth() !== month) day.classList.add("muted");
    if (dayKey === today) day.classList.add("today");

    day.innerHTML = `<span class="day-number">${dayDate.getDate()}</span>`;

    dayEvents.slice(0, 3).forEach((event) => {
      const pill = document.createElement("a");
      pill.className = `event-pill ${getEventModes(event)[0].key}`;
      pill.href = getEventUrl(event);
      pill.innerHTML = `<strong>${escapeHtml(event.time ? formatTime(event.time) : "")} ${escapeHtml(event.title)}</strong><span>${escapeHtml(getEventModes(event).map((mode) => mode.label).join(" + "))}</span>`;
      day.appendChild(pill);
    });

    if (dayEvents.length > 3) {
      const more = document.createElement("span");
      more.className = "event-more";
      more.textContent = `+${dayEvents.length - 3} eventos`;
      day.appendChild(more);
    }

    grid.appendChild(day);
  }
}

function renderEventList(container, events) {
  if (!container) return;
  const upcoming = filterEvents(getUpcomingEvents(events)).slice(0, 4);
  container.innerHTML = "";

  if (!upcoming.length) {
    container.innerHTML = '<div class="empty-state">Ainda nao ha eventos futuros cadastrados.</div>';
    return;
  }

  upcoming.forEach((event) => {
    const item = document.createElement("article");
    item.className = "agenda-item";
    item.innerHTML = `
      <img src="${escapeAttribute(event.imageUrl1 || placeholderImage(event))}" alt="${escapeAttribute(event.title)}" />
      <div>
        <span class="badge-stack inline">${renderBadges(event)}</span>
        <h3>${escapeHtml(event.title)}</h3>
        <p>${escapeHtml(formatEventDate(event, { short: true }))}${event.time ? `, ${escapeHtml(formatTime(event.time))}` : ""}</p>
        <a href="${escapeAttribute(getEventUrl(event))}">
          Ver detalhes
          <span class="material-symbols-outlined">chevron_right</span>
        </a>
      </div>
    `;
    container.appendChild(item);
  });
}

function renderEventPage(event, detail) {
  document.title = `${event.title} | A Liga dos Palestrantes`;
  const image = event.imageUrl1 || placeholderImage(event);
  const secondaryImage = event.imageUrl2 || image;

  detail.innerHTML = `
    <section class="event-detail-grid">
      <div class="event-detail-main">
        <div class="detail-hero">
          <img src="${escapeAttribute(image)}" alt="${escapeAttribute(event.title)}" />
          <div class="detail-hero-overlay"></div>
          <div class="detail-hero-content">
            <span class="badge-stack">${renderBadges(event)}</span>
            <h1>${escapeHtml(event.title)}</h1>
            <p>${escapeHtml(event.description || "Evento publicado no ecossistema A Liga dos Palestrantes.")}</p>
          </div>
        </div>

        <dl class="meta-grid">
          <div>
            <span class="material-symbols-outlined">calendar_month</span>
            <dt>Data</dt>
            <dd>${escapeHtml(formatEventDate(event))}</dd>
          </div>
          <div>
            <span class="material-symbols-outlined">schedule</span>
            <dt>Horario</dt>
            <dd>${event.time ? escapeHtml(formatTime(event.time)) : "A definir"}</dd>
          </div>
          <div>
            <span class="material-symbols-outlined">location_on</span>
            <dt>Local</dt>
            <dd>${escapeHtml(event.city || "Online")}</dd>
          </div>
        </dl>

        <section class="content-card">
          <p class="eyebrow">Sobre o evento</p>
          <h2>Detalhes</h2>
          <p>${escapeHtml(event.description || "Sem descricao cadastrada.")}</p>
        </section>
      </div>

      <aside class="event-aside">
        <section class="content-card speaker-card">
          <img src="${escapeAttribute(secondaryImage)}" alt="${escapeAttribute(event.clientName || event.title)}" />
          <p class="eyebrow">Organizador</p>
          <h2>${escapeHtml(event.clientName || "Cliente")}</h2>
          <p>${escapeHtml(event.city || "Evento online")}</p>
        </section>

        <section class="content-card registration-card">
          <p class="eyebrow">Inscricao</p>
          <h2>Participe do evento</h2>
          <p>Confira as informacoes oficiais e avance pelo link do organizador.</p>
          ${event.link ? `<a class="button primary full" href="${escapeAttribute(event.link)}" target="_blank" rel="noreferrer">Abrir inscricao <span class="material-symbols-outlined">arrow_forward</span></a>` : ""}
          <button class="button ghost full" type="button" id="copyEventUrl">Copiar URL</button>
        </section>
      </aside>
    </section>
  `;

  document.getElementById("copyEventUrl")?.addEventListener("click", async () => {
    await navigator.clipboard?.writeText(window.location.href);
  });
}

function renderMissingEvent(detail) {
  detail.innerHTML = `
    <div class="empty-state wide">
      Este evento nao existe ou o link esta incompleto.
    </div>
  `;
}

async function apiFetch(path, options = {}) {
  const response = await fetch(path, options);
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Nao foi possivel concluir a acao.");
  }

  return data;
}

function getUpcomingEvents(events) {
  return events
    .filter((event) => event.date >= formatDateInput(new Date()))
    .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
}

function filterEvents(events) {
  if (activeFilter === "all") return events;
  return events.filter((event) => getEventModes(event).some((mode) => mode.key === activeFilter));
}

function getEventModes(event) {
  const categories = Array.isArray(event.categories) ? event.categories : [];
  const normalized = categories.filter((item) => item === "online" || item === "presencial");
  const fallback = event.city ? ["presencial"] : ["online"];
  return [...new Set(normalized.length ? normalized : fallback)].map((key) => ({
    key,
    label: key === "presencial" ? "Presencial" : "Online"
  }));
}

function renderBadges(event) {
  return getEventModes(event)
    .map((mode) => `<span class="badge ${mode.key}">${escapeHtml(mode.label)}</span>`)
    .join("");
}

function getEventUrl(event) {
  const id = typeof event === "string" ? event : event.slug || event.id;
  return `evento.html?id=${encodeURIComponent(id)}`;
}

function formatEventDate(event, options = {}) {
  const date = new Date(`${event.date}T${event.time || "12:00"}`);
  return date.toLocaleDateString("pt-BR", {
    weekday: options.short ? undefined : "long",
    day: "2-digit",
    month: options.short ? "short" : "long",
    year: options.short ? undefined : "numeric"
  });
}

function formatTime(value) {
  return String(value || "").slice(0, 5);
}

function placeholderImage(event) {
  const mode = getEventModes(event)[0].key;
  return mode === "presencial"
    ? "https://images.unsplash.com/photo-1511578314322-379afb476865?auto=format&fit=crop&w=1200&q=80"
    : "https://images.unsplash.com/photo-1591115765373-5207764f72e7?auto=format&fit=crop&w=1200&q=80";
}

function formatDateInput(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function clean(value) {
  return String(value || "").trim();
}

function escapeHtml(value) {
  return clean(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value) {
  const trimmed = clean(value);
  if (!/^(https?:\/\/|\/api\/uploads\/local\/[a-z0-9-]+$|[a-z0-9_-]+\.html\?)/i.test(trimmed)) return "";
  return escapeHtml(trimmed);
}
