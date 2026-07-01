const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const QRCode = require("qrcode");
const { neon } = require("@neondatabase/serverless");
const { createClient } = require("@supabase/supabase-js");

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, "data");
const STATIC_DIR = path.join(__dirname, "frontend", "dist");
const APP_URL = normalizeAppUrl(process.env.APP_URL) || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : `http://localhost:${PORT}`);
const DATABASE_URL = normalizeDatabaseUrl(process.env.NEON_DATABASE_URL || process.env.DATABASE_URL);
const SUPABASE_URL = normalizeSupabaseUrl(process.env.SUPABASE_URL);
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const MP_TOKEN = process.env.MERCADO_PAGO_ACCESS_TOKEN;

const neonSql = DATABASE_URL ? neon(DATABASE_URL) : null;
const supabase = SUPABASE_URL && SUPABASE_KEY ? createClient(SUPABASE_URL, SUPABASE_KEY) : null;
const tables = ["users", "tickets", "settings", "sessions"];
const tableNames = new Set(tables);
let seedDone = false;
let schemaReady = false;

function normalizeAppUrl(value) {
  if (!value) return "";
  const trimmed = String(value).trim().replace(/^"|"$/g, "");
  try {
    return new URL(trimmed).origin;
  } catch {
    return "";
  }
}

function normalizeSupabaseUrl(value) {
  if (!value) return "";
  const trimmed = String(value).trim().replace(/^"|"$/g, "").replace(/\/rest\/v1\/?$/, "");
  try {
    return new URL(trimmed).origin;
  } catch {
    return "";
  }
}

function normalizeDatabaseUrl(value) {
  if (!value) return "";
  const trimmed = String(value).trim().replace(/^"|"$/g, "");
  try {
    const url = new URL(trimmed);
    url.searchParams.delete("channel_binding");
    return url.toString();
  } catch {
    return trimmed;
  }
}

function now() {
  return new Date().toISOString();
}

function id(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function cleanDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

function createTicketCode(usedCodes = new Set()) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@*+%$";
  for (let attempt = 0; attempt < 100; attempt += 1) {
    let code = "";
    for (let i = 0; i < 5; i += 1) {
      code += chars[crypto.randomInt(chars.length)];
    }
    if (!usedCodes.has(code)) {
      usedCodes.add(code);
      return code;
    }
  }
  throw new Error("Não foi possível gerar um código único para o ingresso.");
}

