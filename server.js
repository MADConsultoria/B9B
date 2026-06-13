const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const root = __dirname;
const port = Number(process.env.PORT || 8080);
const supabaseUrl = cleanEnv(process.env.SUPABASE_URL);
const supabaseServiceKey = cleanEnv(process.env.SUPABASE_SERVICE_ROLE_KEY);
const tokenPepper = cleanEnv(process.env.TOKEN_PEPPER) || "local-dev";
const hasSupabase = Boolean(supabaseUrl && supabaseServiceKey);
const imageBucket = "event-images";
const maxImageSize = 8 * 1024 * 1024;
const allowedImageTypes = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"]
]);
const localUploads = new Map();

const localState = {
  clients: [
    { id: "local-client-1", name: "Mentorado Exemplo", token: "MENTORADO-2026" },
    { id: "local-client-2", name: "Cliente Demo", token: "B9B-CLIENTE" }
  ],
  events: [
    {
      id: "seed-1",
      client_id: "local-client-1",
      client_name: "Mentorado Exemplo",
      title: "Workshop de Vendas",
      slug: "workshop-de-vendas",
      event_date: nextDate(4),
      event_time: "19:00",
      city: "Sao Paulo / SP",
      external_link: "",
      image_url_1: "",
      image_url_2: "",
      categories: ["presencial"],
      description: "Evento de aquecimento para leads e clientes ativos.",
      published: true
    },
    {
      id: "seed-2",
      client_id: "local-client-2",
      client_name: "Cliente Demo",
      title: "Imersao Presencial",
      slug: "imersao-presencial",
      event_date: nextDate(12),
      event_time: "09:00",
      city: "Curitiba / PR",
      external_link: "",
      image_url_1: "",
      image_url_2: "",
      categories: ["presencial"],
      description: "Encontro presencial com convidados e parceiros.",
      published: true
    }
  ]
};

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml"
};

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);

    if (url.pathname.startsWith("/api/")) {
      await handleApi(request, response, url);
      return;
    }

    serveStatic(response, url.pathname);
  } catch (error) {
    sendJson(response, error.statusCode || 500, { error: error.message || "Erro interno do servidor." });
    console.error(error);
  }
});

server.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
  console.log(hasSupabase ? "Supabase enabled" : "Supabase disabled: using local demo state");
});

async function handleApi(request, response, url) {
  if (request.method === "GET" && url.pathname === "/api/health") {
    sendJson(response, 200, { ok: true, supabase: hasSupabase });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/events") {
    const events = await listEvents();
    sendJson(response, 200, { events: events.map(toPublicEvent) });
    return;
  }

  if (request.method === "GET" && url.pathname.startsWith("/api/events/")) {
    const id = decodeURIComponent(url.pathname.replace("/api/events/", ""));
    const event = await getEvent(id);

    if (!event) {
      sendJson(response, 404, { error: "Evento nao encontrado." });
      return;
    }

    sendJson(response, 200, { event: toPublicEvent(event) });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/events") {
    const body = await readJson(request);
    const client = await validateToken(body.token);

    if (!client) {
      sendJson(response, 401, { error: "Token invalido ou inativo." });
      return;
    }

    const event = await createEvent(client, body);
    sendJson(response, 201, { event: toPublicEvent(event) });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/uploads/images") {
    const client = await validateToken(request.headers["x-upload-token"]);

    if (!client) {
      sendJson(response, 401, { error: "Token invalido ou inativo." });
      return;
    }

    const image = await readImage(request);
    const imageUrl = await uploadImage(client, image);
    sendJson(response, 201, { url: imageUrl });
    return;
  }

  if (request.method === "GET" && url.pathname.startsWith("/api/uploads/local/")) {
    const uploadId = url.pathname.replace("/api/uploads/local/", "");
    const image = localUploads.get(uploadId);

    if (!image) {
      sendJson(response, 404, { error: "Imagem nao encontrada." });
      return;
    }

    response.writeHead(200, {
      "Content-Type": image.contentType,
      "Content-Length": image.buffer.length,
      "Cache-Control": "public, max-age=31536000, immutable"
    });
    response.end(image.buffer);
    return;
  }

  sendJson(response, 404, { error: "Rota nao encontrada." });
}

async function listEvents() {
  if (!hasSupabase) {
    return localState.events.filter((event) => event.published);
  }

  const data = await supabaseFetch(
    "/rest/v1/events?select=*&published=eq.true&order=event_date.asc,event_time.asc"
  );
  return data;
}