function isValidCpf(value) {
  const cpf = cleanDigits(value);
  if (cpf.length !== 11 || /^(\d)\1+$/.test(cpf)) return false;
  const calcDigit = (size) => {
    let sum = 0;
    for (let i = 0; i < size; i += 1) sum += Number(cpf[i]) * (size + 1 - i);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  return calcDigit(9) === Number(cpf[9]) && calcDigit(10) === Number(cpf[10]);
}

function hash(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

const mercadoPagoWaitingStatuses = new Set(["pending", "in_process", "authorized"]);
const mercadoPagoFinalUnpaidStatuses = new Set(["rejected", "cancelled", "refunded", "charged_back", "in_mediation"]);

function isMercadoPagoWaiting(ticket) {
  const status = ticket.mercadoPagoStatus;
  return !status || mercadoPagoWaitingStatuses.has(status);
}

function isTicketPaid(ticket) {
  if (ticket.mercadoPagoStatus === "manual") return ticket.status === "confirmed";
  if (ticket.mercadoPagoStatus) return ticket.mercadoPagoStatus === "approved";
  return ticket.status === "confirmed";
}

function isExpiredPendingTicket(ticket) {
  return ticket.status === "pending" && isMercadoPagoWaiting(ticket) && ticket.createdAt && Date.now() - new Date(ticket.createdAt).getTime() > 1000 * 60 * 60;
}

function ensureLocalFiles() {
  if (neonSql || supabase) return;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  for (const table of tables) {
    const file = path.join(DATA_DIR, `${table}.json`);
    if (!fs.existsSync(file)) fs.writeFileSync(file, "[]");
  }
}

function readLocal(table) {
  ensureLocalFiles();
  return JSON.parse(fs.readFileSync(path.join(DATA_DIR, `${table}.json`), "utf8"));
}

function writeLocal(table, rows) {
  ensureLocalFiles();
  fs.writeFileSync(path.join(DATA_DIR, `${table}.json`), JSON.stringify(rows, null, 2));
}

function assertTable(table) {
  if (!tableNames.has(table)) throw new Error("Tabela inválida.");
}

async function neonAll(table) {
  if (table === "users") return neonSql`select id, data from users`;
  if (table === "tickets") return neonSql`select id, data from tickets`;
  if (table === "settings") return neonSql`select id, data from settings`;
  return neonSql`select id, data from sessions`;
}

async function neonSave(table, record) {
  const payload = JSON.stringify(record);
  if (table === "users") {
    return neonSql`insert into users (id, data, updated_at) values (${record.id}, ${payload}::jsonb, now()) on conflict (id) do update set data = excluded.data, updated_at = now()`;
  }
  if (table === "tickets") {
    return neonSql`insert into tickets (id, data, updated_at) values (${record.id}, ${payload}::jsonb, now()) on conflict (id) do update set data = excluded.data, updated_at = now()`;
  }
  if (table === "settings") {
    return neonSql`insert into settings (id, data, updated_at) values (${record.id}, ${payload}::jsonb, now()) on conflict (id) do update set data = excluded.data, updated_at = now()`;
  }
  return neonSql`insert into sessions (id, data, updated_at) values (${record.id}, ${payload}::jsonb, now()) on conflict (id) do update set data = excluded.data, updated_at = now()`;
}

async function neonDelete(table, idValue) {
  if (table === "users") return neonSql`delete from users where id = ${idValue}`;
  if (table === "tickets") return neonSql`delete from tickets where id = ${idValue}`;
  if (table === "settings") return neonSql`delete from settings where id = ${idValue}`;
  return neonSql`delete from sessions where id = ${idValue}`;
}

async function ensureNeonSchema() {
  if (!neonSql || schemaReady) return;
  await neonSql`
    create table if not exists users (
      id text primary key,
      data jsonb not null,
      updated_at timestamptz default now()
    )
  `;
  await neonSql`
    create table if not exists tickets (
      id text primary key,
      data jsonb not null,
      updated_at timestamptz default now()
    )
  `;
  await neonSql`
    create table if not exists settings (
      id text primary key,
      data jsonb not null,
      updated_at timestamptz default now()
    )
  `;
  await neonSql`
    create table if not exists sessions (
      id text primary key,
      data jsonb not null,
      updated_at timestamptz default now()
    )
  `;
  schemaReady = true;
}

const db = {
  async all(table) {
    assertTable(table);
    if (neonSql) {
      await ensureNeonSchema();
      const rows = await neonAll(table);
      return rows.map((row) => ({ id: row.id, ...(row.data || {}) }));
    }
    if (!supabase) return readLocal(table);
    const { data, error } = await supabase.from(table).select("*");
    if (error) throw error;
    return (data || []).map((row) => ({ id: row.id, ...(row.data || {}) }));
  },
  async save(table, record) {
    assertTable(table);
    if (neonSql) {
      await ensureNeonSchema();
      await neonSave(table, record);
      return record;
    }
    if (!supabase) {
      const rows = readLocal(table);
      const index = rows.findIndex((row) => row.id === record.id);
      if (index >= 0) rows[index] = record;
      else rows.push(record);
      writeLocal(table, rows);
      return record;
    }
    const { error } = await supabase
      .from(table)
      .upsert({ id: record.id, data: record, updated_at: now() }, { onConflict: "id" });
    if (error) throw error;
    return record;
  },
  async removeWhere(table, predicate) {
    assertTable(table);
    const rows = await this.all(table);
    const remove = rows.filter(predicate);
    if (neonSql) {
      await ensureNeonSchema();
      for (const row of remove) await neonDelete(table, row.id);
      return;
    }
    if (!supabase) {
      writeLocal(table, rows.filter((row) => !predicate(row)));
      return;
    }
    for (const row of remove) {
      const { error } = await supabase.from(table).delete().eq("id", row.id);
      if (error) throw error;
    }
  }
};

async function ensureSeed() {
  if (seedDone) return;
  const settings = await db.all("settings");
  if (!settings.find((item) => item.id === "event")) {
    await db.save("settings", {
      id: "event",
      eventName: "Encontrão 25 Anos",
      city: "Campina Grande - PB",
      registrationOpen: true,
      ticketPrice: 50,
      updatedAt: now()
    });
  }

  const users = await db.all("users");
  if (!users.find((user) => user.whatsapp === "10101010101")) {
    await db.save("users", {
      id: id("usr"),
      name: "Área Exclusiva",
      cpf: "10101010101",
      whatsapp: "10101010101",
      birthDate: "123456789",
      role: "admin",
      createdAt: now()
    });
  }
  seedDone = true;
}

function send(res, status, payload, headers = {}) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    ...headers
  });
  res.end(JSON.stringify(payload));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) req.destroy();
    });
    req.on("end", () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
  });
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    cpf: user.cpf,
    whatsapp: user.whatsapp,
    birthDate: user.birthDate,
    role: user.role || "usuarios"
  };
}

async function getSessionUser(req) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return null;
  const sessions = await db.all("sessions");
  const session = sessions.find((item) => item.tokenHash === hash(token) && new Date(item.expiresAt) > new Date());
  if (!session) return null;
  const users = await db.all("users");
  const user = users.find((item) => item.id === session.userId);
  return user ? { user, session } : null;
}

function requireRole(auth, roles) {
  if (!auth) return false;
  return roles.includes(auth.user.role || "usuarios");
}

async function createSession(user) {
  const token = crypto.randomBytes(32).toString("hex");
  await db.removeWhere("sessions", (session) => session.userId === user.id);
  await db.save("sessions", {
    id: id("ses"),
    userId: user.id,
    tokenHash: hash(token),
    createdAt: now(),
    expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString()
  });
  return token;
}

async function ticketWithQr(ticket) {
  if (!isTicketPaid(ticket)) return ticket;
  const qrPayload = ticket.code;
  return {
    ...ticket,
    qrCode: await QRCode.toDataURL(qrPayload, { width: 360, margin: 2 })
  };
}

function mercadoPagoErrorMessage(data, fallback) {
  const cause = Array.isArray(data?.cause) ? data.cause : [];
  const details = cause
    .map((item) => item?.description || item?.message || item?.code)
    .filter(Boolean)
    .join(" ");
  return details || data?.message || data?.error || fallback;
}

function mercadoPagoPayerEmail(user) {
  const digits = cleanDigits(user?.cpf || user?.id);
  const suffix = digits || cleanDigits(user?.whatsapp) || String(user?.id || "comprador").replace(/[^a-z0-9]/gi, "");
  return `comprador+${suffix}@ejd25anos.com.br`;
}

async function createMercadoPagoPreference(user, orderId, quantity, unitPrice) {
  if (!MP_TOKEN) return null;
  const response = await fetch("https://api.mercadopago.com/checkout/preferences", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${MP_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      external_reference: orderId,
      notification_url: `${APP_URL}/webhook/mercadopago`,
      items: [
        {
          title: "Ingresso - Encontrão 25 Anos",
          quantity,
          unit_price: Number(unitPrice),
          currency_id: "BRL"
        }
      ],
      payer: {
        name: user.name,
        phone: { number: user.whatsapp }
      },
      payment_methods: {
        excluded_payment_types: [],
        installments: 3
      },
      back_urls: {
        success: `${APP_URL}/`,
        pending: `${APP_URL}/`,
        failure: `${APP_URL}/`
      },
      auto_return: "approved"
    })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(mercadoPagoErrorMessage(data, "Falha ao criar pagamento."));
  return data;
}