async function getEvent(idOrSlug) {
  if (!hasSupabase) {
    return localState.events.find((event) => event.id === idOrSlug || event.slug === idOrSlug);
  }

  const column = isUuid(idOrSlug) ? "id" : "slug";
  const data = await supabaseFetch(
    `/rest/v1/events?select=*&published=eq.true&${column}=eq.${encodeURIComponent(idOrSlug)}&limit=1`
  );
  return data[0] || null;
}

async function validateToken(token) {
  const cleanToken = cleanText(token);
  if (!cleanToken) return null;

  if (!hasSupabase) {
    return localState.clients.find((client) => client.token === cleanToken) || null;
  }

  const tokenHash = hashToken(cleanToken);
  const data = await supabaseFetch(
    `/rest/v1/event_clients?select=id,name&token_hash=eq.${encodeURIComponent(tokenHash)}&active=eq.true&limit=1`
  );
  return data[0] || null;
}

async function createEvent(client, body) {
  const title = cleanText(body.title);
  const eventDate = cleanText(body.date);
  const imageUrl1 = cleanUrl(body.imageUrl1);

  if (!title || !eventDate) {
    const error = new Error("Titulo e data sao obrigatorios.");
    error.statusCode = 400;
    throw error;
  }

  if (!imageUrl1) {
    const error = new Error("A imagem principal e obrigatoria.");
    error.statusCode = 400;
    throw error;
  }

  const baseEvent = {
    client_id: client.id,
    client_name: cleanText(body.clientName) || client.name,
    title,
    slug: createSlug(`${title}-${eventDate}`),
    event_date: eventDate,
    event_time: cleanText(body.time) || null,
    city: cleanText(body.city),
    external_link: cleanUrl(body.link),
    image_url_1: imageUrl1,
    image_url_2: cleanUrl(body.imageUrl2),
    categories: cleanCategories(body.categories),
    description: cleanText(body.description),
    published: true
  };

  if (!hasSupabase) {
    const event = {
      ...baseEvent,
      id: crypto.randomUUID()
    };
    localState.events.push(event);
    return event;
  }

  const data = await supabaseFetch("/rest/v1/events", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(baseEvent)
  });

  return data[0];
}

async function uploadImage(client, image) {
  const extension = allowedImageTypes.get(image.contentType);
  const objectPath = `${client.id}/${new Date().getUTCFullYear()}/${crypto.randomUUID()}.${extension}`;

  if (!hasSupabase) {
    const uploadId = crypto.randomUUID();
    localUploads.set(uploadId, image);
    return `/api/uploads/local/${uploadId}`;
  }

  await ensureImageBucket();

  const response = await fetch(
    `${supabaseUrl}/storage/v1/object/${imageBucket}/${objectPath}`,
    {
      method: "POST",
      headers: {
        apikey: supabaseServiceKey,
        Authorization: `Bearer ${supabaseServiceKey}`,
        "Content-Type": image.contentType,
        "Cache-Control": "31536000",
        "x-upsert": "false"
      },
      body: image.buffer
    }
  );

  if (!response.ok) {
    const data = await response.json().catch(() => null);
    const error = new Error(data?.message || data?.error || "Nao foi possivel enviar a imagem.");
    error.statusCode = response.status;
    throw error;
  }

  return `${supabaseUrl}/storage/v1/object/public/${imageBucket}/${objectPath}`;
}

async function ensureImageBucket() {
  const headers = {
    apikey: supabaseServiceKey,
    Authorization: `Bearer ${supabaseServiceKey}`,
    "Content-Type": "application/json"
  };
  const bucketResponse = await fetch(`${supabaseUrl}/storage/v1/bucket/${imageBucket}`, { headers });

  if (bucketResponse.ok) return;

  const bucketData = await bucketResponse.json().catch(() => null);
  const bucketError = cleanText(
    bucketData?.message || bucketData?.error || bucketData?.code
  ).toLowerCase();
  const bucketMissing = bucketResponse.status === 404
    || (bucketResponse.status === 400 && bucketError.includes("not found"));

  if (!bucketMissing) {
    const error = new Error(bucketData?.message || bucketData?.error || "Nao foi possivel verificar o armazenamento de imagens.");
    error.statusCode = bucketResponse.status;
    throw error;
  }

  const createResponse = await fetch(`${supabaseUrl}/storage/v1/bucket`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      id: imageBucket,
      name: imageBucket,
      public: true,
      file_size_limit: maxImageSize,
      allowed_mime_types: [...allowedImageTypes.keys()]
    })
  });

  if (!createResponse.ok && createResponse.status !== 409) {
    const data = await createResponse.json().catch(() => null);
    const error = new Error(data?.message || data?.error || "Nao foi possivel preparar o armazenamento de imagens.");
    error.statusCode = createResponse.status;
    throw error;
  }
}