async function createMercadoPagoPixPayment(user, orderId, quantity, unitPrice) {
  if (!MP_TOKEN) return null;
  const total = Number((Number(unitPrice) * Number(quantity)).toFixed(2));
  const response = await fetch("https://api.mercadopago.com/v1/payments", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${MP_TOKEN}`,
      "Content-Type": "application/json",
      "X-Idempotency-Key": orderId
    },
    body: JSON.stringify({
      transaction_amount: total,
      description: `${quantity} ingresso(s) - Encontrão 25 Anos`,
      payment_method_id: "pix",
      external_reference: orderId,
      notification_url: `${APP_URL}/webhook/mercadopago`,
      payer: {
        email: mercadoPagoPayerEmail(user),
        first_name: user.name,
        identification: {
          type: "CPF",
          number: user.cpf
        }
      }
    })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(mercadoPagoErrorMessage(data, "Falha ao gerar Pix."));
  const transactionData = data.point_of_interaction?.transaction_data || {};
  return {
    id: String(data.id),
    status: data.status,
    qrCode: transactionData.qr_code,
    qrCodeBase64: transactionData.qr_code_base64,
    ticketUrl: transactionData.ticket_url
  };
}

async function api(req, res, pathname) {
  await ensureSeed();
  const body = ["POST", "PUT", "PATCH"].includes(req.method) ? await parseBody(req) : {};
  const auth = await getSessionUser(req);

  if (pathname === "/api/config" && req.method === "GET") {
    const settings = (await db.all("settings")).find((item) => item.id === "event");
    return send(res, 200, { settings, paymentConfigured: Boolean(MP_TOKEN) });
  }

  if (pathname === "/api/register" && req.method === "POST") {
    const settings = (await db.all("settings")).find((item) => item.id === "event");
    if (!settings.registrationOpen) return send(res, 403, { message: "Cadastro fechado." });
    const name = String(body.name || "").trim();
    const cpf = cleanDigits(body.cpf);
    const whatsapp = cleanDigits(body.whatsapp);
    const birthDate = cleanDigits(body.birthDate);
    if (!name || cpf.length !== 11 || whatsapp.length !== 11 || !birthDate) {
      return send(res, 400, { message: "Preencha nome, CPF, WhatsApp e nascimento corretamente." });
    }
    if (!isValidCpf(cpf)) return send(res, 400, { message: "O CPF informado é inválido." });
    const users = await db.all("users");
    if (users.find((user) => user.cpf === cpf)) {
      return send(res, 409, { message: "Ja existe uma conta cadastrada com esse CPF." });
    }
    const user = {
      id: id("usr"),
      name,
      cpf,
      whatsapp,
      birthDate,
      role: "usuarios",
      createdAt: now()
    };
    await db.save("users", user);
    const token = await createSession(user);
    return send(res, 201, { token, user: publicUser(user) });
  }

  if (pathname === "/api/login" && req.method === "POST") {
    const cpf = cleanDigits(body.cpf || body.whatsapp);
    const birthDate = cleanDigits(body.birthDate);
    const users = await db.all("users");
    const user = users.find((item) => item.cpf === cpf && item.birthDate === birthDate);
    if (!user) return send(res, 401, { message: "Credenciais inválidas." });
    const token = await createSession(user);
    return send(res, 200, { token, user: publicUser(user) });
  }

  if (pathname === "/api/me" && req.method === "GET") {
    if (!auth) return send(res, 401, { message: "Sessão inválida." });
    const tickets = (await db.all("tickets")).filter((ticket) => ticket.userId === auth.user.id && !isExpiredPendingTicket(ticket));
    const withQr = await Promise.all(tickets.map(ticketWithQr));
    return send(res, 200, { user: publicUser(auth.user), tickets: withQr });
  }

  if (pathname === "/api/logout" && req.method === "POST") {
    if (auth) await db.removeWhere("sessions", (session) => session.id === auth.session.id);
    return send(res, 200, { ok: true });
  }

  if (pathname === "/api/tickets/checkout" && req.method === "POST") {
    if (!auth) return send(res, 401, { message: "Sessão inválida." });
    const settings = (await db.all("settings")).find((item) => item.id === "event");
    const quantity = Math.min(Math.max(Number.parseInt(body.quantity, 10) || 1, 1), 20);
    const paymentMethod = body.paymentMethod === "credit_card" ? "credit_card" : "pix";
    const unitPrice = Number(settings.ticketPrice || 0);
    const subtotal = unitPrice * quantity;
    const serviceFeeRate = paymentMethod === "credit_card" ? 0.08 : 0.01;
    const serviceFee = Number((subtotal * serviceFeeRate).toFixed(2));
    const total = Number((subtotal + serviceFee).toFixed(2));
    const paymentUnitPrice = Number((total / quantity).toFixed(2));
    const orderId = id("ord");
    const usedCodes = new Set((await db.all("tickets")).map((ticket) => ticket.code));
    const tickets = Array.from({ length: quantity }, () => ({
      id: id("tkt"),
      orderId,
      userId: auth.user.id,
      participantName: auth.user.name,
      participantWhatsapp: auth.user.whatsapp,
      status: "pending",
      mercadoPagoStatus: "pending",
      price: unitPrice,
      serviceFee: Number((serviceFee / quantity).toFixed(2)),
      paymentMethod,
      code: createTicketCode(usedCodes),
      checkinAt: null,
      paymentId: null,
      createdAt: now(),
      updatedAt: now()
    }));
    let pix = null;
    let preference = null;
    try {
      if (paymentMethod === "pix") {
        pix = await createMercadoPagoPixPayment(auth.user, orderId, quantity, paymentUnitPrice);
        if (!pix) return send(res, 400, { message: "Mercado Pago nao configurado para gerar Pix." });
        if (pix) {
          for (const ticket of tickets) ticket.paymentId = pix.id;
        }
      } else {
        preference = await createMercadoPagoPreference(auth.user, orderId, quantity, paymentUnitPrice);
      }
    } catch (error) {
      return send(res, 502, { message: error.message || "Falha ao solicitar pagamento no Mercado Pago." });
    }
    if (preference) {
      for (const ticket of tickets) {
        ticket.paymentPreferenceId = preference.id;
        ticket.paymentUrl = preference.init_point || preference.sandbox_init_point;
        ticket.mercadoPagoStatus = "pending";
      }
    }
    for (const ticket of tickets) await db.save("tickets", ticket);
    return send(res, 201, {
      tickets,
      quantity,
      subtotal,
      serviceFee,
      total,
      paymentMethod,
      pix,
      paymentUrl: tickets[0]?.paymentUrl,
      message: preference || pix ? "Pagamento criado." : "Pagamento aguardando configuração do Mercado Pago."
    });
  }

  if (pathname === "/api/checkin/validate" && req.method === "POST") {
    if (!requireRole(auth, ["checkin", "admin"])) return send(res, 403, { message: "Acesso negado." });
    const rawValue = String(body.value || "").trim().toUpperCase();
    const phoneValue = cleanDigits(body.value);
    const tickets = await db.all("tickets");
    let ticket = tickets.find((item) => item.code === rawValue);
    if (!ticket && phoneValue.length >= 10) ticket = tickets.find((item) => item.participantWhatsapp === phoneValue);
    if (!ticket) return send(res, 404, { message: "Ingresso não encontrado." });
    if (ticket.status !== "confirmed") return send(res, 409, { message: "Ingresso ainda não está confirmado." });
    if (ticket.checkinAt) return send(res, 409, { message: `Check-in já realizado em ${new Date(ticket.checkinAt).toLocaleString("pt-BR")}.` });
    ticket.checkinAt = now();
    ticket.checkedBy = auth.user.id;
    ticket.updatedAt = now();
    await db.save("tickets", ticket);
    return send(res, 200, { message: "Check-in realizado com sucesso.", ticket });
  }

  if (pathname === "/api/admin/summary" && req.method === "GET") {
    if (!requireRole(auth, ["admin"])) return send(res, 403, { message: "Acesso negado." });
    const tickets = (await db.all("tickets")).filter((ticket) => !isExpiredPendingTicket(ticket));
    const users = await db.all("users");
    const usersById = new Map(users.map((user) => [user.id, publicUser(user)]));
    const enrichedTickets = tickets.map((ticket) => ({
      ...ticket,
      manualConfirmedByName: ticket.manualConfirmedBy ? usersById.get(ticket.manualConfirmedBy)?.name || "Usuário removido" : null
    }));
    return send(res, 200, {
      paid: tickets.filter(isTicketPaid).length,
      pending: tickets.filter((ticket) => !isTicketPaid(ticket) && isMercadoPagoWaiting(ticket)).length,
      present: tickets.filter((ticket) => ticket.checkinAt).length,
      users: users.length,
      tickets: enrichedTickets
    });
  }

  if (pathname === "/api/admin/settings" && req.method === "PUT") {
    if (!requireRole(auth, ["admin"])) return send(res, 403, { message: "Acesso negado." });
    const current = (await db.all("settings")).find((item) => item.id === "event");
    const settings = {
      ...current,
      ticketPrice: Number(body.ticketPrice || current.ticketPrice || 0),
      registrationOpen: Boolean(body.registrationOpen),
      updatedAt: now()
    };
    await db.save("settings", settings);
    return send(res, 200, { settings });
  }

  if (pathname === "/api/admin/users" && req.method === "GET") {
    if (!requireRole(auth, ["admin"])) return send(res, 403, { message: "Acesso negado." });
    const users = (await db.all("users")).map(publicUser);
    return send(res, 200, { users });
  }

  const roleMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)\/role$/);
  if (roleMatch && req.method === "PUT") {
    if (!requireRole(auth, ["admin"])) return send(res, 403, { message: "Acesso negado." });
    const allowed = ["usuarios", "participant", "checkin", "admin"];
    if (!allowed.includes(body.role)) return send(res, 400, { message: "Perfil inválido." });
    const users = await db.all("users");
    const user = users.find((item) => item.id === roleMatch[1]);
    if (!user) return send(res, 404, { message: "Usuário não encontrado." });
    user.role = body.role;
    user.updatedAt = now();
    await db.save("users", user);
    return send(res, 200, { user: publicUser(user) });
  }

  const confirmMatch = pathname.match(/^\/api\/admin\/tickets\/([^/]+)\/confirm$/);
  if (confirmMatch && req.method === "POST") {
    if (!requireRole(auth, ["admin"])) return send(res, 403, { message: "Acesso negado." });
    const tickets = await db.all("tickets");
    const ticket = tickets.find((item) => item.id === confirmMatch[1]);
    if (!ticket) return send(res, 404, { message: "Ingresso não encontrado." });
    ticket.status = "confirmed";
    ticket.mercadoPagoStatus = "manual";
    ticket.confirmedAt = now();
    ticket.paidAt = ticket.confirmedAt;
    ticket.manualConfirmedBy = auth.user.id;
    ticket.manualConfirmedByName = auth.user.name;
    ticket.updatedAt = now();
    await db.save("tickets", ticket);
    return send(res, 200, { ticket: await ticketWithQr(ticket) });
  }

  return send(res, 404, { message: "Rota não encontrada." });
}

async function mercadoPagoWebhook(req, res) {
  await ensureSeed();
  const body = await parseBody(req).catch(() => ({}));
  const paymentId = body?.data?.id || body?.id;
  if (!paymentId || !MP_TOKEN) return send(res, 200, { ok: true });
  const response = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
    headers: { Authorization: `Bearer ${MP_TOKEN}` }
  });
  const payment = await response.json();
  const reference = payment.external_reference;
  if (reference) {
    const tickets = await db.all("tickets");
    const orderTickets = tickets.filter((item) => item.orderId === reference || item.id === reference);
    for (const ticket of orderTickets) {
      ticket.mercadoPagoStatus = payment.status;
      ticket.mercadoPagoStatusDetail = payment.status_detail || null;
      ticket.mercadoPagoStatusUpdatedAt = now();
      ticket.paymentId = String(paymentId);
      if (payment.status === "approved") {
        ticket.status = "confirmed";
        ticket.confirmedAt = payment.date_approved || now();
        ticket.paidAt = ticket.confirmedAt;
        ticket.manualConfirmedBy = null;
      } else if (mercadoPagoFinalUnpaidStatuses.has(payment.status)) {
        ticket.status = "pending";
      }
      ticket.updatedAt = now();
      await db.save("tickets", ticket);
    }
  }
  return send(res, 200, { ok: true });
}

function serveStatic(req, res, pathname) {
  let filePath = pathname === "/" ? path.join(STATIC_DIR, "index.html") : path.join(STATIC_DIR, pathname);
  if (!filePath.startsWith(STATIC_DIR)) {
    res.writeHead(403);
    return res.end("Acesso negado");
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(STATIC_DIR, "index.html");
  }
  if (!fs.existsSync(filePath)) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end("<h1>EJD - credenciamento</h1><p>Execute npm run build para gerar o frontend.</p>");
  }
  const ext = path.extname(filePath);
  const types = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".ico": "image/x-icon"
  };
  res.writeHead(200, { "Content-Type": types[ext] || "application/octet-stream" });
  fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, APP_URL);
    if (url.pathname === "/health") return send(res, 200, { ok: true, storage: neonSql ? "neon" : supabase ? "supabase" : "local" });
    if (url.pathname.startsWith("/api/")) return api(req, res, url.pathname);
    if (url.pathname === "/webhook/mercadopago") return mercadoPagoWebhook(req, res);
    return serveStatic(req, res, url.pathname);
  } catch (error) {
    console.error(error);
    return send(res, 500, { message: error.message || "Erro interno." });
  }
});

if (require.main === module) {
  server.listen(PORT, () => {
    ensureLocalFiles();
    console.log(`EJD - credenciamento em http://localhost:${PORT}`);
  });
}

module.exports = server;