async function supabaseFetch(pathname, options = {}) {
  const response = await fetch(`${supabaseUrl}${pathname}`, {
    ...options,
    headers: {
      apikey: supabaseServiceKey,
      Authorization: `Bearer ${supabaseServiceKey}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const error = new Error(data?.message || data?.error || "Erro no Supabase.");
    error.statusCode = response.status;
    throw error;
  }

  return data;
}

function serveStatic(response, pathname) {
  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  const safePath = path
    .normalize(decodeURIComponent(requestedPath))
    .replace(/^[/\\]+/, "")
    .replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(root, safePath);

  if (!filePath.startsWith(root)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }

    const extension = path.extname(filePath);
    response.writeHead(200, {
      "Content-Type": types[extension] || "application/octet-stream",
      "Cache-Control": [".html", ".css", ".js"].includes(extension)
        ? "no-cache"
        : "public, max-age=86400"
    });
    response.end(content);
  });
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";

    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        request.destroy();
        reject(new Error("Payload muito grande."));
      }
    });

    request.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        const error = new Error("JSON invalido.");
        error.statusCode = 400;
        reject(error);
      }
    });
  });
}

function readImage(request) {
  return new Promise((resolve, reject) => {
    const contentLength = Number(request.headers["content-length"] || 0);
    const chunks = [];
    let size = 0;
    let tooLarge = false;

    if (contentLength > maxImageSize) {
      const error = new Error("A imagem deve ter no maximo 8 MB.");
      error.statusCode = 413;
      reject(error);
      return;
    }

    request.on("data", (chunk) => {
      if (tooLarge) return;
      size += chunk.length;
      if (size > maxImageSize) {
        tooLarge = true;
        const error = new Error("A imagem deve ter no maximo 8 MB.");
        error.statusCode = 413;
        reject(error);
        return;
      }
      chunks.push(chunk);
    });

    request.on("end", () => {
      if (tooLarge) return;
      if (!size) {
        const error = new Error("Selecione uma imagem para enviar.");
        error.statusCode = 400;
        reject(error);
        return;
      }

      const buffer = Buffer.concat(chunks);
      const contentType = detectImageType(buffer);
      if (!contentType) {
        const error = new Error("O arquivo enviado nao corresponde a uma imagem valida.");
        error.statusCode = 415;
        reject(error);
        return;
      }

      resolve({ buffer, contentType });
    });

    request.on("error", reject);
  });
}

function detectImageType(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }

  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }

  if (
    buffer.length >= 12
    && buffer.subarray(0, 4).toString("ascii") === "RIFF"
    && buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }

  return "";
}

function toPublicEvent(event) {
  return {
    id: event.id,
    clientName: event.client_name,
    title: event.title,
    slug: event.slug,
    date: event.event_date,
    time: event.event_time || "",
    city: event.city || "",
    link: event.external_link || "",
    imageUrl1: event.image_url_1 || "",
    imageUrl2: event.image_url_2 || "",
    categories: Array.isArray(event.categories) ? event.categories : inferCategories(event),
    description: event.description || ""
  };
}

function cleanCategories(value) {
  const values = Array.isArray(value) ? value : [];
  const allowed = new Set(["online", "presencial"]);
  const cleanValues = values.map(cleanText).filter((item) => allowed.has(item));
  return [...new Set(cleanValues)];
}

function inferCategories(event) {
  return event.city ? ["presencial"] : ["online"];
}

function hashToken(token) {
  return crypto.createHash("sha256").update(`${tokenPepper}:${token}`).digest("hex");
}

function createSlug(value) {
  const base = cleanText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);

  return `${base}-${crypto.randomBytes(3).toString("hex")}`;
}

function cleanText(value) {
  return String(value || "").trim();
}

function cleanUrl(value) {
  const text = cleanText(value);
  if (!text) return "";
  if (!/^(https?:\/\/|\/api\/uploads\/local\/[a-z0-9-]+$)/i.test(text)) return "";
  return text;
}

function cleanEnv(value) {
  return String(value || "").trim();
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function nextDate(daysAhead) {
  const date = new Date();
  date.setDate(date.getDate() + daysAhead);
  return formatDateInput(date);
}

function formatDateInput(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
